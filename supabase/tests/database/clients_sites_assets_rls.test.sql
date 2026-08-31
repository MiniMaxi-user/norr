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

select plan(93);

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
  $$ insert into public.clients (id, organization_id, name)
     values ('e0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000a', 'Client A') $$,
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
  $$ insert into public.sites (id, client_id, city, is_visit_address)
     values ('f0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000a', 'Amsterdam', true) $$,
  'owner_a can insert a site under client A (org_a)'
); -- 8

select is(
  (select organization_id from public.sites where id = 'f0000000-0000-0000-0000-00000000000a'),
  'd0000000-0000-0000-0000-00000000000a'::uuid,
  'sites.organization_id was auto-derived from clients.organization_id via client_id'
); -- 9

select throws_ok(
  $$ insert into public.sites (client_id, organization_id, is_visit_address)
     values ('e0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000a', true) $$,
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
  $$ insert into public.sites (client_id, is_visit_address)
     values ('e0000000-0000-0000-0000-00000000000a', true) $$,
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
  $$ insert into public.sites (client_id, is_visit_address)
     values ('e0000000-0000-0000-0000-00000000000a', true) $$,
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
-- assets: client_id + organization_id are both derived from site_id.
-- type_id/status_id (added in 20260822200000_reference_lists.sql) are FKs
-- into that org's auto-seeded reference_list_items — org_a already has an
-- 'asset_type' list (with a 'hvac' item) and an 'asset_status' list (with a
-- default 'active' item) from the organizations_seed_reference_lists
-- trigger that fired when org_a was created above.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.assets (id, site_id, name, type_id, serial_number)
     values (
       'a0000000-0000-0000-0000-00000000000a',
       'f0000000-0000-0000-0000-00000000000a',
       'Boiler 1',
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'd0000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'asset_type' and rli.value = 'hvac'),
       'SN-001'
     ) $$,
  'owner_a can insert an asset under site f0000000... (org_a), type_id resolved from org_a''s seeded asset_type list'
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
  (select rli.value
     from public.assets a
     join public.reference_list_items rli on rli.id = a.status_id
     where a.id = 'a0000000-0000-0000-0000-00000000000a'),
  'active',
  'assets.status_id defaults to the org''s default asset_status item (value=active) when omitted on insert'
); -- 21

select throws_ok(
  $$ insert into public.assets (site_id, name, type_id, client_id)
     values (
       'f0000000-0000-0000-0000-00000000000a', 'Spoofed Asset',
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'd0000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'asset_type' and rli.value = 'hvac'),
       'e0000000-0000-0000-0000-00000000000a'
     ) $$,
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
  $$ update public.assets set status_id = (
       select rli.id from public.reference_list_items rli
         join public.reference_lists rl on rl.id = rli.reference_list_id
         where rl.organization_id = 'd0000000-0000-0000-0000-00000000000a'
           and rl.list_key = 'asset_status' and rli.value = 'decommissioned'
     ) where id = 'a0000000-0000-0000-0000-00000000000a' $$,
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
  $$ update public.assets set status_id = (
       select rli.id from public.reference_list_items rli
         join public.reference_lists rl on rl.id = rli.reference_list_id
         where rl.organization_id = 'd0000000-0000-0000-0000-00000000000a'
           and rl.list_key = 'asset_status' and rli.value = 'decommissioned'
     ) where id = 'a0000000-0000-0000-0000-00000000000a' $$,
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

-- ---------------------------------------------------------------------------
-- sites: purpose-flag CHECK, is_primary auto-unset/uniqueness, and legacy
-- clients.address_* columns dropped (issue #41 redo, "Sites as client
-- addresses" — supabase/migrations/20260825090000_sites_addresses.sql).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ insert into public.sites (client_id, is_visit_address, is_invoice_address, is_delivery_address)
     values ('e0000000-0000-0000-0000-00000000000a', false, false, false) $$,
  '23514',
  null,
  'a site with all three purpose flags false violates sites_at_least_one_purpose'
); -- 30

select lives_ok(
  $$ insert into public.sites (id, client_id, is_visit_address, is_primary)
     values ('f0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-00000000000a', true, true) $$,
  'owner_a can insert a primary site (address 1) under client A'
); -- 31

select lives_ok(
  $$ insert into public.sites (id, client_id, is_invoice_address, is_primary)
     values ('f0000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-00000000000a', true, true) $$,
  'owner_a can insert a second primary site (address 2) under client A'
); -- 32

select is(
  (select is_primary from public.sites where id = 'f0000000-0000-0000-0000-00000000000b'),
  false,
  'inserting a new primary site (address 2) auto-unset the previous primary (address 1) via enforce_single_primary_site'
); -- 33

select is(
  (select count(*)::int from public.sites where client_id = 'e0000000-0000-0000-0000-00000000000a' and is_primary),
  1,
  'exactly one primary site remains for client A after the second primary insert (sites_one_primary_per_client_idx never violated)'
); -- 34

select lives_ok(
  $$ update public.sites set is_primary = true where id = 'f0000000-0000-0000-0000-00000000000b' $$,
  'owner_a can re-promote address 1 back to primary via UPDATE'
); -- 35

select is(
  (select is_primary from public.sites where id = 'f0000000-0000-0000-0000-00000000000c'),
  false,
  'the UPDATE-path re-promotion also auto-unset address 2''s is_primary (enforce_single_primary_site fires on UPDATE OF is_primary too)'
); -- 36

select throws_ok(
  $$ insert into public.clients (organization_id, name, address_line1)
     values ('d0000000-0000-0000-0000-00000000000a', 'Legacy Address Client', '123 Old Street') $$,
  '42703',
  null,
  'clients.address_line1 no longer exists (dropped by 20260825090000_sites_addresses.sql; sites is now the sole client-address model)'
); -- 37

-- ---------------------------------------------------------------------------
-- sites: visit_contact_id / delivery_contact_id / invoice_contact_id (issue
-- #52, supabase/migrations/20260826150000_sites_contact_persons.sql).
-- Requires a second client under org_a (so we can distinguish "same
-- organization, different client" from "different organization" when
-- exercising validate_site_contact_persons) and a contacts fixture per
-- client.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.clients (id, organization_id, name)
     values ('e0000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-00000000000a', 'Client A2') $$,
  'owner_a can insert a second client (Client A2) into org_a (fixture for site-contact same-org/different-client test)'
); -- 38

select lives_ok(
  $$ insert into public.contacts (id, client_id, name)
     values ('c1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000a', 'Contact A1') $$,
  'owner_a can insert a contact under Client A'
); -- 39

select lives_ok(
  $$ insert into public.contacts (id, client_id, name)
     values ('c1000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000000c', 'Contact A2') $$,
  'owner_a can insert a contact under Client A2 (different client, same org_a)'
); -- 40

select pg_temp.act_as('b3333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ insert into public.contacts (id, client_id, name)
     values ('c1000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-00000000000b', 'Contact B1') $$,
  'owner_b can insert a contact under Client B (org_b)'
); -- 41

select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.sites (id, client_id, is_visit_address, is_delivery_address, is_invoice_address,
       visit_contact_id, delivery_contact_id, invoice_contact_id)
     values ('f0000000-0000-0000-0000-00000000000d', 'e0000000-0000-0000-0000-00000000000a', true, true, true,
       'c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001') $$,
  'owner_a can insert a Client A site with visit/delivery/invoice_contact_id all set to Contact A1 (same client)'
); -- 42

select is(
  (select visit_contact_id from public.sites where id = 'f0000000-0000-0000-0000-00000000000d'),
  'c1000000-0000-0000-0000-000000000001'::uuid,
  'the new site''s visit_contact_id was persisted as Contact A1'
); -- 43

select throws_ok(
  $$ insert into public.sites (client_id, is_visit_address, visit_contact_id)
     values ('e0000000-0000-0000-0000-00000000000a', true, 'c1000000-0000-0000-0000-000000000002') $$,
  '23514',
  null,
  'a Client A site cannot use Contact A2 (Client A2''s contact — same organization, different client) as visit_contact_id (validate_site_contact_persons)'
); -- 44

select throws_ok(
  $$ insert into public.sites (client_id, is_delivery_address, delivery_contact_id)
     values ('e0000000-0000-0000-0000-00000000000a', true, 'c1000000-0000-0000-0000-000000000003') $$,
  '23514',
  null,
  'a Client A site cannot use Contact B1 (a different organization''s contact) as delivery_contact_id (validate_site_contact_persons)'
); -- 45

select lives_ok(
  $$ delete from public.contacts where id = 'c1000000-0000-0000-0000-000000000001' $$,
  'owner_a can delete Contact A1'
); -- 46

select is(
  (select visit_contact_id from public.sites where id = 'f0000000-0000-0000-0000-00000000000d'),
  null::uuid,
  'deleting Contact A1 cleared (not blocked, not cascade-deleted) the site''s visit_contact_id (on delete set null)'
); -- 47

select is(
  (select delivery_contact_id from public.sites where id = 'f0000000-0000-0000-0000-00000000000d'),
  null::uuid,
  'deleting Contact A1 also cleared the site''s delivery_contact_id'
); -- 48

select is(
  (select invoice_contact_id from public.sites where id = 'f0000000-0000-0000-0000-00000000000d'),
  null::uuid,
  'deleting Contact A1 also cleared the site''s invoice_contact_id'
); -- 49

select lives_ok(
  $$ insert into public.sites (id, client_id, is_invoice_address, invoice_contact_id)
     values ('f0000000-0000-0000-0000-00000000000e', 'e0000000-0000-0000-0000-00000000000c', true, 'c1000000-0000-0000-0000-000000000002') $$,
  'owner_a can insert a Client A2 site with invoice_contact_id = Contact A2 (same client)'
); -- 50

select throws_ok(
  $$ update public.sites set client_id = 'e0000000-0000-0000-0000-00000000000a' where id = 'f0000000-0000-0000-0000-00000000000e' $$,
  '23514',
  null,
  're-parenting the site from Client A2 to Client A is rejected because its invoice_contact_id (Contact A2) would no longer belong to the new client_id (validate_site_contact_persons re-checked on UPDATE OF client_id)'
); -- 51

-- ---------------------------------------------------------------------------
-- assets: brand_item_id / model_id (QA finding on issue #53,
-- supabase/migrations/20260826170000_assets_external_reference_brand_model.sql).
-- Same validate_asset_reference_items trigger already exercised above for
-- type_id/status_id (tests 18-26), extended with two more branches. Needs an
-- org_a asset_models fixture row (asset_models isn't auto-seeded, unlike
-- asset_type/asset_status/asset_brand — see
-- supabase/tests/database/asset_brand_and_models_rls.test.sql for that
-- table's own dedicated coverage) plus a captured org_b asset_brand item id
-- (a random uuid generated by the seed function, so it can't be hardcoded
-- like the asset_models fixture ids below) for the cross-org rejection
-- tests.
-- ---------------------------------------------------------------------------
create table pg_temp.brand_model_captured_ids (key text primary key, val uuid not null);
-- Explicit grant: a temp table created while running as the connecting
-- (superuser/owner) role is not automatically writable after `set local
-- role authenticated` — this table is written to below by both owner_a and
-- owner_b sessions (both simulated as `authenticated`), so it needs this
-- grant to remain insertable across those role switches, independent of
-- which role created it. (Confirmed live: the same captured-id pattern
-- without this grant fails 42501 "permission denied for table" under
-- `authenticated` once the creating session's role differs.)
grant all on pg_temp.brand_model_captured_ids to authenticated;

select pg_temp.act_as('b3333333-3333-3333-3333-333333333333');

insert into pg_temp.brand_model_captured_ids (key, val)
select 'org_b_asset_brand_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'd0000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'asset_brand' and rli.value = 'kyocera';

-- org_b asset_models fixture, for the cross-org model_id rejection test below.
insert into public.asset_models (id, organization_id, brand_item_id, type_item_id, name)
select
  'bb000000-0000-0000-0000-00000000000b',
  'd0000000-0000-0000-0000-00000000000b',
  brand.id, hvac.id, 'Org B Model'
from public.reference_list_items brand
join public.reference_lists brand_list on brand_list.id = brand.reference_list_id
join public.reference_list_items hvac on true
join public.reference_lists hvac_list on hvac_list.id = hvac.reference_list_id
where brand_list.organization_id = 'd0000000-0000-0000-0000-00000000000b'
  and brand_list.list_key = 'asset_brand' and brand.value = 'kyocera'
  and hvac_list.organization_id = 'd0000000-0000-0000-0000-00000000000b'
  and hvac_list.list_key = 'asset_type' and hvac.value = 'hvac';

select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.asset_models (id, organization_id, brand_item_id, type_item_id, name)
     select
       'bb000000-0000-0000-0000-00000000000a',
       'd0000000-0000-0000-0000-00000000000a',
       brand.id, hvac.id, 'Org A Model'
     from public.reference_list_items brand
     join public.reference_lists brand_list on brand_list.id = brand.reference_list_id
     join public.reference_list_items hvac on true
     join public.reference_lists hvac_list on hvac_list.id = hvac.reference_list_id
     where brand_list.organization_id = 'd0000000-0000-0000-0000-00000000000a'
       and brand_list.list_key = 'asset_brand' and brand.value = 'kyocera'
       and hvac_list.organization_id = 'd0000000-0000-0000-0000-00000000000a'
       and hvac_list.list_key = 'asset_type' and hvac.value = 'hvac' $$,
  'owner_a can insert an org_a asset_models fixture (brand=kyocera, type=hvac), for the assets.model_id acceptance test below'
); -- 52

select lives_ok(
  $$ insert into public.assets (id, site_id, name, type_id, brand_item_id)
     select
       'aa000000-0000-0000-0000-00000000000a',
       'f0000000-0000-0000-0000-00000000000d',
       'Printer 1',
       hvac.id,
       brand.id
     from public.reference_list_items brand
     join public.reference_lists brand_list on brand_list.id = brand.reference_list_id
     join public.reference_list_items hvac on true
     join public.reference_lists hvac_list on hvac_list.id = hvac.reference_list_id
     where brand_list.organization_id = 'd0000000-0000-0000-0000-00000000000a'
       and brand_list.list_key = 'asset_brand' and brand.value = 'kyocera'
       and hvac_list.organization_id = 'd0000000-0000-0000-0000-00000000000a'
       and hvac_list.list_key = 'asset_type' and hvac.value = 'hvac' $$,
  'owner_a can insert an asset under site f0000000...000d (org_a) with brand_item_id resolved from org_a''s seeded asset_brand list (value=kyocera)'
); -- 53

select is(
  (select rli.value
     from public.assets a
     join public.reference_list_items rli on rli.id = a.brand_item_id
     where a.id = 'aa000000-0000-0000-0000-00000000000a'),
  'kyocera',
  'the new asset''s brand_item_id was persisted and resolves to the asset_brand item value=kyocera'
); -- 54

select throws_ok(
  $$ update public.assets set brand_item_id = (
       select rli.id from public.reference_list_items rli
         join public.reference_lists rl on rl.id = rli.reference_list_id
         where rl.organization_id = 'd0000000-0000-0000-0000-00000000000a'
           and rl.list_key = 'asset_type' and rli.value = 'hvac'
     ) where id = 'aa000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'assets.brand_item_id must reference an item from the asset_brand list, not asset_type (validate_asset_reference_items rejects the wrong list_key)'
); -- 55

select throws_ok(
  $$ update public.assets set brand_item_id = (
       select val from pg_temp.brand_model_captured_ids where key = 'org_b_asset_brand_id'
     ) where id = 'aa000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'assets.brand_item_id from a different organization''s asset_brand list (org_b''s kyocera item) is rejected even though owner_a passes RLS (validate_asset_reference_items resolves it via SECURITY DEFINER and detects the organization mismatch)'
); -- 56

select lives_ok(
  $$ insert into public.assets (id, site_id, name, type_id, model_id)
     values (
       'aa000000-0000-0000-0000-00000000000b',
       'f0000000-0000-0000-0000-00000000000d',
       'Printer 2',
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'd0000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'asset_type' and rli.value = 'hvac'),
       'bb000000-0000-0000-0000-00000000000a'
     ) $$,
  'owner_a can insert an asset under site f0000000...000d (org_a) with model_id set to the org_a asset_models fixture from test 52'
); -- 57

select is(
  (select am.name from public.assets a
     join public.asset_models am on am.id = a.model_id
     where a.id = 'aa000000-0000-0000-0000-00000000000b'),
  'Org A Model',
  'the new asset''s model_id was persisted and resolves to the org_a asset_models fixture (name=Org A Model)'
); -- 58

select throws_ok(
  $$ update public.assets set model_id = 'bb000000-0000-0000-0000-00000000000b' where id = 'aa000000-0000-0000-0000-00000000000b' $$,
  '23514',
  null,
  'assets.model_id from a different organization''s asset_models row (org_b''s fixture) is rejected (validate_asset_reference_items checks asset_models.organization_id = assets.organization_id)'
); -- 59

-- ---------------------------------------------------------------------------
-- clients: status / account_manager_id / potential_value / client_since /
-- won_at (issue #58, real Kanban board -
-- supabase/migrations/20260827090000_account_managers.sql +
-- 20260827100000_clients_kanban_status.sql). Requires an account_managers
-- fixture per org (org_a and org_b) to exercise
-- validate_client_account_manager's cross-org rejection.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

select is(
  (select status from public.clients where id = 'e0000000-0000-0000-0000-00000000000a'),
  'lead',
  'clients.status defaults to ''lead'' when omitted on insert (Client A, inserted in test 1 before this column existed in this test file, still resolves to the column''s own default)'
); -- 60

select lives_ok(
  $$ insert into public.account_managers (id, organization_id, first_name, last_name)
     values ('c4000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-00000000000a', 'Anna', 'Bakker') $$,
  'owner_a can insert an account_managers fixture into org_a (for clients.account_manager_id tests)'
); -- 61

select pg_temp.act_as('b3333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ insert into public.account_managers (id, organization_id, first_name, last_name)
     values ('c4000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-00000000000b', 'Bram', 'Jansen') $$,
  'owner_b can insert an account_managers fixture into org_b'
); -- 62

select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.clients (id, organization_id, name, status, account_manager_id, potential_value, client_since)
     values ('e5000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000a', 'Kanban Client',
       'qualified', 'c4000000-0000-0000-0000-00000000000c', 1000.50, '2026-01-15') $$,
  'owner_a can insert a client with status/account_manager_id/potential_value/client_since all set'
); -- 63

select is(
  (select status from public.clients where id = 'e5000000-0000-0000-0000-00000000000a'),
  'qualified',
  'the new client''s status was persisted as qualified'
); -- 64

select is(
  (select account_manager_id from public.clients where id = 'e5000000-0000-0000-0000-00000000000a'),
  'c4000000-0000-0000-0000-00000000000c'::uuid,
  'the new client''s account_manager_id was persisted'
); -- 65

select is(
  (select potential_value from public.clients where id = 'e5000000-0000-0000-0000-00000000000a'),
  1000.50::numeric(12,2),
  'the new client''s potential_value was persisted'
); -- 66

select is(
  (select client_since from public.clients where id = 'e5000000-0000-0000-0000-00000000000a'),
  '2026-01-15'::date,
  'the new client''s client_since was persisted'
); -- 67

select is(
  (select won_at from public.clients where id = 'e5000000-0000-0000-0000-00000000000a'),
  null::timestamptz,
  'won_at stays null for a client inserted with a non-won status'
); -- 68

select throws_ok(
  $$ insert into public.clients (organization_id, name, status)
     values ('d0000000-0000-0000-0000-00000000000a', 'Bad Status Client', 'negotiating') $$,
  '23514',
  null,
  'a client status outside lead/qualified/proposal/won is rejected (clients_status_check)'
); -- 69

select throws_ok(
  $$ insert into public.clients (organization_id, name, potential_value)
     values ('d0000000-0000-0000-0000-00000000000a', 'Negative Value Client', -1) $$,
  '23514',
  null,
  'a negative potential_value is rejected (clients_potential_value_non_negative)'
); -- 70

select throws_ok(
  $$ insert into public.clients (organization_id, name, account_manager_id)
     values ('d0000000-0000-0000-0000-00000000000a', 'Cross Org AM Client', 'c4000000-0000-0000-0000-00000000000d') $$,
  '23514',
  null,
  'a client cannot use org_b''s account_manager (cross-organization) as account_manager_id (validate_client_account_manager)'
); -- 71

select throws_ok(
  $$ insert into public.clients (organization_id, name, won_at)
     values ('d0000000-0000-0000-0000-00000000000a', 'Spoofed Won At Client', now()) $$,
  '42501',
  null,
  'owner_a cannot set clients.won_at directly on insert (column-level grant withheld -- trigger-only)'
); -- 72

select lives_ok(
  $$ insert into public.clients (id, organization_id, name, status)
     values ('e5000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000a', 'Won On Insert Client', 'won') $$,
  'owner_a can insert a client directly with status=won'
); -- 73

select isnt(
  (select won_at from public.clients where id = 'e5000000-0000-0000-0000-00000000000b'),
  null::timestamptz,
  'won_at was auto-set (trigger) for a client inserted directly with status=won'
); -- 74

select lives_ok(
  $$ update public.clients set status = 'qualified' where id = 'e5000000-0000-0000-0000-00000000000b' $$,
  'owner_a can move the client from won back to qualified'
); -- 75

select is(
  (select won_at from public.clients where id = 'e5000000-0000-0000-0000-00000000000b'),
  null::timestamptz,
  'won_at was cleared back to null when status moved away from won (set_client_won_at)'
); -- 76

select lives_ok(
  $$ update public.clients set status = 'won' where id = 'e5000000-0000-0000-0000-00000000000b' $$,
  'owner_a can move the client back into won a second time'
); -- 77

create table pg_temp.clients_kanban_captured (key text primary key, val timestamptz);
grant all on pg_temp.clients_kanban_captured to authenticated;

insert into pg_temp.clients_kanban_captured (key, val)
select 'won_at_second_time', won_at from public.clients where id = 'e5000000-0000-0000-0000-00000000000b';

select isnt(
  (select val from pg_temp.clients_kanban_captured where key = 'won_at_second_time'),
  null::timestamptz,
  'won_at was set again on re-entering won -- "became Won" semantics, not "was ever Won once"'
); -- 78

select lives_ok(
  $$ update public.clients set status = 'won' where id = 'e5000000-0000-0000-0000-00000000000b' $$,
  'owner_a can re-run UPDATE ... SET status = ''won'' while status is already won'
); -- 79

select is(
  (select won_at from public.clients where id = 'e5000000-0000-0000-0000-00000000000b'),
  (select val from pg_temp.clients_kanban_captured where key = 'won_at_second_time'),
  'won_at is left untouched when status is set to won while it was already won (stayed won->won)'
); -- 80

select lives_ok(
  $$ update public.clients set potential_value = 500 where id = 'e5000000-0000-0000-0000-00000000000b' $$,
  'owner_a can update an unrelated column (potential_value) on a won client without touching status'
); -- 81

select is(
  (select won_at from public.clients where id = 'e5000000-0000-0000-0000-00000000000b'),
  (select val from pg_temp.clients_kanban_captured where key = 'won_at_second_time'),
  'won_at is unchanged when a column other than status is updated (the trigger only fires ON UPDATE OF status)'
); -- 82

-- ---------------------------------------------------------------------------
-- assets.name auto-generation (issue #105,
-- supabase/migrations/20260831090000_assets_auto_generate_asset_id.sql):
-- omitting/blank name auto-fills AST-NNNNN via a per-organization counter
-- (asset_id_sequences), never overrides an explicit name, counters are
-- independent per organization, and the counter table itself is unreachable
-- by any authenticated role.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.assets (id, site_id, type_id)
     values (
       '10000000-0000-0000-0000-000000000001',
       'f0000000-0000-0000-0000-00000000000d',
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'd0000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'asset_type' and rli.value = 'hvac')
     ) $$,
  'owner_a can insert an asset in org_a with no name at all (name omitted entirely)'
); -- 83

select is(
  (select name from public.assets where id = '10000000-0000-0000-0000-000000000001'),
  'AST-00001',
  'the omitted name was auto-generated as AST-00001 (org_a''s first auto-named asset)'
); -- 84

select lives_ok(
  $$ insert into public.assets (id, site_id, type_id, name)
     values (
       '10000000-0000-0000-0000-000000000002',
       'f0000000-0000-0000-0000-00000000000d',
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'd0000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'asset_type' and rli.value = 'hvac'),
       ''
     ) $$,
  'owner_a can insert a second org_a asset with an explicit blank-string name'
); -- 85

select is(
  (select name from public.assets where id = '10000000-0000-0000-0000-000000000002'),
  'AST-00002',
  'a blank-string name is treated the same as omitted -- auto-generated as AST-00002, continuing org_a''s counter'
); -- 86

select lives_ok(
  $$ insert into public.assets (id, site_id, type_id, name)
     values (
       '10000000-0000-0000-0000-000000000003',
       'f0000000-0000-0000-0000-00000000000d',
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'd0000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'asset_type' and rli.value = 'hvac'),
       'Custom Asset Label'
     ) $$,
  'owner_a can insert an org_a asset with an explicit non-blank name'
); -- 87

select is(
  (select name from public.assets where id = '10000000-0000-0000-0000-000000000003'),
  'Custom Asset Label',
  'an explicit non-blank name is never overridden by the auto-generation trigger'
); -- 88

-- Cross-org independence: org_b's counter starts at 1 regardless of org_a's.
select pg_temp.act_as('b3333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ insert into public.sites (id, client_id, is_visit_address)
     values ('20000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000000b', true) $$,
  'owner_b can insert a site under Client B (org_b), fixture for the cross-org counter-independence test'
); -- 89

select lives_ok(
  $$ insert into public.assets (id, site_id, type_id)
     values (
       '10000000-0000-0000-0000-000000000004',
       '20000000-0000-0000-0000-000000000001',
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'd0000000-0000-0000-0000-00000000000b'
            and rl.list_key = 'asset_type' and rli.value = 'hvac')
     ) $$,
  'owner_b can insert a nameless asset in org_b'
); -- 90

select is(
  (select name from public.assets where id = '10000000-0000-0000-0000-000000000004'),
  'AST-00001',
  'org_b''s first auto-named asset is also AST-00001 -- its counter is independent of org_a''s (asset_id_sequences is keyed per organization_id)'
); -- 91

-- asset_id_sequences itself is never directly reachable by any authenticated
-- role -- only next_asset_display_id() (SECURITY DEFINER) touches it.
select throws_ok(
  $$ select * from public.asset_id_sequences $$,
  '42501',
  null,
  'owner_b cannot directly SELECT from asset_id_sequences (no grant -- reachable only via next_asset_display_id())'
); -- 92

select throws_ok(
  $$ insert into public.asset_id_sequences (organization_id, last_number)
     values ('d0000000-0000-0000-0000-00000000000b', 999) $$,
  '42501',
  null,
  'owner_b cannot directly INSERT into asset_id_sequences (no grant)'
); -- 93

select * from finish();
rollback;
