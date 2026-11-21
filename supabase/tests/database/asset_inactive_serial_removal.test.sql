-- pgTAP tests for issue #274 (20261126090000_asset_inactive_successor_serial_
-- contract_removal.sql): asset inactive flag + successor link, client
-- immutability, unique serial per model, contract link removal with closing
-- readings and coverage windows.
--
-- Run with: supabase test db (Docker), or against the linked project via
-- `supabase db query --linked` with a forced-exception rollback.
--
-- Coverage: seeded Decommissioned flag + backfill shape; asset client move
-- refused / same-client move ok; unique serial (active duplicate refused, case
-- and whitespace, inactive + active allowed, blank / null / other model ok,
-- put-back-in-use collision); inactive guard (direct + descendant + status
-- item toggle); new links to inactive assets refused (contract, work order,
-- component); successor link checks; remove_contract_asset (draft = delete,
-- active = removed_on + closing readings, ended refused, date bounds, settled
-- window, roles, tenant), re-add after removal, direct delete guard, coverage
-- windows, helper, RLS isolation and column grants.

begin;
create extension if not exists pgtap with schema extensions;

select plan(66);

-- Fixtures are inserted as the table owner (before any act_as).
insert into auth.users (id, email) values
  ('f2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('f2222222-2222-2222-2222-222222222222', 'owner-b@test.local'),
  ('f2333333-3333-3333-3333-333333333333', 'finance-a@test.local'),
  ('f2444444-4444-4444-4444-444444444444', 'planner-a@test.local');

insert into public.organizations (id, name, created_by) values
  ('f1000000-0000-0000-0000-00000000000a', 'Org A', 'f2111111-1111-1111-1111-111111111111'),
  ('f1000000-0000-0000-0000-00000000000b', 'Org B', 'f2222222-2222-2222-2222-222222222222');

insert into public.memberships (user_id, organization_id, role) values
  ('f2111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-00000000000a', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('f2222222-2222-2222-2222-222222222222', 'f1000000-0000-0000-0000-00000000000b', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('f2333333-3333-3333-3333-333333333333', 'f1000000-0000-0000-0000-00000000000a', 'finance');
insert into public.memberships (user_id, organization_id, role) values
  ('f2444444-4444-4444-4444-444444444444', 'f1000000-0000-0000-0000-00000000000a', 'planner');

insert into public.clients (id, organization_id, name) values
  ('f3000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-00000000000a', 'Client A1'),
  ('f3000000-0000-0000-0000-0000000000a2', 'f1000000-0000-0000-0000-00000000000a', 'Client A2'),
  ('f3000000-0000-0000-0000-0000000000b1', 'f1000000-0000-0000-0000-00000000000b', 'Client B1');

insert into public.sites (id, client_id, is_visit_address) values
  ('f4000000-0000-0000-0000-0000000000a1', 'f3000000-0000-0000-0000-0000000000a1', true),
  ('f4000000-0000-0000-0000-0000000000a3', 'f3000000-0000-0000-0000-0000000000a1', true),
  ('f4000000-0000-0000-0000-0000000000a2', 'f3000000-0000-0000-0000-0000000000a2', true),
  ('f4000000-0000-0000-0000-0000000000b1', 'f3000000-0000-0000-0000-0000000000b1', true);

insert into public.asset_models (id, organization_id, brand_item_id, type_item_id, name)
select v.id, 'f1000000-0000-0000-0000-00000000000a', b.id, t.id, v.name
from public.reference_list_items b
join public.reference_lists bl on bl.id = b.reference_list_id
join public.reference_list_items t on t.organization_id = b.organization_id
join public.reference_lists tl on tl.id = t.reference_list_id,
  (values ('f5000000-0000-0000-0000-00000000000a'::uuid, 'Model A'),
          ('f5000000-0000-0000-0000-00000000000b'::uuid, 'Model B')) as v(id, name)
where bl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and bl.list_key = 'asset_brand' and b.value = 'kyocera'
  and tl.list_key = 'asset_type' and t.value = 'hvac';

-- Two counters on model A (volume list is dependent on article_unit).
insert into public.reference_list_items (id, reference_list_id, value, label, sort_order, parent_item_id)
select v.id, vl.id, v.val, v.lbl, v.so,
  (select u.id from public.reference_list_items u join public.reference_lists ul on ul.id = u.reference_list_id
    where ul.organization_id = vl.organization_id and ul.list_key = 'article_unit' order by u.sort_order limit 1)
from public.reference_lists vl,
  (values ('f0000000-0000-0000-0000-0000000000a1'::uuid, 'bw_prints', 'B/W prints', 1),
          ('f0000000-0000-0000-0000-0000000000a2'::uuid, 'colour_prints', 'Colour prints', 2)) as v(id, val, lbl, so)
where vl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and vl.list_key = 'volume';

insert into public.asset_model_volumes (asset_model_id, volume_item_id) values
  ('f5000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-0000000000a1'),
  ('f5000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-0000000000a2');

insert into public.articles (id, organization_id, article_number, description) values
  ('f8000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 'ART-A', 'Article A');

create or replace function pg_temp.status_id(p_org uuid, p_value text) returns uuid
language sql stable as $$
  select i.id from public.reference_list_items i
  join public.reference_lists l on l.id = i.reference_list_id
  where l.organization_id = p_org and l.list_key = 'asset_status' and i.value = p_value;
$$;

-- Assets (Org A, client A1 unless noted). a1 + component a2: contract CA.
-- a3: draft contract CD. a4 parent of a5: a5 on draft contract CD.
-- a6: made inactive; a7: successor at client A2. a9: contract CS (settled
-- window). a10: contract CE (ended). a11: same serial as a6, other model.
insert into public.assets (id, site_id, name, type_id, model_id, serial_number)
select v.id, v.site, v.name, rli.id, v.model, v.serial
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id,
  (values
    ('f7000000-0000-0000-0000-0000000000a1'::uuid, 'f4000000-0000-0000-0000-0000000000a1'::uuid, 'Asset A1', 'f5000000-0000-0000-0000-00000000000a'::uuid, 'SN-1'),
    ('f7000000-0000-0000-0000-0000000000a2'::uuid, 'f4000000-0000-0000-0000-0000000000a1'::uuid, 'Asset A2', 'f5000000-0000-0000-0000-00000000000a'::uuid, null),
    ('f7000000-0000-0000-0000-0000000000a3'::uuid, 'f4000000-0000-0000-0000-0000000000a1'::uuid, 'Asset A3', 'f5000000-0000-0000-0000-00000000000a'::uuid, 'SN-3'),
    ('f7000000-0000-0000-0000-0000000000a4'::uuid, 'f4000000-0000-0000-0000-0000000000a1'::uuid, 'Asset A4', null, null),
    ('f7000000-0000-0000-0000-0000000000a5'::uuid, 'f4000000-0000-0000-0000-0000000000a1'::uuid, 'Asset A5', null, null),
    ('f7000000-0000-0000-0000-0000000000a6'::uuid, 'f4000000-0000-0000-0000-0000000000a1'::uuid, 'Asset A6', 'f5000000-0000-0000-0000-00000000000a'::uuid, 'SN-6'),
    ('f7000000-0000-0000-0000-0000000000a9'::uuid, 'f4000000-0000-0000-0000-0000000000a1'::uuid, 'Asset A9', null, null),
    ('f7000000-0000-0000-0000-0000000000aa'::uuid, 'f4000000-0000-0000-0000-0000000000a1'::uuid, 'Asset A10', null, null),
    ('f7000000-0000-0000-0000-0000000000ab'::uuid, 'f4000000-0000-0000-0000-0000000000a1'::uuid, 'Asset A11', 'f5000000-0000-0000-0000-00000000000b'::uuid, 'SN-6')
  ) as v(id, site, name, model, serial)
where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into public.asset_components (parent_asset_id, component_asset_id, quantity) values
  ('f7000000-0000-0000-0000-0000000000a1', 'f7000000-0000-0000-0000-0000000000a2', 1),
  ('f7000000-0000-0000-0000-0000000000a4', 'f7000000-0000-0000-0000-0000000000a5', 1);

-- Org B inactive asset (for the cross-organization successor check).
insert into public.assets (id, site_id, name, type_id, status_id)
select 'f7000000-0000-0000-0000-0000000000b1', 'f4000000-0000-0000-0000-0000000000b1', 'Asset B1', rli.id,
       pg_temp.status_id('f1000000-0000-0000-0000-00000000000b', 'decommissioned')
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'f1000000-0000-0000-0000-00000000000b' and rl.list_key = 'asset_type' and rli.value = 'hvac';

-- Contracts (start 2026-01-01, created as draft).
-- CA: a1 (+a2) with a B/W volume line, activated below. CD: draft, a3 + a5.
-- CS: a9, settled window. CE: a10, ended. CB: Org B contract.
insert into public.contracts (id, client_id, external_reference, start_date) values
  ('f6000000-0000-0000-0000-0000000000ca', 'f3000000-0000-0000-0000-0000000000a1', 'CA', '2026-01-01'),
  ('f6000000-0000-0000-0000-0000000000cd', 'f3000000-0000-0000-0000-0000000000a1', 'CD', '2026-01-01'),
  ('f6000000-0000-0000-0000-0000000000cc', 'f3000000-0000-0000-0000-0000000000a1', 'CS', '2026-01-01'),
  ('f6000000-0000-0000-0000-0000000000ce', 'f3000000-0000-0000-0000-0000000000a1', 'CE', '2026-01-01'),
  ('f6000000-0000-0000-0000-0000000000cb', 'f3000000-0000-0000-0000-0000000000b1', 'CB', '2026-01-01');

insert into public.contract_assets (contract_id, asset_id) values
  ('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a1'),
  ('f6000000-0000-0000-0000-0000000000cd', 'f7000000-0000-0000-0000-0000000000a3'),
  ('f6000000-0000-0000-0000-0000000000cd', 'f7000000-0000-0000-0000-0000000000a5'),
  ('f6000000-0000-0000-0000-0000000000cc', 'f7000000-0000-0000-0000-0000000000a9'),
  ('f6000000-0000-0000-0000-0000000000ce', 'f7000000-0000-0000-0000-0000000000aa');

insert into public.contract_line_items (id, contract_id, article_id, article_number, description, is_volume, volume_item_id, overage_unit_price)
values
  ('f9000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-0000000000ca', 'f8000000-0000-0000-0000-00000000000a', 'ART-A', 'Article A', true, 'f0000000-0000-0000-0000-0000000000a1', 0.05);

insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at) values
  ('f7000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000a1', 100, '2026-01-01 12:00:00+00'),
  ('f7000000-0000-0000-0000-0000000000a2', 'f0000000-0000-0000-0000-0000000000a1', 50, '2026-01-01 12:00:00+00');

update public.contracts set status = 'active'
  where id in ('f6000000-0000-0000-0000-0000000000ca', 'f6000000-0000-0000-0000-0000000000cc');
update public.contracts set status = 'active' where id = 'f6000000-0000-0000-0000-0000000000ce';
update public.contracts set status = 'ended', end_date = '2026-06-30' where id = 'f6000000-0000-0000-0000-0000000000ce';

insert into public.contract_counter_settlements (contract_id, period_start, period_end) values
  ('f6000000-0000-0000-0000-0000000000cc', '2026-01-01', '2026-02-28');

create or replace function pg_temp.type_id() returns uuid
language sql stable as $$
  select i.id from public.reference_list_items i join public.reference_lists l on l.id = i.reference_list_id
  where l.organization_id = 'f1000000-0000-0000-0000-00000000000a' and l.list_key = 'asset_type' and i.value = 'hvac';
$$;

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed flag, backfill shape
-- ---------------------------------------------------------------------------
select is(
  (select i.is_inactive from public.reference_list_items i
     join public.reference_lists l on l.id = i.reference_list_id
    where l.organization_id = 'f1000000-0000-0000-0000-00000000000a' and l.list_key = 'asset_status' and i.value = 'decommissioned'),
  true,
  'Decommissioned is seeded inactive'
); -- 1

select is(
  (select count(*)::int from public.reference_list_items i
     join public.reference_lists l on l.id = i.reference_list_id
    where l.list_key = 'asset_status' and i.value <> 'decommissioned' and i.is_inactive),
  0,
  'no other asset_status item is inactive'
); -- 2

select is(
  (select is_inactive from public.assets where id = 'f7000000-0000-0000-0000-0000000000b1'),
  true,
  'an asset inserted with an inactive status is inactive'
); -- 3

select is(
  (select is_inactive from public.assets where id = 'f7000000-0000-0000-0000-0000000000a1'),
  false,
  'an asset with the default status is not inactive'
); -- 4

select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- Client immutability
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.assets set site_id = 'f4000000-0000-0000-0000-0000000000a2' where id = 'f7000000-0000-0000-0000-0000000000a3' $$,
  '23514', null,
  'moving an asset to a site of another client is refused'
); -- 5

select lives_ok(
  $$ update public.assets set site_id = 'f4000000-0000-0000-0000-0000000000a3' where id = 'f7000000-0000-0000-0000-0000000000a3' $$,
  'moving an asset to another site of the same client is allowed'
); -- 6

select is(
  (select client_id from public.assets where id = 'f7000000-0000-0000-0000-0000000000a3'),
  'f3000000-0000-0000-0000-0000000000a1'::uuid,
  'the asset stays at its client'
); -- 7

-- ---------------------------------------------------------------------------
-- Unique serial per model among assets in use
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.assets (site_id, name, type_id, model_id, serial_number)
     values ('f4000000-0000-0000-0000-0000000000a2', 'Dup', pg_temp.type_id(), 'f5000000-0000-0000-0000-00000000000a', ' sn-1 ') $$,
  '23505', null,
  'same model + serial (case / whitespace insensitive) is refused, also at another client'
); -- 8

select lives_ok(
  $$ insert into public.assets (site_id, name, type_id, model_id, serial_number)
     values ('f4000000-0000-0000-0000-0000000000a2', 'Other model', pg_temp.type_id(), 'f5000000-0000-0000-0000-00000000000b', 'SN-1') $$,
  'same serial on another model is allowed'
); -- 9

select lives_ok(
  $$ insert into public.assets (site_id, name, type_id, model_id, serial_number) values
       ('f4000000-0000-0000-0000-0000000000a2', 'Blank 1', pg_temp.type_id(), 'f5000000-0000-0000-0000-00000000000a', '  '),
       ('f4000000-0000-0000-0000-0000000000a2', 'Blank 2', pg_temp.type_id(), 'f5000000-0000-0000-0000-00000000000a', ''),
       ('f4000000-0000-0000-0000-0000000000a2', 'Null 1', pg_temp.type_id(), 'f5000000-0000-0000-0000-00000000000a', null),
       ('f4000000-0000-0000-0000-0000000000a2', 'Null 2', pg_temp.type_id(), 'f5000000-0000-0000-0000-00000000000a', null),
       ('f4000000-0000-0000-0000-0000000000a2', 'No model 1', pg_temp.type_id(), null, 'SN-1'),
       ('f4000000-0000-0000-0000-0000000000a2', 'No model 2', pg_temp.type_id(), null, 'SN-1') $$,
  'blank / null serials and assets without a model are not constrained'
); -- 10

-- ---------------------------------------------------------------------------
-- Inactive guard
-- ---------------------------------------------------------------------------
select throws_ok(
  format($$ update public.assets set status_id = %L where id = 'f7000000-0000-0000-0000-0000000000a3' $$,
         pg_temp.status_id('f1000000-0000-0000-0000-00000000000a', 'decommissioned')),
  '23514', null,
  'an asset on a draft contract cannot be made inactive'
); -- 11

select throws_like(
  format($$ update public.assets set status_id = %L where id = 'f7000000-0000-0000-0000-0000000000a3' $$,
         pg_temp.status_id('f1000000-0000-0000-0000-00000000000a', 'decommissioned')),
  'Remove the asset from contract % first',
  'the refusal tells which contract to remove the asset from'
); -- 12

select throws_ok(
  format($$ update public.assets set status_id = %L where id = 'f7000000-0000-0000-0000-0000000000a4' $$,
         pg_temp.status_id('f1000000-0000-0000-0000-00000000000a', 'decommissioned')),
  '23514', null,
  'a parent asset whose component is on a draft contract cannot be made inactive (descendant walk)'
); -- 13

select throws_ok(
  format($$ update public.assets set status_id = %L where id = 'f7000000-0000-0000-0000-0000000000a1' $$,
         pg_temp.status_id('f1000000-0000-0000-0000-00000000000a', 'decommissioned')),
  '23514', null,
  'an asset on an active contract cannot be made inactive'
); -- 14

select lives_ok(
  format($$ update public.assets set status_id = %L where id = 'f7000000-0000-0000-0000-0000000000a2' $$,
         pg_temp.status_id('f1000000-0000-0000-0000-00000000000a', 'decommissioned')),
  'a component of a covered asset itself can be made inactive (only the contract check walks descendants downwards)'
); -- 15

select lives_ok(
  format($$ update public.assets set status_id = %L where id = 'f7000000-0000-0000-0000-0000000000a2' $$,
         pg_temp.status_id('f1000000-0000-0000-0000-00000000000a', 'active')),
  'and back'
); -- 16

select lives_ok(
  format($$ update public.assets set status_id = %L where id = 'f7000000-0000-0000-0000-0000000000a6' $$,
         pg_temp.status_id('f1000000-0000-0000-0000-00000000000a', 'decommissioned')),
  'an asset without contract links can be made inactive'
); -- 17

select is(
  (select is_inactive from public.assets where id = 'f7000000-0000-0000-0000-0000000000a6'),
  true,
  'assets.is_inactive follows the status'
); -- 18

-- Inactive frees the serial: a successor at another client may use it.
select lives_ok(
  $$ insert into public.assets (site_id, name, type_id, model_id, serial_number, previous_asset_id)
     values ('f4000000-0000-0000-0000-0000000000a2', 'Asset A7', pg_temp.type_id(),
             'f5000000-0000-0000-0000-00000000000a', 'sn-6', 'f7000000-0000-0000-0000-0000000000a6') $$,
  'a successor with the serial of an inactive asset can be created and linked'
); -- 19

select is(
  (select previous_asset_id from public.assets where id = (select id from public.assets where name = 'Asset A7')),
  'f7000000-0000-0000-0000-0000000000a6'::uuid,
  'previous_asset_id is stored'
); -- 20

-- ---------------------------------------------------------------------------
-- Successor link checks
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.assets set previous_asset_id = 'f7000000-0000-0000-0000-0000000000a6' where id = (select id from public.assets where name = 'Other model') $$,
  '23505', null,
  'an asset has at most one successor'
); -- 21

select throws_ok(
  $$ update public.assets set previous_asset_id = 'f7000000-0000-0000-0000-0000000000a1' where id = (select id from public.assets where name = 'Other model') $$,
  '23514', null,
  'the previous asset must be inactive'
); -- 22

select throws_ok(
  $$ update public.assets set previous_asset_id = (select id from public.assets where name = 'Asset A7') where id = (select id from public.assets where name = 'Asset A7') $$,
  '23514', null,
  'an asset cannot be its own previous asset'
); -- 23

select throws_ok(
  $$ update public.assets set previous_asset_id = 'f7000000-0000-0000-0000-0000000000b1' where id = (select id from public.assets where name = 'Other model') $$,
  '23514', null,
  'a previous asset of another organization is refused (invisible or cross-org)'
); -- 24

-- Putting a status back in use / the asset back to active collides with the successor's serial.
select throws_ok(
  format($$ update public.assets set status_id = %L where id = 'f7000000-0000-0000-0000-0000000000a6' $$,
         pg_temp.status_id('f1000000-0000-0000-0000-00000000000a', 'active')),
  '23505', null,
  'reactivating the old asset while the successor holds the serial is refused'
); -- 25

select throws_ok(
  format($$ update public.reference_list_items set is_inactive = false where id = %L $$,
         pg_temp.status_id('f1000000-0000-0000-0000-00000000000a', 'decommissioned')),
  '23505', 'This status cannot be put back in use: an asset with this status has the same serial number and model as an asset that is in use. Resolve the duplicate serial numbers first.',
  'switching a status back to in-use collides with the serial index (clear message)'
); -- 26

-- ---------------------------------------------------------------------------
-- New links to inactive assets
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.contract_assets (contract_id, asset_id)
     values ('f6000000-0000-0000-0000-0000000000cd', 'f7000000-0000-0000-0000-0000000000a6') $$,
  '23514', 'An inactive asset cannot be added to a contract',
  'an inactive asset cannot be added to a contract'
); -- 27

select throws_ok(
  $$ insert into public.work_orders (client_id, site_id, asset_id, external_reference)
     values ('f3000000-0000-0000-0000-0000000000a1', 'f4000000-0000-0000-0000-0000000000a1', 'f7000000-0000-0000-0000-0000000000a6', 'WO inactive') $$,
  '23514', null,
  'a work order cannot be created for an inactive asset'
); -- 28

select throws_ok(
  $$ insert into public.asset_components (parent_asset_id, component_asset_id, quantity)
     values ('f7000000-0000-0000-0000-0000000000a9', 'f7000000-0000-0000-0000-0000000000a6', 1) $$,
  '23514', null,
  'an inactive asset cannot be linked as a new component'
); -- 29

-- ---------------------------------------------------------------------------
-- Column grants
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.assets set is_inactive = true where id = 'f7000000-0000-0000-0000-0000000000a9' $$,
  '42501', null,
  'assets.is_inactive is not client-writable (update)'
); -- 30

select throws_ok(
  $$ insert into public.assets (site_id, name, type_id, is_inactive) values ('f4000000-0000-0000-0000-0000000000a1', 'Spoof', pg_temp.type_id(), true) $$,
  '42501', null,
  'assets.is_inactive is not client-writable (insert)'
); -- 31

select throws_ok(
  $$ update public.contract_assets set removed_on = '2026-02-01' where contract_id = 'f6000000-0000-0000-0000-0000000000ca' $$,
  '42501', null,
  'contract_assets removal columns are not client-writable'
); -- 32

-- ---------------------------------------------------------------------------
-- Direct delete guard
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ delete from public.contract_assets where contract_id = 'f6000000-0000-0000-0000-0000000000cc' $$,
  '23514', null,
  'a link on an active contract cannot be deleted directly'
); -- 33

-- ---------------------------------------------------------------------------
-- remove_contract_asset: refusals
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000ce', 'f7000000-0000-0000-0000-0000000000aa', '2026-03-01', '[]') $$,
  '23514', 'An asset cannot be removed from an ended contract.',
  'removing from an ended contract is refused'
); -- 34

select throws_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a1', (now() at time zone 'UTC')::date + 1, '[]') $$,
  '23514', null,
  'a removal date in the future is refused'
); -- 35

select throws_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a1', '2025-12-31', '[]') $$,
  '23514', null,
  'a removal date before the coverage start is refused'
); -- 36

select throws_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a1', null, '[]') $$,
  '23514', 'A removal date is required.',
  'a removal date is required on an active contract'
); -- 37

select throws_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000cc', 'f7000000-0000-0000-0000-0000000000a9', '2026-02-28', '[]') $$,
  '23514', 'The removal date must be after the last settled counter period (ending 2026-02-28).',
  'a removal date on or before the last settled window end is refused'
); -- 38

select throws_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a1', '2026-03-15', '[]') $$,
  '23514', 'Missing closing readings: Asset A1 – B/W prints, Asset A2 – B/W prints',
  'closing readings per counter are required (asset and component)'
); -- 39

select throws_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a1', '2026-03-15',
       '[{"asset_id":"f7000000-0000-0000-0000-0000000000a1","volume_item_id":"f0000000-0000-0000-0000-0000000000a1","value":120}]') $$,
  '23514', 'Missing closing readings: Asset A2 – B/W prints',
  'a missing component reading is reported'
); -- 40

select throws_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a1', '2026-03-15',
       '[{"asset_id":"f7000000-0000-0000-0000-0000000000a1","volume_item_id":"f0000000-0000-0000-0000-0000000000a2","value":5}]') $$,
  '23514', null,
  'a reading for a counter that has no volume line on the contract is refused'
); -- 41

select is(
  (select count(*)::int from public.asset_volume_readings
    where read_at = '2026-03-15 12:00:00+00' and asset_id in ('f7000000-0000-0000-0000-0000000000a1', 'f7000000-0000-0000-0000-0000000000a2')),
  0,
  'refused removals leave no readings behind (atomic)'
); -- 42

select throws_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a9', '2026-03-15', '[]') $$,
  'P0002', 'This asset is not linked to the contract.',
  'an asset that is not linked to the contract cannot be removed'
); -- 43

select throws_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000ff', 'f7000000-0000-0000-0000-0000000000a9', '2026-03-15', '[]') $$,
  'P0002', 'Contract not found.',
  'unknown contract'
); -- 44

-- ---------------------------------------------------------------------------
-- remove_contract_asset: happy paths
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2333333-3333-3333-3333-333333333333'); -- finance

select lives_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a1', '2026-03-15',
       '[{"asset_id":"f7000000-0000-0000-0000-0000000000a1","volume_item_id":"f0000000-0000-0000-0000-0000000000a1","value":120},
         {"asset_id":"f7000000-0000-0000-0000-0000000000a2","volume_item_id":"f0000000-0000-0000-0000-0000000000a1","value":60}]') $$,
  'finance can remove an asset from an active contract with closing readings'
); -- 45

select is(
  (select removed_on::text || ' ' || (removed_at is not null)::text || ' ' || (removed_by = 'f2333333-3333-3333-3333-333333333333')::text
     from public.contract_assets
    where contract_id = 'f6000000-0000-0000-0000-0000000000ca' and asset_id = 'f7000000-0000-0000-0000-0000000000a1'),
  '2026-03-15 true true',
  'removed_on / removed_at / removed_by are set'
); -- 46

select is(
  (select count(*)::int from public.asset_volume_readings
    where read_at = '2026-03-15 12:00:00+00' and asset_id in ('f7000000-0000-0000-0000-0000000000a1', 'f7000000-0000-0000-0000-0000000000a2')),
  2,
  'closing readings were recorded at noon UTC on the removal date'
); -- 47

select is(
  (select string_agg(asset_id::text || ':' || coverage_end::text, ',' order by asset_id) from public.contract_covered_assets('f6000000-0000-0000-0000-0000000000ca')),
  'f7000000-0000-0000-0000-0000000000a1:2026-03-15,f7000000-0000-0000-0000-0000000000a2:2026-03-15',
  'the removed window (asset + component) stays in contract_covered_assets with coverage_end'
); -- 48

select is(
  (select count(*)::int from public.contract_covered_assets('f6000000-0000-0000-0000-0000000000ca') where coverage_start = '2026-01-01'),
  2,
  'coverage_start is kept on the removed window'
); -- 49

select ok(
  public.asset_covered_by_contract_on('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a1', '2026-03-15'),
  'covered on removed_on (last covered day)'
); -- 50

select ok(
  not public.asset_covered_by_contract_on('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a2', '2026-03-16'),
  'not covered the day after removed_on (component inherits)'
); -- 51

select throws_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a1', '2026-03-15', '[]') $$,
  'P0002', null,
  'an already removed asset has no open link any more'
); -- 52

-- Re-add after removal: new coverage row, own coverage start.
select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.contract_assets (contract_id, asset_id)
     values ('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a1') $$,
  'a removed asset can be added to the same contract again'
); -- 53

select throws_ok(
  $$ insert into public.contract_assets (contract_id, asset_id)
     values ('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a1') $$,
  '23505', null,
  'but not twice while open'
); -- 54

select is(
  (select count(*)::int from public.contract_covered_assets('f6000000-0000-0000-0000-0000000000ca')),
  4,
  'two windows per asset (removed + re-added) incl. the component'
); -- 55

select is(
  (select count(*)::int from public.contract_covered_assets('f6000000-0000-0000-0000-0000000000ca')
    where coverage_end is null and coverage_start = (now() at time zone 'UTC')::date),
  2,
  'the re-added window starts today'
); -- 56

select ok(
  public.asset_covered_by_contract_on('f6000000-0000-0000-0000-0000000000ca', 'f7000000-0000-0000-0000-0000000000a1', (now() at time zone 'UTC')::date),
  'covered again through the open window'
); -- 57

-- Settled window: day after the settled period end is fine (no counters on CS).
select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000cc', 'f7000000-0000-0000-0000-0000000000a9', '2026-03-01', null) $$,
  'removing the day after the last settled window works without counter lines (no readings needed)'
); -- 58

-- Draft: plain delete, readings and date ignored.
select lives_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000cd', 'f7000000-0000-0000-0000-0000000000a3', null, null) $$,
  'removing from a draft contract is allowed without date or readings'
); -- 59

select is(
  (select count(*)::int from public.contract_assets
    where contract_id = 'f6000000-0000-0000-0000-0000000000cd' and asset_id = 'f7000000-0000-0000-0000-0000000000a3'),
  0,
  'a draft link is deleted, not kept'
); -- 60

-- ---------------------------------------------------------------------------
-- Roles and tenants
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2444444-4444-4444-4444-444444444444'); -- planner

select throws_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000cd', 'f7000000-0000-0000-0000-0000000000a5', null, null) $$,
  '42501', null,
  'a planner cannot remove an asset from a contract'
); -- 61

select pg_temp.act_as('f2222222-2222-2222-2222-222222222222'); -- owner B

select throws_ok(
  $$ select public.remove_contract_asset('f6000000-0000-0000-0000-0000000000cd', 'f7000000-0000-0000-0000-0000000000a5', null, null) $$,
  '42501', null,
  'another organization''s owner cannot remove an asset from a contract'
); -- 62

select is(
  (select count(*)::int from public.contract_assets where contract_id = 'f6000000-0000-0000-0000-0000000000ca'),
  0,
  'contract_assets (incl. removed rows) are invisible to another organization'
); -- 63

select is(
  (select count(*)::int from public.contract_covered_assets('f6000000-0000-0000-0000-0000000000ca')),
  0,
  'contract_covered_assets returns nothing across organizations'
); -- 64

select is(
  (select count(*)::int from public.assets where id in ('f7000000-0000-0000-0000-0000000000a6', (select id from public.assets where name = 'Asset A7'))),
  0,
  'inactive assets / successor links are invisible to another organization'
); -- 65

-- Contract delete cascades through the delete guard (owner of the table).
reset role;
delete from public.contracts where id = 'f6000000-0000-0000-0000-0000000000cc';

select is(
  (select count(*)::int from public.contract_assets where contract_id = 'f6000000-0000-0000-0000-0000000000cc'),
  0,
  'deleting a contract cascades its (non-draft) links despite the delete guard'
); -- 66

select * from finish();
rollback;
