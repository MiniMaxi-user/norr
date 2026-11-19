-- pgTAP tests for public.replace_work_order_volume_reading
-- (issue #230, 20261119170000_replace_work_order_volume_reading.sql).
--
-- Run with: supabase test db   (requires Docker)

begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

insert into auth.users (id, email) values
  ('e5111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('e5333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('e5444444-4444-4444-4444-444444444444', 'engineer-b@test.local'),
  ('e5555555-5555-5555-5555-555555555555', 'finance-a@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Fixtures are written as the table owner (see create_field_work_order test).
select set_config('request.jwt.claims', json_build_object('sub', 'e5111111-1111-1111-1111-111111111111')::text, true);
insert into public.organizations (id, name, created_by)
values ('e6000000-0000-0000-0000-00000000000a', 'Org A', 'e5111111-1111-1111-1111-111111111111');
insert into public.memberships (user_id, organization_id, role) values
  ('e5111111-1111-1111-1111-111111111111', 'e6000000-0000-0000-0000-00000000000a', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('e5333333-3333-3333-3333-333333333333', 'e6000000-0000-0000-0000-00000000000a', 'engineer');
insert into public.memberships (user_id, organization_id, role) values
  ('e5444444-4444-4444-4444-444444444444', 'e6000000-0000-0000-0000-00000000000a', 'engineer'),
  ('e5555555-5555-5555-5555-555555555555', 'e6000000-0000-0000-0000-00000000000a', 'finance');
insert into public.clients (id, organization_id, name) values
  ('e7000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000a', 'Client A');
insert into public.sites (id, client_id, is_visit_address) values
  ('e8000000-0000-0000-0000-00000000000a', 'e7000000-0000-0000-0000-00000000000a', true);
insert into public.work_orders (id, client_id, external_reference, assigned_to) values
  ('e9000000-0000-0000-0000-00000000000a', 'e7000000-0000-0000-0000-00000000000a', 'WO A', 'e5333333-3333-3333-3333-333333333333');
insert into public.work_orders (id, client_id, external_reference) values
  ('e9000000-0000-0000-0000-00000000000b', 'e7000000-0000-0000-0000-00000000000a', 'WO B');

insert into public.asset_models (id, organization_id, brand_item_id, type_item_id, name)
select 'ea000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000a', b.id, t.id, 'Model A'
from public.reference_list_items b
join public.reference_lists bl on bl.id = b.reference_list_id
join public.reference_list_items t on t.organization_id = b.organization_id
join public.reference_lists tl on tl.id = t.reference_list_id
where bl.organization_id = 'e6000000-0000-0000-0000-00000000000a' and bl.list_key = 'asset_brand' and b.value = 'kyocera'
  and tl.list_key = 'asset_type' and t.value = 'hvac';

-- A1 has the model, A2 has none.
insert into public.assets (id, site_id, name, type_id, model_id)
select 'eb000000-0000-0000-0000-0000000000a1', 'e8000000-0000-0000-0000-00000000000a', 'Asset A1', rli.id, 'ea000000-0000-0000-0000-00000000000a'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'e6000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';
insert into public.assets (id, site_id, name, type_id)
select 'eb000000-0000-0000-0000-0000000000a2', 'e8000000-0000-0000-0000-00000000000a', 'Asset A2 (no model)', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'e6000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

-- Counters c1/c2 (volume list), configured on the model.
insert into public.reference_list_items (id, reference_list_id, value, label, sort_order, parent_item_id)
select v.id, vl.id, v.value, v.label, v.sort_order,
  (select u.id from public.reference_list_items u join public.reference_lists ul on ul.id = u.reference_list_id
    where ul.organization_id = 'e6000000-0000-0000-0000-00000000000a' and ul.list_key = 'article_unit' order by u.sort_order limit 1)
from public.reference_lists vl,
  (values ('ec000000-0000-0000-0000-0000000000c1'::uuid, 'bw_prints', 'B/W prints', 1),
          ('ec000000-0000-0000-0000-0000000000c2'::uuid, 'color_prints', 'Color prints', 2)) as v(id, value, label, sort_order)
where vl.organization_id = 'e6000000-0000-0000-0000-00000000000a' and vl.list_key = 'volume';
insert into public.asset_model_volumes (asset_model_id, volume_item_id) values
  ('ea000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-0000000000c1'),
  ('ea000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-0000000000c2');

update public.work_orders set asset_id = 'eb000000-0000-0000-0000-0000000000a1' where id in ('e9000000-0000-0000-0000-00000000000a', 'e9000000-0000-0000-0000-00000000000b');

-- Baseline readings on WO B (owner): c1 = 100 @ Jan 1; c2 = 100 @ Jan 1.
insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at, work_order_id) values
  ('eb000000-0000-0000-0000-0000000000a1', 'ec000000-0000-0000-0000-0000000000c1', 100, '2026-01-01T10:00:00Z', 'e9000000-0000-0000-0000-00000000000b'),
  ('eb000000-0000-0000-0000-0000000000a1', 'ec000000-0000-0000-0000-0000000000c2', 100, '2026-01-01T10:00:00Z', 'e9000000-0000-0000-0000-00000000000b');

select pg_temp.act_as('e5333333-3333-3333-3333-333333333333');

-- Engineer replaces on their assigned WO: always exactly one reading per counter.
select lives_ok($$ select public.replace_work_order_volume_reading('e9000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-0000000000c1', 150, '2026-02-01T10:00:00Z'::timestamptz) $$, 'engineer can save a reading');
select lives_ok($$ select public.replace_work_order_volume_reading('e9000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-0000000000c1', 160, '2026-02-01T10:00:00Z'::timestamptz) $$, 'engineer can replace it');
select is((select count(*)::int from public.asset_volume_readings where work_order_id = 'e9000000-0000-0000-0000-00000000000a' and volume_item_id = 'ec000000-0000-0000-0000-0000000000c1'), 1, 'exactly one reading per (work order, counter) after replacing');
select is((select value from public.asset_volume_readings where work_order_id = 'e9000000-0000-0000-0000-00000000000a' and volume_item_id = 'ec000000-0000-0000-0000-0000000000c1'), 160::numeric, 'the replacement value is stored');

-- Correcting to a LOWER value works: the higher reading was the replaced one.
select lives_ok($$ select public.replace_work_order_volume_reading('e9000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-0000000000c1', 120, '2026-02-02T10:00:00Z'::timestamptz) $$, 'lower correction is not rejected against the reading it replaces');
select is((select array_agg(value) from public.asset_volume_readings where work_order_id = 'e9000000-0000-0000-0000-00000000000a' and volume_item_id = 'ec000000-0000-0000-0000-0000000000c1'), array[120::numeric], 'only the corrected reading remains');

-- A flagged (needs_review) reading below an earlier reading on WO B is stored.
select lives_ok($$ select public.replace_work_order_volume_reading('e9000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-0000000000c2', 50, '2026-01-15T10:00:00Z'::timestamptz, 'ee000000-0000-0000-0000-000000000001', true) $$, 'flagged below-previous reading is stored');
select is((select needs_review from public.asset_volume_readings where id = 'ee000000-0000-0000-0000-000000000001'), true, 'flag is kept');

-- A rejected replacement leaves the old reading intact.
select throws_ok($$ select public.replace_work_order_volume_reading('e9000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-0000000000c2', 40, '2026-01-20T10:00:00Z'::timestamptz) $$, 'AV002', 'asset_volume_value_below_previous', 'a value below an earlier reading on another work order is rejected');
select is((select row(needs_review, created_by)::text from public.asset_volume_readings where id = 'ee000000-0000-0000-0000-000000000001'), '(t,e5333333-3333-3333-3333-333333333333)', 'rejected replacement keeps the old reading (id, needs_review, created_by)');

-- Idempotent retry with the same reading id returns the existing row.
select lives_ok($$ select public.replace_work_order_volume_reading('e9000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-0000000000c2', 999, '2026-01-15T10:00:00Z'::timestamptz, 'ee000000-0000-0000-0000-000000000001', true) $$, 'retry with an existing reading id is accepted');
select is((select value from public.asset_volume_readings where id = 'ee000000-0000-0000-0000-000000000001'), 50::numeric, 'retry did not change the stored value');
select is((select count(*)::int from public.asset_volume_readings where work_order_id = 'e9000000-0000-0000-0000-00000000000a' and volume_item_id = 'ec000000-0000-0000-0000-0000000000c2'), 1, 'retry did not create a duplicate');

select throws_ok($$ select public.replace_work_order_volume_reading('e9000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-0000000000c1', 1.5, '2026-03-01T10:00:00Z'::timestamptz) $$, '22023', 'Value must be a whole number.', 'non-integer value is rejected');

-- Another engineer, not assigned to WO A, cannot see it and so cannot replace.
select pg_temp.act_as('e5444444-4444-4444-4444-444444444444');
select throws_ok($$ select public.replace_work_order_volume_reading('e9000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-0000000000c1', 500, '2026-03-01T10:00:00Z'::timestamptz) $$, 'P0002', 'Work order not found.', 'engineer cannot replace on an unassigned work order');

-- Finance may not write readings.
select pg_temp.act_as('e5555555-5555-5555-5555-555555555555');
select throws_ok($$ select public.replace_work_order_volume_reading('e9000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-0000000000c1', 500, '2026-03-01T10:00:00Z'::timestamptz) $$, '42501', null, 'finance is rejected');

-- Owner replaces everything on this WO for the counter (engineer rows included), WO B untouched.
select pg_temp.act_as('e5111111-1111-1111-1111-111111111111');
select lives_ok($$ select public.replace_work_order_volume_reading('e9000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-0000000000c1', 130, '2026-02-03T10:00:00Z'::timestamptz) $$, 'owner can replace the engineer reading');
select is((select count(*)::int from public.asset_volume_readings where work_order_id = 'e9000000-0000-0000-0000-00000000000a' and volume_item_id = 'ec000000-0000-0000-0000-0000000000c1'), 1, 'owner replace leaves one reading on the work order');
select is((select count(*)::int from public.asset_volume_readings where work_order_id = 'e9000000-0000-0000-0000-00000000000b' and volume_item_id = 'ec000000-0000-0000-0000-0000000000c1'), 1, 'readings on other work orders are untouched');

reset role;
select ok(not has_function_privilege('anon', 'public.replace_work_order_volume_reading(uuid, uuid, numeric, timestamptz, uuid, boolean, text)', 'execute'), 'anon cannot execute');
select ok(has_function_privilege('authenticated', 'public.replace_work_order_volume_reading(uuid, uuid, numeric, timestamptz, uuid, boolean, text)', 'execute'), 'authenticated can execute');

select * from finish();
rollback;
