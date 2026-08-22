-- pgTAP RLS tests for organizations / memberships / users (issue #2).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- This exercises RLS as Postgres sees it (not through PostgREST/HTTP), by
-- switching to the `authenticated` role and setting `request.jwt.claims` to
-- simulate `auth.uid()` for a given test user, exactly as Supabase's own
-- testing guide recommends. All auth.users rows created here are test
-- fixtures only, rolled back at the end of the transaction.
--
-- Note on RLS semantics used throughout this file: a `USING` clause
-- violation on UPDATE/DELETE does NOT raise an error — the row is silently
-- excluded from the affected set (0 rows changed). Only INSERT/UPDATE
-- `WITH CHECK` violations raise error 42501. Tests below assert "0 rows
-- changed" for the former and `throws_ok(..., '42501', ...)` for the
-- latter — don't conflate the two.

begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- ---------------------------------------------------------------------------
-- Fixtures: 4 auth users -> profile rows auto-created by handle_new_auth_user
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'engineer-x@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'outsider@test.local');

select is(
  (select count(*)::int from public.users
   where id in (
     '11111111-1111-1111-1111-111111111111',
     '22222222-2222-2222-2222-222222222222',
     '33333333-3333-3333-3333-333333333333',
     '44444444-4444-4444-4444-444444444444'
   )),
  4,
  'on_auth_user_created trigger populated public.users for all fixtures'
); -- 1

-- Convenience: switch the simulated request identity. plpgsql + EXECUTE is
-- used (rather than a plain `language sql` body) because SET LOCAL must be
-- run as a standalone statement; this function has no EXCEPTION block, so it
-- does not open a subtransaction and the SET LOCAL correctly persists for
-- the remainder of the enclosing test transaction.
create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap: owner_a creates org_a, then self-inserts as owner
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.organizations (id, name, created_by)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A', '11111111-1111-1111-1111-111111111111') $$,
  'owner_a can create org_a (created_by = self)'
); -- 2

select is(
  (select count(*)::int from public.organizations where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'owner_a can immediately SELECT the org they just created (creator visibility, pre-membership)'
); -- 3

select lives_ok(
  $$ insert into public.memberships (user_id, organization_id, role)
     values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner') $$,
  'owner_a can self-bootstrap an owner membership into their own, still-empty org_a'
); -- 4

-- ---------------------------------------------------------------------------
-- Bootstrap: owner_b creates org_b, then self-inserts as owner
-- ---------------------------------------------------------------------------
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.organizations (id, name, created_by)
     values ('bbbbbbbb-0000-0000-0000-000000000002', 'Org B', '22222222-2222-2222-2222-222222222222') $$,
  'owner_b can create org_b (created_by = self)'
); -- 5

select lives_ok(
  $$ insert into public.memberships (user_id, organization_id, role)
     values ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000002', 'owner') $$,
  'owner_b can self-bootstrap an owner membership into their own, still-empty org_b'
); -- 6

-- ---------------------------------------------------------------------------
-- Cross-tenant isolation: owner_a must not see org_b / its memberships
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.organizations where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'owner_a cannot SELECT org_b (not creator, not a member)'
); -- 7

select is(
  (select count(*)::int from public.memberships where organization_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'owner_a cannot SELECT any membership rows belonging to org_b'
); -- 8

select is(
  (select count(*)::int from public.organizations),
  1,
  'owner_a''s unfiltered SELECT on organizations only ever returns org_a (row is fully hidden, not just columns)'
); -- 9

-- Attempt to hijack org_b by self-bootstrapping into it: must fail because
-- org_b already has a member (owner_b) AND owner_a did not create it.
-- INSERT WITH CHECK violations raise an error.
select throws_ok(
  $$ insert into public.memberships (user_id, organization_id, role)
     values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000002', 'owner') $$,
  '42501',
  null,
  'owner_a cannot insert themselves as owner into org_b (already has a member, not the creator)'
); -- 10

-- Attempt to update org_b (not owner there): UPDATE's USING clause excludes
-- the row entirely, so this silently affects 0 rows (no error raised).
update public.organizations set name = 'Hijacked' where id = 'bbbbbbbb-0000-0000-0000-000000000002';

select is(
  (select name from public.organizations where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'Org B',
  'owner_a''s UPDATE on org_b is silently excluded by RLS (USING); name unchanged'
); -- 11

-- ---------------------------------------------------------------------------
-- Owner invite flow: owner_a (owner of org_a) can add engineer_x to org_a
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.memberships (user_id, organization_id, role)
     values ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000001', 'engineer') $$,
  'owner_a (owner of org_a) can add engineer_x as a member of org_a'
); -- 12

-- ---------------------------------------------------------------------------
-- Non-owner member cannot escalate privileges or invite others
-- ---------------------------------------------------------------------------
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');

-- UPDATE's USING clause (is_org_owner) excludes the row for a non-owner, so
-- this silently affects 0 rows rather than raising.
update public.memberships
   set role = 'owner'
 where user_id = '33333333-3333-3333-3333-333333333333'
   and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select is(
  (select role::text from public.memberships
   where user_id = '33333333-3333-3333-3333-333333333333'
     and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'engineer',
  'engineer_x (non-owner) cannot promote themselves to owner (UPDATE silently excluded by RLS)'
); -- 13

select throws_ok(
  $$ insert into public.memberships (user_id, organization_id, role)
     values ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-0000-0000-0000-000000000001', 'planner') $$,
  '42501',
  null,
  'engineer_x (non-owner) cannot invite outsider into org_a'
); -- 14

-- engineer_x is a member of org_a, so should be able to see org_a and its
-- membership roster, but still nothing from org_b.
select is(
  (select count(*)::int from public.organizations where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'engineer_x can SELECT org_a (is a member)'
); -- 15

select is(
  (select count(*)::int from public.organizations where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'engineer_x cannot SELECT org_b'
); -- 16

select is(
  (select count(*)::int from public.memberships where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2,
  'engineer_x can see both membership rows (owner_a + self) within org_a'
); -- 17

-- ---------------------------------------------------------------------------
-- users table: self + org-peer visibility, no cross-tenant visibility
-- ---------------------------------------------------------------------------
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.users where id = '33333333-3333-3333-3333-333333333333'),
  1,
  'owner_a can see engineer_x''s profile (shared org_a membership)'
); -- 18

select is(
  (select count(*)::int from public.users where id = '22222222-2222-2222-2222-222222222222'),
  0,
  'owner_a cannot see owner_b''s profile (no shared org)'
); -- 19

select lives_ok(
  $$ update public.users set full_name = 'Owner A' where id = '11111111-1111-1111-1111-111111111111' $$,
  'owner_a can update their own full_name'
); -- 20

-- Column-level privilege revoke raises an error immediately (checked before
-- row filtering), unlike a plain RLS USING exclusion.
select throws_ok(
  $$ update public.users set is_platform_admin = true where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501',
  null,
  'owner_a cannot set their own is_platform_admin (column-level UPDATE privilege revoked)'
); -- 21

select is(
  (select is_platform_admin from public.users where id = '11111111-1111-1111-1111-111111111111'),
  false,
  'is_platform_admin remains false after the blocked update attempt'
); -- 22

-- ---------------------------------------------------------------------------
-- Leaving / revoking membership
-- ---------------------------------------------------------------------------
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ delete from public.memberships
     where user_id = '33333333-3333-3333-3333-333333333333'
       and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'engineer_x can delete their own membership (leave org_a)'
); -- 23

-- owner_b is not a member/owner of org_a, so DELETE's USING clause excludes
-- owner_a's membership row entirely: silently 0 rows affected, no error.
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

delete from public.memberships
 where user_id = '11111111-1111-1111-1111-111111111111'
   and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- Verify from owner_a's own session (who can see their own row regardless)
-- that the row is still there.
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.memberships
   where user_id = '11111111-1111-1111-1111-111111111111'
     and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'owner_b cannot delete owner_a''s membership in org_a (DELETE silently excluded by RLS); row still present'
); -- 24

select * from finish();
rollback;
