-- pgTAP RLS tests for contacts + the generic dependent reference-list
-- mechanism + the asset_subtype pilot (issue #26,
-- 20260823090000_contacts_dependent_reference_lists.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/clients_sites_assets_rls.test.sql and
-- reference_lists_rls.test.sql: switch to the `authenticated` role and set
-- `request.jwt.claims` to simulate auth.uid() for a given fixture user. All
-- auth.users rows here are test fixtures, rolled back at the end of the
-- transaction.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error — the row is silently excluded (0 rows changed). Only
-- INSERT/UPDATE `WITH CHECK` violations (and column-level privilege
-- revokes) raise error 42501.
--
-- Note on cross-organization reference validation: validate_contact_role_item,
-- validate_reference_list_item_parent, and validate_asset_reference_items
-- are all SECURITY DEFINER, so they can always resolve a referenced id's
-- real organization_id/list_key regardless of the caller's own RLS
-- visibility — a cross-org reference (id exists, but belongs to a different
-- organization) is rejected as 23514 ("must belong to the same
-- organization"/"wrong list_key"), NOT 23503. 23503 is reserved for a
-- genuinely dangling id (no such row at all). Because a plain scalar
-- subquery for "the other org's item id" would itself be RLS-filtered down
-- to zero rows (and silently evaluate to NULL, not raise an error) when run
-- under a caller who isn't a member of that org, cross-org hostile-insert
-- tests below capture the target id into a `pg_temp` table while acting as
-- a user who CAN see it, then reference the captured id after switching
-- actor — same technique as reference_lists_rls.test.sql section 5.

begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

-- ---------------------------------------------------------------------------
-- Fixtures: two orgs, each with an owner + a non-owner member (planner) in
-- org_a. Creating each organization automatically seeds contact_role and
-- asset_subtype (among others) via organizations_seed_reference_lists.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('f1111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('f2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('f3333333-3333-3333-3333-333333333333', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create table pg_temp.captured_ids (key text primary key, val uuid not null);

select pg_temp.act_as('f1111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('a1000000-0000-0000-0000-00000000000a', 'Org A', 'f1111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role)
values ('f1111111-1111-1111-1111-111111111111', 'a1000000-0000-0000-0000-00000000000a', 'owner');

insert into public.memberships (user_id, organization_id, role)
values ('f2222222-2222-2222-2222-222222222222', 'a1000000-0000-0000-0000-00000000000a', 'planner');

insert into public.clients (id, organization_id, name)
values ('a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-00000000000a', 'Client A');

-- Capture org_a's seeded asset_type "hvac" id and asset_subtype "compressor"
-- id (needed later, while acting as owner_b, for cross-org hostile-insert
-- tests) while owner_a can still see them. hvac/compressor are a
-- mutually-consistent type/subtype pair (compressor.parent_item_id = hvac.id)
-- so a later hostile insert using both together is rejected purely by the
-- RLS ownership check, not by the type/subtype cross-field trigger.
insert into pg_temp.captured_ids (key, val)
select 'org_a_asset_type_hvac_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'a1000000-0000-0000-0000-00000000000a'
  and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into pg_temp.captured_ids (key, val)
select 'org_a_asset_subtype_compressor_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'a1000000-0000-0000-0000-00000000000a'
  and rl.list_key = 'asset_subtype' and rli.value = 'compressor';

select pg_temp.act_as('f3333333-3333-3333-3333-333333333333');

insert into public.organizations (id, name, created_by)
values ('a1000000-0000-0000-0000-00000000000b', 'Org B', 'f3333333-3333-3333-3333-333333333333');

insert into public.memberships (user_id, organization_id, role)
values ('f3333333-3333-3333-3333-333333333333', 'a1000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name)
values ('a2000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-00000000000b', 'Client B');

-- Capture org_b's seeded contact_role "billing" id (needed later, while
-- acting as owner_a) while owner_b can still see it.
insert into pg_temp.captured_ids (key, val)
select 'org_b_contact_role_billing_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'a1000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'contact_role' and rli.value = 'billing';

-- ---------------------------------------------------------------------------
-- 1. Seeding: contact_role and asset_subtype lists exist per-org with the
--    expected shape, purely from inserting into organizations.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'a1000000-0000-0000-0000-00000000000a' and rl.list_key = 'contact_role'),
  4,
  'org_a''s seeded contact_role list has the 4 default items'
); -- 1

select is(
  (select rli.value from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'a1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'contact_role' and rli.is_default),
  'primary',
  'org_a''s seeded contact_role list has exactly one default item, value=primary'
); -- 2

select is(
  (select parent_list_key from public.reference_lists
     where organization_id = 'a1000000-0000-0000-0000-00000000000a' and list_key = 'asset_subtype'),
  'asset_type',
  'org_a''s seeded asset_subtype list declares parent_list_key=asset_type'
); -- 3

select is(
  (select count(*)::int from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'a1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_subtype'),
  12,
  'org_a''s seeded asset_subtype list has the 12 default items'
); -- 4

select is(
  (select p.value from public.reference_list_items c
     join public.reference_lists cl on cl.id = c.reference_list_id
     join public.reference_list_items p on p.id = c.parent_item_id
     where cl.organization_id = 'a1000000-0000-0000-0000-00000000000a'
       and cl.list_key = 'asset_subtype' and c.value = 'compressor'),
  'hvac',
  'the seeded "compressor" asset_subtype item''s parent_item_id resolves to the org''s hvac asset_type item'
); -- 5

-- ---------------------------------------------------------------------------
-- 2. contacts: owner CRUD, created_by/organization_id lockdown, role
--    validation, is_primary enforcement.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.contacts (id, client_id, name, email, is_primary, role_item_id)
     select 'a3000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-00000000000a', 'Alice', 'alice@test.local', true,
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'a1000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'contact_role' and rli.value = 'primary') $$,
  'owner_a can insert a contact under client A (org_a), role_item_id resolved from org_a''s seeded contact_role list'
); -- 6

select is(
  (select organization_id from public.contacts where id = 'a3000000-0000-0000-0000-00000000000a'),
  'a1000000-0000-0000-0000-00000000000a'::uuid,
  'contacts.organization_id was auto-derived from clients.organization_id via client_id'
); -- 7

select is(
  (select created_by from public.contacts where id = 'a3000000-0000-0000-0000-00000000000a'),
  'f1111111-1111-1111-1111-111111111111'::uuid,
  'contacts.created_by was auto-stamped to the inserting user (trigger), not client-supplied'
); -- 8

select throws_ok(
  $$ insert into public.contacts (client_id, name, organization_id)
     values ('a2000000-0000-0000-0000-00000000000a', 'Spoofed', 'a1000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_a cannot set contacts.organization_id directly on insert (column-level grant withheld)'
); -- 9

select throws_ok(
  $$ insert into public.contacts (client_id, name, created_by)
     values ('a2000000-0000-0000-0000-00000000000a', 'Spoofed', '00000000-0000-0000-0000-000000000000') $$,
  '42501',
  null,
  'owner_a cannot set contacts.created_by directly on insert (column-level grant withheld)'
); -- 10

select throws_ok(
  $$ insert into public.contacts (client_id, name, role_item_id)
     select 'a2000000-0000-0000-0000-00000000000a', 'Bad Role',
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'a1000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'asset_type' and rli.value = 'hvac') $$,
  '23514',
  null,
  'contacts.role_item_id must be from the contact_role list, not an asset_type item (validate_contact_role_item)'
); -- 11

select throws_ok(
  $$ insert into public.contacts (client_id, name, role_item_id)
     select 'a2000000-0000-0000-0000-00000000000a', 'Cross Org Role', val
     from pg_temp.captured_ids where key = 'org_b_contact_role_billing_id' $$,
  '23514',
  null,
  'contacts.role_item_id from a different organization''s contact_role list is rejected (validate_contact_role_item resolves it via SECURITY DEFINER and detects the organization mismatch)'
); -- 12

select lives_ok(
  $$ insert into public.contacts (id, client_id, name, is_primary)
     values ('a3000000-0000-0000-0000-00000000000b', 'a2000000-0000-0000-0000-00000000000a', 'Bob', true) $$,
  'owner_a can insert a second primary contact for the same client'
); -- 13

select is(
  (select is_primary from public.contacts where id = 'a3000000-0000-0000-0000-00000000000a'),
  false,
  'enforce_single_primary_contact unset Alice''s is_primary when Bob became the new primary for the same client'
); -- 14

select is(
  (select count(*)::int from public.contacts
     where client_id = 'a2000000-0000-0000-0000-00000000000a' and is_primary),
  1,
  'still exactly one primary contact for client A'
); -- 15

-- ---------------------------------------------------------------------------
-- 3. RLS: non-owner (planner_a) can read but not write; cross-tenant
--    isolation.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.contacts where organization_id = 'a1000000-0000-0000-0000-00000000000a'),
  2,
  'planner_a (non-owner member) can SELECT contacts in org_a'
); -- 16

select throws_ok(
  $$ insert into public.contacts (client_id, name)
     values ('a2000000-0000-0000-0000-00000000000a', 'Planner Contact') $$,
  '42501',
  null,
  'planner_a (non-owner) cannot INSERT a contact (RLS owner-only backstop)'
); -- 17

update public.contacts set name = 'Hijacked' where id = 'a3000000-0000-0000-0000-00000000000a';

select is(
  (select name from public.contacts where id = 'a3000000-0000-0000-0000-00000000000a'),
  'Alice',
  'planner_a''s UPDATE on a contact is silently excluded by RLS (USING); name unchanged'
); -- 18

select pg_temp.act_as('f3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.contacts where organization_id = 'a1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s contacts'
); -- 19

-- ---------------------------------------------------------------------------
-- 4. Generic dependent reference-list mechanism (validate_reference_list_item_parent),
--    exercised directly against reference_lists/reference_list_items, acting
--    as owner_b (org_b).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.reference_list_items (reference_list_id, value, label)
     select id, 'no_parent', 'No Parent'
     from public.reference_lists
     where organization_id = 'a1000000-0000-0000-0000-00000000000b' and list_key = 'asset_subtype' $$,
  '23514',
  null,
  'inserting an asset_subtype item without parent_item_id is rejected (list has parent_list_key=asset_type, so parent_item_id is required)'
); -- 20

select throws_ok(
  $$ insert into public.reference_list_items (reference_list_id, value, label, parent_item_id)
     select sub.id, 'wrong_parent_list', 'Wrong Parent List', status.id
     from public.reference_lists sub, public.reference_list_items status
     join public.reference_lists status_list on status_list.id = status.reference_list_id
     where sub.organization_id = 'a1000000-0000-0000-0000-00000000000b' and sub.list_key = 'asset_subtype'
       and status_list.organization_id = 'a1000000-0000-0000-0000-00000000000b'
       and status_list.list_key = 'asset_status' and status.value = 'active' $$,
  '23514',
  null,
  'an asset_subtype item''s parent_item_id must resolve to an asset_type item, not an asset_status item (wrong list_key)'
); -- 21

select throws_ok(
  $$ insert into public.reference_list_items (reference_list_id, value, label, parent_item_id)
     select sub.id, 'cross_org_parent', 'Cross Org Parent', captured.val
     from public.reference_lists sub, pg_temp.captured_ids captured
     where sub.organization_id = 'a1000000-0000-0000-0000-00000000000b' and sub.list_key = 'asset_subtype'
       and captured.key = 'org_a_asset_type_hvac_id' $$,
  '23514',
  null,
  'an asset_subtype item''s parent_item_id from a different organization''s asset_type list (org_a''s hvac item) is rejected (validate_reference_list_item_parent resolves it via SECURITY DEFINER and detects the organization mismatch)'
); -- 22

select lives_ok(
  $$ insert into public.reference_list_items (id, reference_list_id, value, label, parent_item_id)
     select 'a6000000-0000-0000-0000-00000000000b', sub.id, 'motor', 'Motor', a_type.id
     from public.reference_lists sub, public.reference_list_items a_type
     join public.reference_lists type_list on type_list.id = a_type.reference_list_id
     where sub.organization_id = 'a1000000-0000-0000-0000-00000000000b' and sub.list_key = 'asset_subtype'
       and type_list.organization_id = 'a1000000-0000-0000-0000-00000000000b'
       and type_list.list_key = 'asset_type' and a_type.value = 'hvac' $$,
  'owner_b can insert a valid asset_subtype item ("motor") with a same-org, correct-list parent_item_id'
); -- 23

select throws_ok(
  $$ insert into public.reference_list_items (reference_list_id, value, label, parent_item_id)
     select id, 'stray_parent', 'Stray Parent',
       (select id from public.reference_list_items where value = 'active' and organization_id = 'a1000000-0000-0000-0000-00000000000b' limit 1)
     from public.reference_lists
     where organization_id = 'a1000000-0000-0000-0000-00000000000b' and list_key = 'asset_status' $$,
  '23514',
  null,
  'setting parent_item_id on an item whose own list has no parent_list_key configured (asset_status) is rejected'
); -- 24

-- ---------------------------------------------------------------------------
-- 5. assets.subtype_id cross-field validation (extends
--    validate_asset_reference_items): must be an asset_subtype item whose
--    parent_item_id equals the asset's own type_id.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f1111111-1111-1111-1111-111111111111');

insert into public.clients (id, organization_id, name)
values ('a2000000-0000-0000-0000-00000000000c', 'a1000000-0000-0000-0000-00000000000a', 'Client A2');

insert into public.sites (id, client_id, name)
values ('a4000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-00000000000c', 'Site A');

select lives_ok(
  $$ insert into public.assets (id, site_id, name, type_id, subtype_id, serial_number)
     select
       'a5000000-0000-0000-0000-00000000000a',
       'a4000000-0000-0000-0000-00000000000a',
       'AC Unit 1',
       hvac.id,
       compressor.id,
       'SN-100'
     from public.reference_list_items hvac
     join public.reference_lists hvac_list on hvac_list.id = hvac.reference_list_id
     join public.reference_list_items compressor on compressor.parent_item_id = hvac.id
     join public.reference_lists compressor_list on compressor_list.id = compressor.reference_list_id
     where hvac_list.organization_id = 'a1000000-0000-0000-0000-00000000000a'
       and hvac_list.list_key = 'asset_type' and hvac.value = 'hvac'
       and compressor_list.list_key = 'asset_subtype' and compressor.value = 'compressor' $$,
  'owner_a can insert an asset with type_id=hvac and subtype_id=compressor (compressor''s parent_item_id matches type_id)'
); -- 25

select throws_ok(
  $$ insert into public.assets (site_id, name, type_id, subtype_id)
     select
       'a4000000-0000-0000-0000-00000000000a',
       'Mismatched Subtype',
       elec.id,
       compressor.id
     from public.reference_list_items elec
     join public.reference_lists elec_list on elec_list.id = elec.reference_list_id
     join public.reference_list_items compressor on true
     join public.reference_lists compressor_list on compressor_list.id = compressor.reference_list_id
     where elec_list.organization_id = 'a1000000-0000-0000-0000-00000000000a'
       and elec_list.list_key = 'asset_type' and elec.value = 'electrical'
       and compressor_list.organization_id = 'a1000000-0000-0000-0000-00000000000a'
       and compressor_list.list_key = 'asset_subtype' and compressor.value = 'compressor' $$,
  '23514',
  null,
  'assets.subtype_id=compressor (an hvac sub-type) is rejected when type_id=electrical (subtype''s parent_item_id must equal type_id)'
); -- 26

select throws_ok(
  $$ insert into public.assets (site_id, name, type_id, subtype_id)
     select
       'a4000000-0000-0000-0000-00000000000a',
       'Wrong List Subtype',
       hvac.id,
       status_item.id
     from public.reference_list_items hvac
     join public.reference_lists hvac_list on hvac_list.id = hvac.reference_list_id
     join public.reference_list_items status_item on true
     join public.reference_lists status_list on status_list.id = status_item.reference_list_id
     where hvac_list.organization_id = 'a1000000-0000-0000-0000-00000000000a'
       and hvac_list.list_key = 'asset_type' and hvac.value = 'hvac'
       and status_list.organization_id = 'a1000000-0000-0000-0000-00000000000a'
       and status_list.list_key = 'asset_status' and status_item.value = 'active' $$,
  '23514',
  null,
  'assets.subtype_id must reference an item from the asset_subtype list, not asset_status (got list_key check)'
); -- 27

select pg_temp.act_as('f3333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ insert into public.assets (site_id, name, type_id, subtype_id)
     select
       'a4000000-0000-0000-0000-00000000000a',
       'Cross Org Hostile Asset',
       (select val from pg_temp.captured_ids where key = 'org_a_asset_type_hvac_id'),
       (select val from pg_temp.captured_ids where key = 'org_a_asset_subtype_compressor_id') $$,
  '42501',
  null,
  'owner_b cannot insert an asset under org_a''s site at all (not is_org_owner of org_a) — the RLS backstop rejects this even though type_id=hvac and subtype_id=compressor are individually well-formed and mutually consistent (both org_a, correct parent relationship), ruling out a 23514 from the type/subtype cross-field trigger as the actual cause'
); -- 28

select is(
  (select rli.value from public.assets a
     join public.reference_list_items rli on rli.id = a.subtype_id
     where a.id = 'a5000000-0000-0000-0000-00000000000a'),
  'compressor',
  'the valid asset''s subtype_id is still compressor after the rejected attempts above'
); -- 29

select * from finish();
rollback;
