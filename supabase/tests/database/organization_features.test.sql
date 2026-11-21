-- pgTAP tests for issues #243/#244/#246 (20261126100000_organization_features_
-- and_module_catalog.sql): feature_catalog seed (KEEP IN SYNC with
-- lib/rbac/module-catalog.ts), organization_features RLS + write RPC,
-- platform default bundle, validation rules, new-organization trigger and the
-- meters-gated counter reading requirements.
--
-- Run with: supabase test db (Docker), or against the linked project via
-- `supabase db query --linked` with a forced-exception rollback.

begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

-- Fixtures are inserted as the table owner (before any act_as).
insert into auth.users (id, email) values
  ('e2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('e2222222-2222-2222-2222-222222222222', 'owner-b@test.local'),
  ('e2999999-9999-9999-9999-999999999999', 'admin@test.local');

update public.users set is_platform_admin = true, full_name = 'Pat Admin'
  where id = 'e2999999-9999-9999-9999-999999999999';

insert into public.organizations (id, name, created_by) values
  ('e1000000-0000-0000-0000-00000000000a', 'Org A', 'e2111111-1111-1111-1111-111111111111'),
  ('e1000000-0000-0000-0000-00000000000b', 'Org B', 'e2222222-2222-2222-2222-222222222222');

insert into public.memberships (user_id, organization_id, role) values
  ('e2111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('e2222222-2222-2222-2222-222222222222', 'e1000000-0000-0000-0000-00000000000b', 'owner');

-- Counter fixtures for the meters-gating checks (Org A).
insert into public.clients (id, organization_id, name) values
  ('e3000000-0000-0000-0000-0000000000a1', 'e1000000-0000-0000-0000-00000000000a', 'Client A1');
insert into public.sites (id, client_id, is_visit_address) values
  ('e4000000-0000-0000-0000-0000000000a1', 'e3000000-0000-0000-0000-0000000000a1', true);

insert into public.asset_models (id, organization_id, brand_item_id, type_item_id, name)
select 'e5000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', b.id, t.id, 'Model A'
from public.reference_list_items b
join public.reference_lists bl on bl.id = b.reference_list_id
join public.reference_list_items t on t.organization_id = b.organization_id
join public.reference_lists tl on tl.id = t.reference_list_id
where bl.organization_id = 'e1000000-0000-0000-0000-00000000000a' and bl.list_key = 'asset_brand' and b.value = 'kyocera'
  and tl.list_key = 'asset_type' and t.value = 'hvac';

insert into public.reference_list_items (id, reference_list_id, value, label, sort_order, parent_item_id)
select 'e0000000-0000-0000-0000-0000000000a1', vl.id, 'bw_prints', 'B/W prints', 1,
  (select u.id from public.reference_list_items u join public.reference_lists ul on ul.id = u.reference_list_id
    where ul.organization_id = vl.organization_id and ul.list_key = 'article_unit' order by u.sort_order limit 1)
from public.reference_lists vl
where vl.organization_id = 'e1000000-0000-0000-0000-00000000000a' and vl.list_key = 'volume';

insert into public.asset_model_volumes (asset_model_id, volume_item_id) values
  ('e5000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-0000000000a1');

insert into public.articles (id, organization_id, article_number, description) values
  ('e8000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'ART-A', 'Article A');

insert into public.assets (id, site_id, name, type_id, model_id)
select 'e7000000-0000-0000-0000-0000000000a1', 'e4000000-0000-0000-0000-0000000000a1', 'Asset A1', rli.id,
       'e5000000-0000-0000-0000-00000000000a'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'e1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into public.contracts (id, client_id, external_reference, start_date) values
  ('e6000000-0000-0000-0000-0000000000ca', 'e3000000-0000-0000-0000-0000000000a1', 'CA', '2026-01-01'),
  ('e6000000-0000-0000-0000-0000000000cb', 'e3000000-0000-0000-0000-0000000000a1', 'CB', '2026-01-01');
insert into public.contract_assets (contract_id, asset_id) values
  ('e6000000-0000-0000-0000-0000000000ca', 'e7000000-0000-0000-0000-0000000000a1');
insert into public.contract_line_items (id, contract_id, article_id, article_number, description, is_volume, volume_item_id, overage_unit_price)
values
  ('e9000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-0000000000ca', 'e8000000-0000-0000-0000-00000000000a', 'ART-A', 'Article A', true, 'e0000000-0000-0000-0000-0000000000a1', 0.05);
insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at) values
  ('e7000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-0000000000a1', 100, '2026-01-01 12:00:00+00');
update public.contracts set status = 'active' where id = 'e6000000-0000-0000-0000-0000000000ca';

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- ---------------------------------------------------------------------------
-- Catalog + seeds (as table owner)
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(feature_key || ':' || tier || ':' || array_to_string(requires, ',') || ':' || shipped::text, ' | ' order by sort_order)
     from public.feature_catalog),
  'dashboard:core::true | clients:core::true | assets:core::true | articles:core::true | activities:core::true | planning:core::true | settings:core::true | contracts:addon::true | quotes:addon::true | invoicing:addon:quotes:true | checklists:addon::true | inventory:addon::true | meters:addon::true | preventive_maintenance:addon:contracts,planning:false',
  'feature_catalog seed matches lib/rbac/module-catalog.ts'
); -- 1

select is(
  (select string_agg(feature_key, ',' order by feature_key) from public.platform_default_features where enabled),
  (select string_agg(feature_key, ',' order by feature_key) from public.feature_catalog where shipped),
  'default bundle seed: every shipped key enabled'
); -- 2

select is(
  (select enabled from public.platform_default_features where feature_key = 'preventive_maintenance'),
  false,
  'default bundle seed: preventive maintenance off'
); -- 3

select is(
  (select count(*)::int from public.organization_features where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  14,
  'a new organization gets one row per catalog key'
); -- 4

select is(
  (select count(*)::int from public.organization_features
    where organization_id = 'e1000000-0000-0000-0000-00000000000a' and enabled and source = 'default'),
  13,
  'new organization: core + every shipped add-on (incl. meters) enabled, source default'
); -- 5

select is(
  (select enabled from public.organization_features
    where organization_id = 'e1000000-0000-0000-0000-00000000000a' and feature_key = 'preventive_maintenance'),
  false,
  'new organization: preventive maintenance disabled'
); -- 6

-- ---------------------------------------------------------------------------
-- RLS: members see their own rows only
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.organization_features),
  14,
  'a member sees only their own organization''s rows'
); -- 7

select is(
  (select count(*)::int from public.organization_features where organization_id = 'e1000000-0000-0000-0000-00000000000b'),
  0,
  'a member does not see another organization''s rows'
); -- 8

select is(
  (select count(*)::int from public.feature_catalog),
  14,
  'any authenticated user reads the catalog'
); -- 9

select is(
  (select count(*)::int from public.platform_default_features),
  0,
  'a non-admin does not see the default bundle'
); -- 10

select is(public.organization_has_feature('e1000000-0000-0000-0000-00000000000a', 'meters'), true,
  'organization_has_feature true for an enabled key'); -- 11
select is(public.organization_has_feature('e1000000-0000-0000-0000-00000000000a', 'preventive_maintenance'), false,
  'organization_has_feature false for a disabled key'); -- 12
select is(public.organization_has_feature('e1000000-0000-0000-0000-00000000000a', 'nonsense'), false,
  'organization_has_feature false for an unknown key'); -- 13

-- No direct writes.
select throws_ok(
  $$ update public.organization_features set enabled = false where organization_id = 'e1000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'a member cannot update organization_features directly'
); -- 14
select throws_ok(
  $$ insert into public.organization_features (organization_id, feature_key, enabled, source)
     values ('e1000000-0000-0000-0000-00000000000a', 'meters', true, 'manual') $$,
  '42501', null, 'a member cannot insert organization_features directly'
); -- 15
select throws_ok(
  $$ delete from public.organization_features where organization_id = 'e1000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'a member cannot delete organization_features directly'
); -- 16
select throws_ok(
  $$ update public.platform_default_features set enabled = false $$,
  '42501', null, 'a member cannot update platform_default_features directly'
); -- 17
select throws_ok(
  $$ update public.feature_catalog set shipped = true $$,
  '42501', null, 'a member cannot update feature_catalog'
); -- 18

-- RPC authorization.
select throws_ok(
  $$ select * from public.set_organization_features('e1000000-0000-0000-0000-00000000000a', '{"meters": false}') $$,
  '42501', 'Only a platform admin can change an organization''s modules.', 'an owner cannot call set_organization_features'
); -- 19
select throws_ok(
  $$ select * from public.set_platform_default_features('{"meters": false}') $$,
  '42501', 'Only a platform admin can change the default modules.', 'an owner cannot call set_platform_default_features'
); -- 20
select throws_ok(
  $$ select * from public.list_platform_default_features() $$,
  '42501', 'Only a platform admin can read the default modules.', 'an owner cannot call list_platform_default_features'
); -- 21
select throws_ok(
  $$ select * from public.list_organization_features('e1000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'a member cannot list another organization''s modules'
); -- 22
select is(
  (select count(*)::int from public.list_organization_features('e1000000-0000-0000-0000-00000000000a')),
  14,
  'a member lists their own organization''s modules (every catalog key)'
); -- 23

-- ---------------------------------------------------------------------------
-- Platform admin: set_organization_features + validation
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2999999-9999-9999-9999-999999999999');

select is(
  (select count(*)::int from public.organization_features where organization_id in ('e1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000b')),
  28,
  'a platform admin sees every organization''s rows'
); -- 24

select is(
  (select count(*)::int from public.set_organization_features('e1000000-0000-0000-0000-00000000000a', '{"checklists": false}')),
  1,
  'a platform admin can disable an add-on (returns the changed rows)'
); -- 25

select is(
  (select enabled || ':' || source || ':' || updated_by_name from public.list_organization_features('e1000000-0000-0000-0000-00000000000a') where feature_key = 'checklists'),
  'false:manual:Pat Admin',
  'list shows enabled, source manual and the updater''s name'
); -- 26

select is(
  (select count(*)::int from public.organization_features
    where organization_id = 'e1000000-0000-0000-0000-00000000000b' and enabled),
  13,
  'changing Org A leaves Org B untouched'
); -- 27

select throws_ok(
  $$ select * from public.set_organization_features('e1000000-0000-0000-0000-00000000000a', '{"clients": false}') $$,
  '23514', 'Clients is a core module and can''t be disabled', 'core modules cannot be disabled'
); -- 28

select throws_ok(
  $$ select * from public.set_organization_features('e1000000-0000-0000-0000-00000000000a', '{"quotes": false}') $$,
  '23514', 'Quotes can''t be disabled while Invoicing is enabled', 'a required key cannot be disabled while its dependent is enabled'
); -- 29

select lives_ok(
  $$ select * from public.set_organization_features('e1000000-0000-0000-0000-00000000000a', '{"quotes": false, "invoicing": false}') $$,
  'a required key can be disabled together with its dependent'
); -- 30

select throws_ok(
  $$ select * from public.set_organization_features('e1000000-0000-0000-0000-00000000000a', '{"invoicing": true}') $$,
  '23514', 'Invoicing requires Quotes', 'an add-on cannot be enabled without its requirements'
); -- 31

select lives_ok(
  $$ select * from public.set_organization_features('e1000000-0000-0000-0000-00000000000a', '{"quotes": true, "invoicing": true}') $$,
  'an add-on can be enabled together with its requirements'
); -- 32

select throws_ok(
  $$ select * from public.set_organization_features('e1000000-0000-0000-0000-00000000000a', '{"preventive_maintenance": true}') $$,
  '23514', 'Preventive maintenance isn''t available yet', 'a non-shipped module cannot be enabled'
); -- 33

select throws_ok(
  $$ select * from public.set_organization_features('e1000000-0000-0000-0000-00000000000a', '{"bogus": true}') $$,
  '23514', 'Unknown module "bogus".', 'an unknown key is refused'
); -- 34

select throws_ok(
  $$ select * from public.set_organization_features('e1000000-0000-0000-0000-00000000000a', '{"meters": "yes"}') $$,
  '23514', 'The value for module "meters" must be true or false.', 'a non-boolean value is refused'
); -- 35

select throws_ok(
  $$ select * from public.set_organization_features('e1000000-0000-0000-0000-0000000000ff', '{"meters": false}') $$,
  'P0002', 'Organization not found.', 'an unknown organization is refused'
); -- 36

select is(
  (select count(*)::int from public.list_platform_default_features() where enabled),
  13,
  'a platform admin lists the default bundle'
); -- 37

-- ---------------------------------------------------------------------------
-- Default bundle: validation, new orgs follow it, existing orgs do not
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select * from public.set_platform_default_features('{"settings": false}') $$,
  '23514', 'Settings is a core module and can''t be disabled', 'the default bundle cannot disable a core module'
); -- 38

select throws_ok(
  $$ select * from public.set_platform_default_features('{"preventive_maintenance": true}') $$,
  '23514', 'Preventive maintenance isn''t available yet', 'the default bundle cannot enable a non-shipped module'
); -- 39

select throws_ok(
  $$ select * from public.set_platform_default_features('{"quotes": false}') $$,
  '23514', 'Quotes can''t be disabled while Invoicing is enabled', 'the default bundle follows the dependency rules'
); -- 40

select is(
  (select count(*)::int from public.set_platform_default_features('{"inventory": false}')),
  1,
  'a platform admin can change the default bundle'
); -- 41

reset role;
insert into auth.users (id, email) values ('e2333333-3333-3333-3333-333333333333', 'owner-c@test.local');
insert into public.organizations (id, name, created_by) values
  ('e1000000-0000-0000-0000-00000000000c', 'Org C', 'e2333333-3333-3333-3333-333333333333');

select is(
  (select enabled from public.organization_features
    where organization_id = 'e1000000-0000-0000-0000-00000000000c' and feature_key = 'inventory'),
  false,
  'a new organization follows the changed default bundle'
); -- 42

select is(
  (select count(*)::int from public.organization_features
    where organization_id = 'e1000000-0000-0000-0000-00000000000c' and source = 'default' and enabled),
  12,
  'new organization: core + remaining default add-ons enabled, source default'
); -- 43

select is(
  (select enabled from public.organization_features
    where organization_id = 'e1000000-0000-0000-0000-00000000000b' and feature_key = 'inventory'),
  true,
  'changing the default bundle leaves existing organizations alone'
); -- 44

-- ---------------------------------------------------------------------------
-- Meters gating (Org A, contract CA active with a B/W volume line)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.contract_missing_baseline_readings_at('e6000000-0000-0000-0000-0000000000ca', '2025-12-31')),
  1,
  'meters on: a missing baseline reading is reported'
); -- 45

select throws_ok(
  $$ select public.remove_contract_asset('e6000000-0000-0000-0000-0000000000ca', 'e7000000-0000-0000-0000-0000000000a1', '2026-03-15', '[]') $$,
  '23514', null, 'meters on: remove_contract_asset requires closing readings'
); -- 46

select pg_temp.act_as('e2999999-9999-9999-9999-999999999999');
select is(
  (select count(*)::int from public.set_organization_features('e1000000-0000-0000-0000-00000000000a', '{"meters": false}')),
  1,
  'a platform admin disables meters for Org A'
); -- 47

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.contract_missing_baseline_readings_at('e6000000-0000-0000-0000-0000000000ca', '2025-12-31')),
  0,
  'meters off: no baseline readings are required'
); -- 48

select lives_ok(
  $$ select public.remove_contract_asset('e6000000-0000-0000-0000-0000000000ca', 'e7000000-0000-0000-0000-0000000000a1', '2026-03-15', '[]') $$,
  'meters off: remove_contract_asset needs no closing readings'
); -- 49

select is(
  (select removed_on from public.contract_assets where contract_id = 'e6000000-0000-0000-0000-0000000000ca'),
  '2026-03-15'::date,
  'meters off: the link is removed without readings'
); -- 50

select is(
  (select count(*)::int from public.asset_volume_readings where asset_id = 'e7000000-0000-0000-0000-0000000000a1'),
  1,
  'meters off: no closing reading was stored'
); -- 51

select is(
  public.organization_has_feature('e1000000-0000-0000-0000-00000000000a', 'meters'),
  false,
  'organization_has_feature reflects the change'
); -- 52

select * from finish();
rollback;
