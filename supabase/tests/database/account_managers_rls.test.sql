-- pgTAP RLS tests for account_managers (issue #58,
-- 20260827090000_account_managers.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/asset_brand_and_models_rls.test.sql (same
-- "select: any member, write: owner only" RLS shape this table copies from
-- asset_models): switch to the `authenticated` role and set
-- `request.jwt.claims` to simulate auth.uid() for a given fixture user. All
-- auth.users rows here are test fixtures, rolled back at the end of the
-- transaction.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error -- the row is silently excluded (0 rows changed). Only
-- INSERT/UPDATE `WITH CHECK` violations (and column-level privilege
-- revokes) raise error 42501.

begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- ---------------------------------------------------------------------------
-- Fixtures: two orgs, each with an owner; org_a also has a non-owner member
-- (planner).
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
values ('c0000000-0000-0000-0000-00000000000a', 'Org A', 'c1111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role)
values ('c1111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 'owner');

insert into public.memberships (user_id, organization_id, role)
values ('c2222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-00000000000a', 'planner');

select pg_temp.act_as('c3333333-3333-3333-3333-333333333333');

insert into public.organizations (id, name, created_by)
values ('c0000000-0000-0000-0000-00000000000b', 'Org B', 'c3333333-3333-3333-3333-333333333333');

insert into public.memberships (user_id, organization_id, role)
values ('c3333333-3333-3333-3333-333333333333', 'c0000000-0000-0000-0000-00000000000b', 'owner');

-- ---------------------------------------------------------------------------
-- 1. owner CRUD + created_by stamping
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.account_managers (id, organization_id, first_name, last_name)
     values ('c4000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', 'Anna', 'Bakker') $$,
  'owner_a can insert an account_manager into org_a'
); -- 1

select is(
  (select created_by from public.account_managers where id = 'c4000000-0000-0000-0000-00000000000a'),
  'c1111111-1111-1111-1111-111111111111'::uuid,
  'account_managers.created_by was auto-stamped to the inserting user (trigger), not client-supplied'
); -- 2

select throws_ok(
  $$ insert into public.account_managers (organization_id, first_name, last_name, created_by)
     values ('c0000000-0000-0000-0000-00000000000a', 'Spoofed', 'Person', '00000000-0000-0000-0000-000000000000') $$,
  '42501',
  null,
  'owner_a cannot set created_by directly on insert (column-level grant withheld)'
); -- 3

select lives_ok(
  $$ update public.account_managers set last_name = 'De Vries' where id = 'c4000000-0000-0000-0000-00000000000a' $$,
  'owner_a can update an account_manager''s last_name'
); -- 4

select is(
  (select last_name from public.account_managers where id = 'c4000000-0000-0000-0000-00000000000a'),
  'De Vries',
  'the update was persisted'
); -- 5

select throws_ok(
  $$ update public.account_managers set organization_id = 'c0000000-0000-0000-0000-00000000000b' where id = 'c4000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'owner_a cannot move an account_manager to a different organization via UPDATE (organization_id excluded from the UPDATE column grant entirely)'
); -- 6

-- ---------------------------------------------------------------------------
-- 2. RLS: non-owner (planner_a) can read but not write; cross-tenant
--    isolation.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.account_managers where organization_id = 'c0000000-0000-0000-0000-00000000000a'),
  1,
  'planner_a (non-owner member) can SELECT org_a''s account_managers'
); -- 7

select throws_ok(
  $$ insert into public.account_managers (organization_id, first_name, last_name)
     values ('c0000000-0000-0000-0000-00000000000a', 'Planner', 'Insert') $$,
  '42501',
  null,
  'planner_a (non-owner) cannot INSERT an account_manager (RLS owner-only backstop)'
); -- 8

update public.account_managers set first_name = 'Hijacked' where id = 'c4000000-0000-0000-0000-00000000000a';

select is(
  (select first_name from public.account_managers where id = 'c4000000-0000-0000-0000-00000000000a'),
  'Anna',
  'planner_a''s UPDATE on an account_manager is silently excluded by RLS (USING); first_name unchanged'
); -- 9

select pg_temp.act_as('c3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.account_managers where organization_id = 'c0000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s account_managers'
); -- 10

select throws_ok(
  $$ insert into public.account_managers (organization_id, first_name, last_name)
     values ('c0000000-0000-0000-0000-00000000000a', 'Hostile', 'Insert') $$,
  '42501',
  null,
  'owner_b cannot insert an account_manager into org_a (not is_org_owner of org_a)'
); -- 11

select is(
  (select count(*)::int from public.account_managers where organization_id = 'c0000000-0000-0000-0000-00000000000b'),
  0,
  'owner_b''s own org_b independently has zero account_managers (isolation, not shared rows)'
); -- 12

-- ---------------------------------------------------------------------------
-- 3. owner delete happy path
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ delete from public.account_managers where id = 'c4000000-0000-0000-0000-00000000000a' $$,
  'owner_a can delete an account_manager in org_a'
); -- 13

select * from finish();
rollback;
