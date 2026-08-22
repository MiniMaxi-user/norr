-- pgTAP RLS tests for clients / sites / assets (issue #7).
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
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error — the row is silently excluded (0 rows changed). Only
-- INSERT/UPDATE `WITH CHECK` violations (and column-level privilege
-- revokes) raise error 42501. Cross-organization re-parent attempts raise
-- 23514 (from derive_site_organization_id / derive_asset_org_and_client)
-- rather than 42501.

begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

-- ---------------------------------------------------------------------------
-- Fixtures: two orgs, each with an owner + a non-owner member (planner)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('b1111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('b2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('b3333333-3333-3333-3333-333333333333', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Bootstrap org_a (owner_a as owner, planner_a as a plain member) and org_b
-- (owner_b as owner), using the already-implemented organizations/memberships
-- bootstrap policies.
select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('d0000000-0000-0000-0000-00000000000a', 'Org A', 'b1111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role)
values ('b1111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-00000000000a', 'owner');

insert into public.memberships (user_id, organization_id, role)
values ('b2222222-2222-2222-2222-222222222222', 'd0000000-0000-0000-0000-00000000000a', 'planner');

select pg_temp.act_as('b3333333-3333-3333-3333-333333333333');

insert into public.organizations (id, name, created_by)
values ('d0000000-0000-0000-0000-00000000000b', 'Org B', 'b3333333-3333-3333-3333-333333333333');

insert into public.memberships (user_id, organization_id, role)
values ('b3333333-3333-3333-3333-333333333333', 'd0000000-0000-0000-0000-00000000000b', 'owner');

-- ---------------------------------------------------------------------------
-- clients: owner can CRUD, planner (non-owner) can only read
-- ---------------------------------------------------------------------------
select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.clients (id, organization_id, name, email)
     values ('e0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000a', 'Client A', 'client-a@test.local') $$,
  'owner_a can insert a client into org_a'
); -- 1

select is(
  (select created_by from public.clients where id = 'e0000000-0000-0000-0000-00000000000a'),
  'b1111111-1111-1111-1111-111111111111'::uuid,
  'clients.created_by was auto-stamped to the inserting user (trigger), not client-supplied'
); -- 2

select throws_ok(
  $$ insert into public.clients (organization_id, name, created_by)
     values ('d0000000-0000-0000-0000-00000000000a', 'Spoofed', '00000000-0000-0000-0000-000000000000') $$,
  '42501',
  null,
  'owner_a cannot set created_by directly on insert (column-level grant withheld)'
); -- 3

select pg_temp.act_as('b2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.clients where organization_id = 'd0000000-0000-0000-0000-00000000000a'),
  1,
  'planner_a (non-owner member) can SELECT clients in org_a (read for all members)'
); -- 4

select throws_ok(
  $$ insert into public.clients (organization_id, name)
     values ('d0000000-0000-0000-0000-00000000000a', 'Planner Client') $$,
  '42501',
  null,
  'planner_a (non-owner) cannot INSERT a client (RLS owner-only backstop)'
); -- 5

update public.clients set name = 'Hijacked' where id = 'e0000000-0000-0000-0000-00000000000a';

select is(
  (select name from public.clients where id = 'e0000000-0000-0000-0000-00000000000a'),
  'Client A',
  'planner_a''s UPDATE on the client is silently excluded by RLS (USING); name unchanged'
); -- 6

-- Cross-tenant isolation
select pg_temp.act_as('b3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.clients where organization_id = 'd0000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s clients'
); -- 7

-- ---------------------------------------------------------------------------
-- sites: organization_id is derived from client_id, not client-writable
-- ---------------------------------------------------------------------------
select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.sites (id, client_id, name, city)
     values ('f0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000a', 'Main Site', 'Amsterdam') $$,
  'owner_a can insert a site under client A (org_a)'
); -- 8

select is(
  (select organization_id from public.sites where id = 'f0000000-0000-0000-0000-00000000000a'),
  'd0000000-0000-0000-0000-00000000000a'::uuid,
  'sites.organization_id was auto-derived from clients.organization_id via client_id'
); -- 9

select throws_ok(
  $$ insert into public.sites (client_id, name, organization_id)
     values ('e0000000-0000-0000-0000-00000000000a', 'Spoofed Site', 'd0000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_a cannot set sites.organization_id directly on insert (column-level grant withheld)'
); -- 10

-- planner_a (non-owner) can read but not write sites
select pg_temp.act_as('b2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.sites where organization_id = 'd0000000-0000-0000-0000-00000000000a'),
  1,
  'planner_a (non-owner member) can SELECT sites in org_a'
); -- 11

select throws_ok(
  $$ insert into public.sites (client_id, name)
     values ('e0000000-0000-0000-0000-00000000000a', 'Planner Site') $$,
  '42501',
  null,
  'planner_a (non-owner) cannot INSERT a site (RLS owner-only backstop)'
); -- 12

-- Cross-tenant isolation + cross-org re-parent guard
select pg_temp.act_as('b3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.sites where organization_id = 'd0000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s sites'
); -- 13

select throws_ok(
  $$ insert into public.sites (client_id, name)
     values ('e0000000-0000-0000-0000-00000000000a', 'Hostile Reparent Attempt') $$,
  '42501',
  null,
  'owner_b cannot insert a site under org_a''s client (not is_org_owner of org_a; USING/CHECK on the derived organization_id blocks it)'
); -- 14

-- Cross-organization re-parent guard: owner_a owns org_a and is (per USING)
-- allowed to attempt the UPDATE, but the derive trigger must refuse to move
-- the site onto a client belonging to a *different* organization.
select pg_temp.act_as('b3333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ insert into public.clients (id, organization_id, name)
     values ('e0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000b', 'Client B') $$,
  'owner_b can insert a client into org_b (fixture for re-parent guard test)'
); -- 15

select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ update public.sites set client_id = 'e0000000-0000-0000-0000-00000000000b' where id = 'f0000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'owner_a cannot re-parent org_a''s site onto org_b''s client (cross-organization move blocked by derive_site_organization_id trigger)'
); -- 16

select is(
  (select organization_id from public.sites where id = 'f0000000-0000-0000-0000-00000000000a'),
  'd0000000-0000-0000-0000-00000000000a'::uuid,
  'site''s organization_id is unchanged after the blocked re-parent attempt'
); -- 17

-- ---------------------------------------------------------------------------
-- assets: client_id + organization_id are both derived from site_id
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.assets (id, site_id, name, type, serial_number)
     values ('a0000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a', 'Boiler 1', 'boiler', 'SN-001') $$,
  'owner_a can insert an asset under site f0000000... (org_a)'
); -- 18

select is(
  (select client_id from public.assets where id = 'a0000000-0000-0000-0000-00000000000a'),
  'e0000000-0000-0000-0000-00000000000a'::uuid,
  'assets.client_id was auto-derived from sites.client_id via site_id'
); -- 19

select is(
  (select organization_id from public.assets where id = 'a0000000-0000-0000-0000-00000000000a'),
  'd0000000-0000-0000-0000-00000000000a'::uuid,
  'assets.organization_id was auto-derived from sites.organization_id via site_id'
); -- 20

select is(
  (select status::text from public.assets where id = 'a0000000-0000-0000-0000-00000000000a'),
  'active',
  'assets.status defaults to active'
); -- 21

select throws_ok(
  $$ insert into public.assets (site_id, name, type, client_id)
     values ('f0000000-0000-0000-0000-00000000000a', 'Spoofed Asset', 'boiler', 'e0000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_a cannot set assets.client_id directly on insert (column-level grant withheld)'
); -- 22

-- planner_a (non-owner) can read but not write assets (per RLS backstop;
-- app-layer RBAC differentiates planner read/update separately)
select pg_temp.act_as('b2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.assets where organization_id = 'd0000000-0000-0000-0000-00000000000a'),
  1,
  'planner_a (non-owner member) can SELECT assets in org_a'
); -- 23

select throws_ok(
  $$ update public.assets set status = 'decommissioned' where id = 'a0000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'planner_a cannot UPDATE an asset directly via RLS (owner-only backstop; finer planner grants are app-layer, not RLS, in v1)'
); -- 24

-- Cross-tenant isolation for assets
select pg_temp.act_as('b3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.assets where organization_id = 'd0000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s assets'
); -- 25

select throws_ok(
  $$ insert into public.assets (site_id, name, type)
     values ('f0000000-0000-0000-0000-00000000000a', 'Hostile Asset', 'boiler') $$,
  '42501',
  null,
  'owner_b cannot insert an asset under org_a''s site (not is_org_owner of org_a)'
); -- 26

-- ---------------------------------------------------------------------------
-- owner CRUD: update + delete happy path
-- ---------------------------------------------------------------------------
select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ update public.assets set status = 'decommissioned' where id = 'a0000000-0000-0000-0000-00000000000a' $$,
  'owner_a can update an asset in org_a'
); -- 27

select lives_ok(
  $$ delete from public.assets where id = 'a0000000-0000-0000-0000-00000000000a' $$,
  'owner_a can delete an asset in org_a'
); -- 28

select lives_ok(
  $$ delete from public.sites where id = 'f0000000-0000-0000-0000-00000000000a' $$,
  'owner_a can delete a site in org_a'
); -- 29

select * from finish();
rollback;
