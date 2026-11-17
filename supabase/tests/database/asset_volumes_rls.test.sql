-- pgTAP RLS tests for asset volumes (issue #221, 20261118090000_asset_volumes.sql):
-- asset_model_volumes (counters configured per asset model) and
-- asset_volume_readings (immutable, chronologically monotonic meter readings),
-- plus the asset_volume_latest_readings security_invoker view.
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Same conventions as asset_components_rls.test.sql: switch to the
-- `authenticated` role and set request.jwt.claims. A USING violation on
-- DELETE silently excludes the row (0 rows); INSERT WITH CHECK violations and
-- missing column/table privileges raise 42501.

begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('a2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('a3333333-3333-3333-3333-333333333333', 'engineer1-a@test.local'),
  ('a4444444-4444-4444-4444-444444444444', 'engineer2-a@test.local'),
  ('a5555555-5555-5555-5555-555555555555', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures: org A (owner, planner, 2 engineers), org B (owner).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a1111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('ab000000-0000-0000-0000-00000000000a', 'Org A', 'a1111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role) values
  ('a1111111-1111-1111-1111-111111111111', 'ab000000-0000-0000-0000-00000000000a', 'owner'),
  ('a2222222-2222-2222-2222-222222222222', 'ab000000-0000-0000-0000-00000000000a', 'planner'),
  ('a3333333-3333-3333-3333-333333333333', 'ab000000-0000-0000-0000-00000000000a', 'engineer'),
  ('a4444444-4444-4444-4444-444444444444', 'ab000000-0000-0000-0000-00000000000a', 'engineer');

insert into public.clients (id, organization_id, name)
values ('ac000000-0000-0000-0000-00000000000a', 'ab000000-0000-0000-0000-00000000000a', 'Client A');

insert into public.sites (id, client_id, is_visit_address)
values ('ad000000-0000-0000-0000-00000000000a', 'ac000000-0000-0000-0000-00000000000a', true);

-- Asset model (seeded kyocera brand + hvac type).
insert into public.asset_models (id, organization_id, brand_item_id, type_item_id, name)
select 'ae000000-0000-0000-0000-00000000000a', 'ab000000-0000-0000-0000-00000000000a', b.id, t.id, 'Model A'
from public.reference_list_items b
join public.reference_lists bl on bl.id = b.reference_list_id
join public.reference_list_items t on t.organization_id = b.organization_id
join public.reference_lists tl on tl.id = t.reference_list_id
where bl.organization_id = 'ab000000-0000-0000-0000-00000000000a' and bl.list_key = 'asset_brand' and b.value = 'kyocera'
  and tl.list_key = 'asset_type' and t.value = 'hvac';

-- A1 has the model, A2 has none.
insert into public.assets (id, site_id, name, type_id, model_id)
select 'af000000-0000-0000-0000-0000000000a1', 'ad000000-0000-0000-0000-00000000000a', 'Asset A1', rli.id, 'ae000000-0000-0000-0000-00000000000a'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'ab000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into public.assets (id, site_id, name, type_id)
select 'af000000-0000-0000-0000-0000000000a2', 'ad000000-0000-0000-0000-00000000000a', 'Asset A2 (no model)', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'ab000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

-- Volume list items (dependent on article_unit: pick any seeded unit as parent).
insert into public.reference_list_items (id, reference_list_id, value, label, sort_order, parent_item_id)
select v.id, vl.id, v.value, v.label, v.sort_order,
  (select u.id from public.reference_list_items u join public.reference_lists ul on ul.id = u.reference_list_id
    where ul.organization_id = 'ab000000-0000-0000-0000-00000000000a' and ul.list_key = 'article_unit' order by u.sort_order limit 1)
from public.reference_lists vl,
  (values ('a0000000-0000-0000-0000-0000000000c1'::uuid, 'bw_prints', 'B/W prints', 1),
          ('a0000000-0000-0000-0000-0000000000c2'::uuid, 'color_prints', 'Color prints', 2)) as v(id, value, label, sort_order)
where vl.organization_id = 'ab000000-0000-0000-0000-00000000000a' and vl.list_key = 'volume';

select pg_temp.act_as('a5555555-5555-5555-5555-555555555555');

insert into public.organizations (id, name, created_by)
values ('ab000000-0000-0000-0000-00000000000b', 'Org B', 'a5555555-5555-5555-5555-555555555555');

insert into public.memberships (user_id, organization_id, role)
values ('a5555555-5555-5555-5555-555555555555', 'ab000000-0000-0000-0000-00000000000b', 'owner');

insert into public.reference_list_items (id, reference_list_id, value, label, sort_order, parent_item_id)
select 'a0000000-0000-0000-0000-0000000000d1', vl.id, 'bw_prints', 'B/W prints', 1,
  (select u.id from public.reference_list_items u join public.reference_lists ul on ul.id = u.reference_list_id
    where ul.organization_id = 'ab000000-0000-0000-0000-00000000000b' and ul.list_key = 'article_unit' order by u.sort_order limit 1)
from public.reference_lists vl
where vl.organization_id = 'ab000000-0000-0000-0000-00000000000b' and vl.list_key = 'volume';

-- ---------------------------------------------------------------------------
-- asset_model_volumes
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.asset_model_volumes (id, asset_model_id, volume_item_id)
     values ('a1000000-0000-0000-0000-000000000001', 'ae000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000c1') $$,
  'owner_a can configure counter c1 on model A'
); -- 1

select is(
  (select organization_id from public.asset_model_volumes where id = 'a1000000-0000-0000-0000-000000000001'),
  'ab000000-0000-0000-0000-00000000000a'::uuid,
  'asset_model_volumes.organization_id derived from the model'
); -- 2

select throws_ok(
  $$ insert into public.asset_model_volumes (asset_model_id, volume_item_id)
     values ('ae000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000c1') $$,
  '23505', null,
  'the same counter cannot be configured twice on a model'
); -- 3

select throws_ok(
  $$ insert into public.asset_model_volumes (asset_model_id, volume_item_id)
     values ('ae000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000d1') $$,
  '23514', null,
  'a volume item of another organization cannot be configured'
); -- 4

select throws_ok(
  format($$ insert into public.asset_model_volumes (asset_model_id, volume_item_id)
     values ('ae000000-0000-0000-0000-00000000000a', %L) $$,
     (select t.id from public.reference_list_items t join public.reference_lists tl on tl.id = t.reference_list_id
       where tl.organization_id = 'ab000000-0000-0000-0000-00000000000a' and tl.list_key = 'asset_type' and t.value = 'hvac')),
  '23514', null,
  'an item of a list other than `volume` cannot be configured'
); -- 5

select pg_temp.act_as('a2222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.asset_model_volumes (asset_model_id, volume_item_id)
     values ('ae000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000c2') $$,
  '42501', null,
  'planner cannot configure counters (owner-only, like asset_models)'
); -- 6

select is(
  (select count(*)::int from public.asset_model_volumes), 1,
  'planner can read the model configuration'
); -- 7

-- ---------------------------------------------------------------------------
-- Readings as engineer 1
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a3333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ insert into public.asset_volume_readings (id, asset_id, volume_item_id, value, read_at)
     values ('a2000000-0000-0000-0000-000000000001', 'af000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000c1', 100, '2026-01-10 10:00+00') $$,
  'engineer1 can insert a first reading'
); -- 8

select is(
  (select created_by from public.asset_volume_readings where id = 'a2000000-0000-0000-0000-000000000001'),
  'a3333333-3333-3333-3333-333333333333'::uuid,
  'created_by is stamped to the inserting engineer'
); -- 9

select is(
  (select organization_id from public.asset_volume_readings where id = 'a2000000-0000-0000-0000-000000000001'),
  'ab000000-0000-0000-0000-00000000000a'::uuid,
  'organization_id is derived from the asset'
); -- 10

select lives_ok(
  $$ insert into public.asset_volume_readings (id, asset_id, volume_item_id, value, read_at)
     values ('a2000000-0000-0000-0000-000000000002', 'af000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000c1', 200, '2026-01-20 10:00+00') $$,
  'engineer1 can insert a later, higher reading'
); -- 11

select throws_ok(
  $$ insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at)
     values ('af000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000c1', 150, '2026-01-25 10:00+00') $$,
  'AV002', 'asset_volume_value_below_previous',
  'a later reading lower than the previous one is rejected (AV002)'
); -- 12

select throws_ok(
  $$ insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at)
     values ('af000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000c1', 250, '2026-01-15 10:00+00') $$,
  'AV003', 'asset_volume_value_above_next',
  'a backdated reading higher than the next one is rejected (AV003)'
); -- 13

select lives_ok(
  $$ insert into public.asset_volume_readings (id, asset_id, volume_item_id, value, read_at)
     values ('a2000000-0000-0000-0000-000000000003', 'af000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000c1', 150, '2026-01-15 10:00+00') $$,
  'a backdated reading between its neighbours is accepted'
); -- 14

select throws_ok(
  $$ insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at)
     values ('af000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000c1', 150, '2026-01-15 10:00+00') $$,
  '23505', null,
  'a second reading at the same read_at is rejected (unique)'
); -- 15

select throws_ok(
  $$ insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at)
     values ('af000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000c2', 5, '2026-01-15 10:00+00') $$,
  'AV001', 'asset_volume_counter_not_configured',
  'a counter not configured on the asset''s model is rejected (AV001)'
); -- 16

select throws_ok(
  $$ insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at)
     values ('af000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000c1', 5, '2026-01-15 10:00+00') $$,
  'AV001', 'asset_volume_counter_not_configured',
  'an asset without a model is rejected (AV001)'
); -- 17

select throws_ok(
  $$ insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at)
     values ('af000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000c1', -1, '2026-01-05 10:00+00') $$,
  '23514', null,
  'a negative value is rejected'
); -- 18

select throws_ok(
  $$ update public.asset_volume_readings set value = 1 where id = 'a2000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'readings are immutable: no UPDATE privilege'
); -- 19

-- ---------------------------------------------------------------------------
-- Engineer own-row delete scoping
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a4444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from public.asset_volume_readings), 3,
  'engineer2 can read all readings of the organization'
); -- 20

select lives_ok(
  $$ delete from public.asset_volume_readings where id = 'a2000000-0000-0000-0000-000000000001' $$,
  'engineer2 deleting engineer1''s reading does not error'
); -- 21

select is(
  (select count(*)::int from public.asset_volume_readings where id = 'a2000000-0000-0000-0000-000000000001'), 1,
  'engineer2 cannot delete engineer1''s reading (row silently excluded by RLS)'
); -- 22

select pg_temp.act_as('a3333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ delete from public.asset_volume_readings where id = 'a2000000-0000-0000-0000-000000000003' $$,
  'engineer1 can delete own reading'
); -- 23

select is(
  (select count(*)::int from public.asset_volume_readings where id = 'a2000000-0000-0000-0000-000000000003'), 0,
  'engineer1''s own reading is gone'
); -- 24

-- ---------------------------------------------------------------------------
-- Planner: insert + delete anyone's; latest-readings view
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.asset_volume_readings (id, asset_id, volume_item_id, value, read_at)
     values ('a2000000-0000-0000-0000-000000000004', 'af000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000c1', 300, '2026-01-30 10:00+00') $$,
  'planner can insert a reading'
); -- 25

select is(
  (select value from public.asset_volume_latest_readings
    where asset_id = 'af000000-0000-0000-0000-0000000000a1' and volume_item_id = 'a0000000-0000-0000-0000-0000000000c1'),
  300::numeric,
  'latest-readings view returns the reading with the greatest read_at'
); -- 26

select is(
  (select client_id from public.asset_volume_latest_readings where asset_id = 'af000000-0000-0000-0000-0000000000a1'),
  'ac000000-0000-0000-0000-00000000000a'::uuid,
  'latest-readings view exposes the asset''s client_id'
); -- 27

delete from public.asset_volume_readings where id = 'a2000000-0000-0000-0000-000000000004';

select is(
  (select value from public.asset_volume_latest_readings where asset_id = 'af000000-0000-0000-0000-0000000000a1'),
  200::numeric,
  'after the planner deletes the newest reading, the latest is 200 again'
); -- 28

-- ---------------------------------------------------------------------------
-- Cross-tenant isolation
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a5555555-5555-5555-5555-555555555555');

select is(
  (select count(*)::int from public.asset_volume_readings)
  + (select count(*)::int from public.asset_model_volumes)
  + (select count(*)::int from public.asset_volume_latest_readings),
  0,
  'owner_b sees no org_a readings, configuration or latest-readings rows'
); -- 29

select throws_ok(
  $$ insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at)
     values ('af000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000c1', 999, '2026-03-01 10:00+00') $$,
  '42501', null,
  'owner_b cannot insert a reading into org_a'
); -- 30

select * from finish();
rollback;
