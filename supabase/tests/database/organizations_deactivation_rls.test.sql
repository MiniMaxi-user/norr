-- pgTAP RLS tests for tenant activate/deactivate (issue #47):
-- `organizations.is_active` and the resulting `is_member_of_org`/
-- `is_org_owner` behavior change, added in
-- supabase/migrations/20260826120000_organizations_is_active.sql.
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/organizations_memberships_rls.test.sql: switch to
-- the `authenticated` role and set `request.jwt.claims` to simulate
-- auth.uid() for a given fixture user. All auth.users rows here are test
-- fixtures, rolled back at the end of the transaction.
--
-- `is_active` is flipped directly (as the migration/test role, which
-- bypasses RLS) rather than through any RLS-gated UPDATE path, mirroring
-- how the real deactivate/reactivate action will work: the Platform Admin
-- is never a member of the tenant org being toggled, so that future action
-- necessarily uses the service-role client (bypasses RLS entirely), exactly
-- like every other Platform Admin cross-tenant write in this codebase. This
-- file only asserts what RLS does *given* `is_active`'s value, not who is
-- allowed to change it.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error — the row is silently excluded (0 rows changed). Only
-- INSERT `WITH CHECK` violations raise error 42501.

begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a (owner_a = creator/owner, planner_a = non-creator member),
-- org_b (owner_b, untouched control), one client row in org_a.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('c2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('c3333333-3333-3333-3333-333333333333', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('c1111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('f0000000-0000-0000-0000-00000000000a', 'Org A', 'c1111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role)
values ('c1111111-1111-1111-1111-111111111111', 'f0000000-0000-0000-0000-00000000000a', 'owner');

insert into public.memberships (user_id, organization_id, role)
values ('c2222222-2222-2222-2222-222222222222', 'f0000000-0000-0000-0000-00000000000a', 'planner');

insert into public.clients (id, organization_id, name)
values ('f1000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a', 'Client A');

select pg_temp.act_as('c3333333-3333-3333-3333-333333333333');

insert into public.organizations (id, name, created_by)
values ('f0000000-0000-0000-0000-00000000000b', 'Org B', 'c3333333-3333-3333-3333-333333333333');

insert into public.memberships (user_id, organization_id, role)
values ('c3333333-3333-3333-3333-333333333333', 'f0000000-0000-0000-0000-00000000000b', 'owner');

-- ---------------------------------------------------------------------------
-- Baseline (org_a still active): planner_a (non-creator member) can see
-- org_a, its client, and the membership roster.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');

select is(
  (select is_active from public.organizations where id = 'f0000000-0000-0000-0000-00000000000a'),
  true,
  'sanity: org_a defaults to is_active = true'
); -- 1

select is(
  (select count(*)::int from public.organizations where id = 'f0000000-0000-0000-0000-00000000000a'),
  1,
  'baseline: planner_a (non-creator member) can SELECT org_a while active'
); -- 2

select is(
  (select count(*)::int from public.clients where id = 'f1000000-0000-0000-0000-00000000000a'),
  1,
  'baseline: planner_a can SELECT client A while org_a is active'
); -- 3

select is(
  (select count(*)::int from public.memberships where organization_id = 'f0000000-0000-0000-0000-00000000000a'),
  2,
  'baseline: planner_a can SELECT both membership rows (self + owner_a) in org_a while active'
); -- 4

-- ---------------------------------------------------------------------------
-- Deactivate org_a (bypasses RLS, same as the real service-role toggle).
-- ---------------------------------------------------------------------------
reset role;
update public.organizations set is_active = false where id = 'f0000000-0000-0000-0000-00000000000a';

-- ---------------------------------------------------------------------------
-- planner_a (non-creator member): everything in org_a becomes invisible.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.organizations where id = 'f0000000-0000-0000-0000-00000000000a'),
  0,
  'deactivated: planner_a (non-creator) can no longer SELECT org_a (is_member_of_org now false)'
); -- 5

select is(
  (select count(*)::int from public.clients where id = 'f1000000-0000-0000-0000-00000000000a'),
  0,
  'deactivated: planner_a can no longer SELECT client A (clients_select_member -> is_member_of_org)'
); -- 6

select is(
  (select count(*)::int from public.memberships where organization_id = 'f0000000-0000-0000-0000-00000000000a'),
  0,
  'deactivated: planner_a can no longer SELECT any membership row in org_a, including their own (self-visibility branch also gated on is_active)'
); -- 7

select throws_ok(
  $$ insert into public.clients (id, organization_id, name)
     values ('f1000000-0000-0000-0000-00000000000c', 'f0000000-0000-0000-0000-00000000000a', 'Client C') $$,
  '42501',
  null,
  'deactivated: planner_a cannot insert a client into org_a (not owner anyway, and is_org_owner is now false regardless)'
); -- 8

-- ---------------------------------------------------------------------------
-- owner_a (creator + owner of org_a): the organizations row itself stays
-- visible via the creator branch (unaffected by is_active), but every
-- is_member_of_org/is_org_owner-gated read/write is blocked, including
-- owner_a's own membership row.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.organizations where id = 'f0000000-0000-0000-0000-00000000000a'),
  1,
  'deactivated: owner_a (creator) can still SELECT the org_a row itself (created_by branch unaffected by is_active)'
); -- 9

select is(
  (select is_active from public.organizations where id = 'f0000000-0000-0000-0000-00000000000a'),
  false,
  'owner_a can observe org_a.is_active = false via the still-working creator-visibility branch'
); -- 10

select is(
  (select count(*)::int from public.clients where id = 'f1000000-0000-0000-0000-00000000000a'),
  0,
  'deactivated: owner_a can no longer SELECT client A (is_member_of_org now false, even for the creator)'
); -- 11

select is(
  (select count(*)::int from public.memberships
   where organization_id = 'f0000000-0000-0000-0000-00000000000a'
     and user_id = 'c1111111-1111-1111-1111-111111111111'),
  0,
  'deactivated: owner_a can no longer SELECT even their own membership row in org_a (self-visibility branch gated on is_active)'
); -- 12

-- UPDATE's USING clause (is_org_owner) excludes the row now that org_a is
-- inactive, so this silently affects 0 rows rather than raising.
update public.clients set name = 'Should not apply' where id = 'f1000000-0000-0000-0000-00000000000a';

reset role;

select is(
  (select name from public.clients where id = 'f1000000-0000-0000-0000-00000000000a'),
  'Client A',
  'deactivated: owner_a''s UPDATE on client A is silently excluded by RLS (is_org_owner now false); name unchanged'
); -- 13

-- ---------------------------------------------------------------------------
-- Control: org_b (never touched) is completely unaffected throughout.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.organizations where id = 'f0000000-0000-0000-0000-00000000000b'),
  1,
  'control: owner_b can still SELECT org_b throughout (never deactivated)'
); -- 14

select is(
  (select is_active from public.organizations where id = 'f0000000-0000-0000-0000-00000000000b'),
  true,
  'control: org_b.is_active remains true throughout'
); -- 15

-- ---------------------------------------------------------------------------
-- Reactivate org_a: access is fully restored for both owner_a and
-- planner_a, with zero other state change (no membership rows lost).
-- ---------------------------------------------------------------------------
reset role;
update public.organizations set is_active = true where id = 'f0000000-0000-0000-0000-00000000000a';

select pg_temp.act_as('c1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.clients where id = 'f1000000-0000-0000-0000-00000000000a'),
  1,
  'reactivated: owner_a can SELECT client A again'
); -- 16

select is(
  (select count(*)::int from public.memberships where organization_id = 'f0000000-0000-0000-0000-00000000000a'),
  2,
  'reactivated: owner_a can SELECT both membership rows again (neither was lost by deactivate/reactivate)'
); -- 17

select lives_ok(
  $$ update public.clients set name = 'Client A (renamed)' where id = 'f1000000-0000-0000-0000-00000000000a' $$,
  'reactivated: owner_a can UPDATE client A again (is_org_owner restored)'
); -- 18

select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.organizations where id = 'f0000000-0000-0000-0000-00000000000a'),
  1,
  'reactivated: planner_a (non-creator) can SELECT org_a again'
); -- 19

select is(
  (select count(*)::int from public.memberships
   where organization_id = 'f0000000-0000-0000-0000-00000000000a'
     and user_id = 'c2222222-2222-2222-2222-222222222222'),
  1,
  'reactivated: planner_a can SELECT their own membership row again'
); -- 20

select * from finish();
rollback;
