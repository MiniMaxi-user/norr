-- pgTAP RLS tests for asset_brand (reference list) + asset_models (issue
-- #54, 20260826160000_asset_brand_and_models.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/reference_lists_rls.test.sql and
-- supabase/tests/database/contacts_dependent_reference_lists_rls.test.sql:
-- switch to the `authenticated` role and set `request.jwt.claims` to
-- simulate auth.uid() for a given fixture user. All auth.users rows here are
-- test fixtures, rolled back at the end of the transaction.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error — the row is silently excluded (0 rows changed). Only
-- INSERT/UPDATE `WITH CHECK` violations (and column-level privilege
-- revokes) raise error 42501.
--
-- Note: organizations created inside this test only get the automatic
-- seed_default_reference_lists() run (asset_type/asset_status/contact_role/
-- asset_subtype/asset_brand) — the one-time Kyocera MFP testdata backfill in
-- 20260826160000_asset_brand_and_models.sql only ran once, directly in that
-- migration, against organizations that existed at the time it was applied.
-- New orgs created after that point (including these test fixtures) do NOT
-- get Kyocera testdata automatically, by design (see that migration's header
-- comment) — so this file does not assert on it, only on the generic
-- asset_brand/asset_models mechanism.

begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- ---------------------------------------------------------------------------
-- Fixtures: two orgs, each with an owner; org_a also has a non-owner member
-- (planner). Creating each organization automatically seeds asset_brand
-- (among others) via organizations_seed_reference_lists.
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

create table pg_temp.captured_ids (key text primary key, val uuid not null);

select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('b1000000-0000-0000-0000-00000000000a', 'Org A', 'b1111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role)
values ('b1111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-00000000000a', 'owner');

insert into public.memberships (user_id, organization_id, role)
values ('b2222222-2222-2222-2222-222222222222', 'b1000000-0000-0000-0000-00000000000a', 'planner');

select pg_temp.act_as('b3333333-3333-3333-3333-333333333333');

insert into public.organizations (id, name, created_by)
values ('b1000000-0000-0000-0000-00000000000b', 'Org B', 'b3333333-3333-3333-3333-333333333333');

insert into public.memberships (user_id, organization_id, role)
values ('b3333333-3333-3333-3333-333333333333', 'b1000000-0000-0000-0000-00000000000b', 'owner');

-- Capture org_b's asset_brand "other_brand" id while owner_b can see it, for
-- a later cross-org hostile-reference test acting as owner_a.
insert into pg_temp.captured_ids (key, val)
select 'org_b_asset_brand_other_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'b1000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'asset_brand' and rli.value = 'other_brand';

-- ---------------------------------------------------------------------------
-- 1. Seeding: asset_brand exists per-org with the expected shape, purely
--    from inserting into organizations.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('b1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'b1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_brand'),
  5,
  'org_a''s seeded asset_brand list has the 5 default items'
); -- 1

select is(
  (select rli.value from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'asset_brand' and rli.is_default),
  'other_brand',
  'org_a''s seeded asset_brand list has exactly one default item, value=other_brand'
); -- 2

select bag_has(
  $$ select rli.value from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'b1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_brand' $$,
  $$ values ('kyocera'), ('canon'), ('ricoh'), ('xerox'), ('other_brand') $$,
  'org_a''s seeded asset_brand list contains the expected MFP-vertical vendor set'
); -- 3

-- ---------------------------------------------------------------------------
-- 2. asset_models: owner CRUD happy path, brand/type/subtype validation,
--    the not-null brand requirement, and the unique (org, brand, name)
--    constraint.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.asset_models (id, organization_id, brand_item_id, type_item_id, subtype_item_id, name, default_warranty_months)
     select
       'b4000000-0000-0000-0000-00000000000a',
       'b1000000-0000-0000-0000-00000000000a',
       brand.id, hvac.id, compressor.id,
       'AC-9000', 24
     from public.reference_list_items brand
     join public.reference_lists brand_list on brand_list.id = brand.reference_list_id
     join public.reference_list_items hvac on true
     join public.reference_lists hvac_list on hvac_list.id = hvac.reference_list_id
     join public.reference_list_items compressor on compressor.parent_item_id = hvac.id
     join public.reference_lists compressor_list on compressor_list.id = compressor.reference_list_id
     where brand_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and brand_list.list_key = 'asset_brand' and brand.value = 'kyocera'
       and hvac_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and hvac_list.list_key = 'asset_type' and hvac.value = 'hvac'
       and compressor_list.list_key = 'asset_subtype' and compressor.value = 'compressor' $$,
  'owner_a can insert an asset_model with brand=kyocera, type=hvac, subtype=compressor (compressor''s parent_item_id matches type_item_id)'
); -- 4

select is(
  (select created_by from public.asset_models where id = 'b4000000-0000-0000-0000-00000000000a'),
  'b1111111-1111-1111-1111-111111111111'::uuid,
  'asset_models.created_by was auto-stamped to the inserting user (trigger), not client-supplied'
); -- 5

select lives_ok(
  $$ insert into public.asset_models (id, organization_id, brand_item_id, type_item_id, name)
     select
       'b4000000-0000-0000-0000-00000000000e',
       'b1000000-0000-0000-0000-00000000000a',
       brand.id, hvac.id, 'Default Warranty Model'
     from public.reference_list_items brand
     join public.reference_lists brand_list on brand_list.id = brand.reference_list_id
     join public.reference_list_items hvac on true
     join public.reference_lists hvac_list on hvac_list.id = hvac.reference_list_id
     where brand_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and brand_list.list_key = 'asset_brand' and brand.value = 'kyocera'
       and hvac_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and hvac_list.list_key = 'asset_type' and hvac.value = 'hvac' $$,
  'owner_a can insert an asset_model omitting default_warranty_months entirely'
); -- 6

select is(
  (select default_warranty_months from public.asset_models where id = 'b4000000-0000-0000-0000-00000000000e'),
  24,
  'default_warranty_months defaults to 24 (the column default) when omitted on insert'
); -- 7

select throws_ok(
  $$ insert into public.asset_models (organization_id, type_item_id, name)
     select
       'b1000000-0000-0000-0000-00000000000a', hvac.id, 'No Brand Model'
     from public.reference_list_items hvac
     join public.reference_lists hvac_list on hvac_list.id = hvac.reference_list_id
     where hvac_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and hvac_list.list_key = 'asset_type' and hvac.value = 'hvac' $$,
  '23502',
  null,
  'asset_models.brand_item_id is required (not null) — "Brand is verplicht" per issue #54'
); -- 8

select throws_ok(
  $$ insert into public.asset_models (organization_id, brand_item_id, type_item_id, name)
     select
       'b1000000-0000-0000-0000-00000000000a', hvac.id, hvac.id, 'Wrong List Brand'
     from public.reference_list_items hvac
     join public.reference_lists hvac_list on hvac_list.id = hvac.reference_list_id
     where hvac_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and hvac_list.list_key = 'asset_type' and hvac.value = 'hvac' $$,
  '23514',
  null,
  'asset_models.brand_item_id must reference an item from the asset_brand list, not asset_type (validate_asset_model_reference_items)'
); -- 9

select throws_ok(
  $$ insert into public.asset_models (organization_id, brand_item_id, type_item_id, name)
     select
       'b1000000-0000-0000-0000-00000000000a', brand.id, brand.id, 'Wrong List Type'
     from public.reference_list_items brand
     join public.reference_lists brand_list on brand_list.id = brand.reference_list_id
     where brand_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and brand_list.list_key = 'asset_brand' and brand.value = 'kyocera' $$,
  '23514',
  null,
  'asset_models.type_item_id must reference an item from the asset_type list, not asset_brand (validate_asset_model_reference_items)'
); -- 10

select throws_ok(
  $$ insert into public.asset_models (organization_id, brand_item_id, type_item_id, subtype_item_id, name)
     select
       'b1000000-0000-0000-0000-00000000000a', brand.id, electrical.id, compressor.id, 'Mismatched Subtype'
     from public.reference_list_items brand
     join public.reference_lists brand_list on brand_list.id = brand.reference_list_id
     join public.reference_list_items electrical on true
     join public.reference_lists electrical_list on electrical_list.id = electrical.reference_list_id
     join public.reference_list_items compressor on true
     join public.reference_lists compressor_list on compressor_list.id = compressor.reference_list_id
     where brand_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and brand_list.list_key = 'asset_brand' and brand.value = 'kyocera'
       and electrical_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and electrical_list.list_key = 'asset_type' and electrical.value = 'electrical'
       and compressor_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and compressor_list.list_key = 'asset_subtype' and compressor.value = 'compressor' $$,
  '23514',
  null,
  'asset_models.subtype_item_id=compressor (an hvac sub-type) is rejected when type_item_id=electrical (cascade check: subtype''s parent_item_id must equal type_item_id)'
); -- 11

select throws_ok(
  $$ insert into public.asset_models (organization_id, brand_item_id, type_item_id, name)
     select
       'b1000000-0000-0000-0000-00000000000a', val, hvac.id, 'Cross Org Brand'
     from pg_temp.captured_ids, public.reference_list_items hvac
     join public.reference_lists hvac_list on hvac_list.id = hvac.reference_list_id
     where pg_temp.captured_ids.key = 'org_b_asset_brand_other_id'
       and hvac_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and hvac_list.list_key = 'asset_type' and hvac.value = 'hvac' $$,
  '23514',
  null,
  'asset_models.brand_item_id from a different organization''s asset_brand list (org_b''s item) is rejected even though owner_a passes the RLS is_org_owner(org_a) check (validate_asset_model_reference_items resolves it via SECURITY DEFINER and detects the organization mismatch)'
); -- 12

select throws_ok(
  $$ insert into public.asset_models (organization_id, brand_item_id, type_item_id, name)
     select
       'b1000000-0000-0000-0000-00000000000a', brand.id, hvac.id, 'AC-9000'
     from public.reference_list_items brand
     join public.reference_lists brand_list on brand_list.id = brand.reference_list_id
     join public.reference_list_items hvac on true
     join public.reference_lists hvac_list on hvac_list.id = hvac.reference_list_id
     where brand_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and brand_list.list_key = 'asset_brand' and brand.value = 'kyocera'
       and hvac_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and hvac_list.list_key = 'asset_type' and hvac.value = 'hvac' $$,
  '23505',
  null,
  'a second asset_model with the same (organization_id, brand_item_id, name) as the one from test 4 is rejected (unique constraint)'
); -- 13

select lives_ok(
  $$ update public.asset_models set default_warranty_months = 36, name = 'AC-9000 Pro' where id = 'b4000000-0000-0000-0000-00000000000a' $$,
  'owner_a can update an asset_model''s name and default_warranty_months'
); -- 14

select is(
  (select default_warranty_months from public.asset_models where id = 'b4000000-0000-0000-0000-00000000000a'),
  36,
  'default_warranty_months is independently overridable per model, not hardcoded to 24 (per issue #54''s "in te stellen" requirement)'
); -- 15

select throws_ok(
  $$ update public.asset_models set organization_id = 'b1000000-0000-0000-0000-00000000000b' where id = 'b4000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'owner_a cannot move an asset_model to a different organization via UPDATE (organization_id excluded from the UPDATE column grant entirely)'
); -- 16

-- ---------------------------------------------------------------------------
-- 3. RLS: non-owner (planner_a) can read but not write; cross-tenant
--    isolation.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('b2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.asset_models where organization_id = 'b1000000-0000-0000-0000-00000000000a'),
  2,
  'planner_a (non-owner member) can SELECT org_a''s asset_models (AC-9000 Pro from test 4/14, Default Warranty Model from test 6)'
); -- 17

select throws_ok(
  $$ insert into public.asset_models (organization_id, brand_item_id, type_item_id, name)
     select
       'b1000000-0000-0000-0000-00000000000a', brand.id, hvac.id, 'Planner Model'
     from public.reference_list_items brand
     join public.reference_lists brand_list on brand_list.id = brand.reference_list_id
     join public.reference_list_items hvac on true
     join public.reference_lists hvac_list on hvac_list.id = hvac.reference_list_id
     where brand_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and brand_list.list_key = 'asset_brand' and brand.value = 'kyocera'
       and hvac_list.organization_id = 'b1000000-0000-0000-0000-00000000000a'
       and hvac_list.list_key = 'asset_type' and hvac.value = 'hvac' $$,
  '42501',
  null,
  'planner_a (non-owner) cannot INSERT an asset_model (RLS owner-only backstop)'
); -- 18

update public.asset_models set name = 'Hijacked' where id = 'b4000000-0000-0000-0000-00000000000a';

select is(
  (select name from public.asset_models where id = 'b4000000-0000-0000-0000-00000000000a'),
  'AC-9000 Pro',
  'planner_a''s UPDATE on an asset_model is silently excluded by RLS (USING); name unchanged'
); -- 19

select pg_temp.act_as('b3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.asset_models where organization_id = 'b1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s asset_models'
); -- 20

select throws_ok(
  $$ insert into public.asset_models (organization_id, brand_item_id, type_item_id, name)
     select
       'b1000000-0000-0000-0000-00000000000a', val, val, 'Hostile Model'
     from pg_temp.captured_ids where key = 'org_b_asset_brand_other_id' $$,
  '42501',
  null,
  'owner_b cannot insert an asset_model into org_a (not is_org_owner of org_a) — RLS with_check rejects it before validate_asset_model_reference_items would even run'
); -- 21

select is(
  (select count(*)::int from public.asset_models where organization_id = 'b1000000-0000-0000-0000-00000000000b'),
  0,
  'owner_b''s own org_b independently has zero asset_models (isolation, not shared rows, and no automatic Kyocera testdata for orgs created after the one-time backfill)'
); -- 22

select * from finish();
rollback;
