-- pgTAP RLS tests for the `invites` table + `get_invite_by_token` /
-- `redeem_invite` SECURITY DEFINER functions (issue #3/#4).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- NOT executed in this environment (no local Docker) — written to the same
-- conventions as
-- supabase/tests/database/organizations_memberships_rls.test.sql and
-- flagged for qa-reviewer / whoever next has Docker available to actually
-- run `supabase test db` before this ships.

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('a2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('a3333333-3333-3333-3333-333333333333', 'invitee@test.local'),
  ('a4444444-4444-4444-4444-444444444444', 'wrong-account@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Bootstrap org_a with owner_a as owner, then add planner_a as a plain
-- (non-owner) member.
select pg_temp.act_as('a1111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('c0000000-0000-0000-0000-00000000000a', 'Org A', 'a1111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role)
values ('a1111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 'owner');

insert into public.memberships (user_id, organization_id, role)
values ('a2222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-00000000000a', 'planner');

-- ---------------------------------------------------------------------------
-- Only an owner can create an invite
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.invites (organization_id, email, role, invited_by)
     values ('c0000000-0000-0000-0000-00000000000a', 'invitee@test.local', 'engineer', 'a1111111-1111-1111-1111-111111111111') $$,
  'owner_a can create an invite for org_a'
); -- 1

select pg_temp.act_as('a2222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.invites (organization_id, email, role, invited_by)
     values ('c0000000-0000-0000-0000-00000000000a', 'someone-else@test.local', 'engineer', 'a2222222-2222-2222-2222-222222222222') $$,
  '42501',
  null,
  'planner_a (non-owner) cannot create an invite for org_a'
); -- 2

-- planner_a (non-owner) cannot see org_a's invites either.
select is(
  (select count(*)::int from public.invites where organization_id = 'c0000000-0000-0000-0000-00000000000a'),
  0,
  'planner_a (non-owner) cannot SELECT org_a''s invites'
); -- 3

-- ---------------------------------------------------------------------------
-- Owner can see the invite; column-level lockdown prevents spoofing
-- accepted_at/token on insert
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.invites where organization_id = 'c0000000-0000-0000-0000-00000000000a'),
  1,
  'owner_a can SELECT the invite they created'
); -- 4

select throws_ok(
  $$ insert into public.invites (organization_id, email, role, invited_by, accepted_at)
     values ('c0000000-0000-0000-0000-00000000000a', 'x@test.local', 'engineer', 'a1111111-1111-1111-1111-111111111111', now()) $$,
  '42501',
  null,
  'owner_a cannot set accepted_at directly on insert (column-level grant withheld)'
); -- 5

-- ---------------------------------------------------------------------------
-- get_invite_by_token: token-gated lookup, works for any authenticated
-- caller (and would work for anon too — not exercised here since pgTAP's
-- role-switch fixture only covers `authenticated`).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.get_invite_by_token(
    (select token from public.invites where email = 'invitee@test.local' and organization_id = 'c0000000-0000-0000-0000-00000000000a')
  )),
  1,
  'get_invite_by_token resolves the invite for a correct token'
); -- 6

select is(
  (select organization_name from public.get_invite_by_token(
    (select token from public.invites where email = 'invitee@test.local' and organization_id = 'c0000000-0000-0000-0000-00000000000a')
  )),
  'Org A',
  'get_invite_by_token returns the organization name'
); -- 7

select is(
  (select count(*)::int from public.get_invite_by_token('00000000-0000-0000-0000-000000000000')),
  0,
  'get_invite_by_token returns zero rows for an unknown token'
); -- 8

-- ---------------------------------------------------------------------------
-- redeem_invite: email must match the caller's own account
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a4444444-4444-4444-4444-444444444444');

select throws_ok(
  $$ select public.redeem_invite(
       (select token from public.invites where email = 'invitee@test.local' and organization_id = 'c0000000-0000-0000-0000-00000000000a')
     ) $$,
  '28000',
  null,
  'redeem_invite rejects a caller whose account email does not match the invite email'
); -- 9

select is(
  (select count(*)::int from public.memberships
   where user_id = 'a4444444-4444-4444-4444-444444444444'
     and organization_id = 'c0000000-0000-0000-0000-00000000000a'),
  0,
  'no membership was created for the mismatched-email caller'
); -- 10

-- ---------------------------------------------------------------------------
-- redeem_invite: happy path
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a3333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ select public.redeem_invite(
       (select token from public.invites where email = 'invitee@test.local' and organization_id = 'c0000000-0000-0000-0000-00000000000a')
     ) $$,
  'invitee can redeem their own invite'
); -- 11

select is(
  (select role::text from public.memberships
   where user_id = 'a3333333-3333-3333-3333-333333333333'
     and organization_id = 'c0000000-0000-0000-0000-00000000000a'),
  'engineer',
  'redeem_invite created a membership with the role from the invite'
); -- 12

select is(
  (select accepted_at is not null from public.invites
   where email = 'invitee@test.local' and organization_id = 'c0000000-0000-0000-0000-00000000000a'),
  true,
  'redeem_invite marked the invite accepted'
); -- 13

-- ---------------------------------------------------------------------------
-- redeem_invite: cannot reuse an already-accepted invite
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.redeem_invite(
       (select token from public.invites where email = 'invitee@test.local' and organization_id = 'c0000000-0000-0000-0000-00000000000a')
     ) $$,
  '22023',
  null,
  'redeem_invite rejects an already-accepted invite'
); -- 14

-- ---------------------------------------------------------------------------
-- redeem_invite: expired invite is rejected
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a1111111-1111-1111-1111-111111111111');

insert into public.invites (organization_id, email, role, invited_by)
values ('c0000000-0000-0000-0000-00000000000a', 'expired@test.local', 'finance', 'a1111111-1111-1111-1111-111111111111');

-- Force-expire it. `force row level security` doesn't block the migration
-- role (superuser bypasses RLS regardless); this direct UPDATE simulates
-- time passing rather than exercising RLS.
reset role;
update public.invites set expires_at = now() - interval '1 hour'
where email = 'expired@test.local' and organization_id = 'c0000000-0000-0000-0000-00000000000a';

insert into auth.users (id, email) values ('a5555555-5555-5555-5555-555555555555', 'expired@test.local');
select pg_temp.act_as('a5555555-5555-5555-5555-555555555555');

select throws_ok(
  $$ select public.redeem_invite(
       (select token from public.invites where email = 'expired@test.local' and organization_id = 'c0000000-0000-0000-0000-00000000000a')
     ) $$,
  '22023',
  null,
  'redeem_invite rejects an expired invite'
); -- 15

-- ---------------------------------------------------------------------------
-- invites_delete_owner
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a1111111-1111-1111-1111-111111111111');

delete from public.invites
where email = 'expired@test.local' and organization_id = 'c0000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.invites where email = 'expired@test.local'),
  0,
  'owner_a can delete a pending invite for org_a'
); -- 16

select * from finish();
rollback;
