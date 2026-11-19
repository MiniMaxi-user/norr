-- pgTAP tests for asset_volume_readings.needs_review / review_reason
-- (issue #225, 20261119130000_asset_volume_readings_needs_review.sql).
--
-- Run with: supabase test db   (requires Docker)

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email) values
  ('e5111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('e5333333-3333-3333-3333-333333333333', 'engineer-a@test.local');

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
insert into public.clients (id, organization_id, name) values
  ('e7000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000a', 'Client A');
insert into public.sites (id, client_id, is_visit_address) values
  ('e8000000-0000-0000-0000-00000000000a', 'e7000000-0000-0000-0000-00000000000a', true);
insert into public.work_orders (id, client_id, external_reference, assigned_to) values
  ('e9000000-0000-0000-0000-00000000000a', 'e7000000-0000-0000-0000-00000000000a', 'WO A', 'e5333333-3333-3333-3333-333333333333');

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

-- Baseline readings (owner): c1 = 100 @ Jan 1, 200 @ Mar 1; c2 = 10 @ Jan 1.
insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at) values
  ('eb000000-0000-0000-0000-0000000000a1', 'ec000000-0000-0000-0000-0000000000c1', 100, '2026-01-01T10:00:00Z'),
  ('eb000000-0000-0000-0000-0000000000a1', 'ec000000-0000-0000-0000-0000000000c1', 200, '2026-03-01T10:00:00Z'),
  ('eb000000-0000-0000-0000-0000000000a1', 'ec000000-0000-0000-0000-0000000000c2', 10, '2026-01-01T10:00:00Z');

select pg_temp.act_as('e5333333-3333-3333-3333-333333333333');

-- Unchanged behaviour without the flag.
select throws_ok(
  $$ insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at)
     values ('eb000000-0000-0000-0000-0000000000a1', 'ec000000-0000-0000-0000-0000000000c1', 50, '2026-02-01T10:00:00Z') $$,
  'AV002', 'asset_volume_value_below_previous', 'below-previous without needs_review is still rejected');
select throws_ok(
  $$ insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at)
     values ('eb000000-0000-0000-0000-0000000000a1', 'ec000000-0000-0000-0000-0000000000c1', 300, '2026-02-01T10:00:00Z') $$,
  'AV003', 'asset_volume_value_above_next', 'above-next without needs_review is still rejected');
select throws_ok(
  $$ insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at, needs_review)
     values ('eb000000-0000-0000-0000-0000000000a1', 'ec000000-0000-0000-0000-0000000000c1', 50, '2026-02-01T10:00:00Z', false) $$,
  'AV002', 'asset_volume_value_below_previous', 'explicit needs_review=false behaves like the default');

-- Flagged below-previous / above-next are stored with a reason.
select lives_ok(
  $$ insert into public.asset_volume_readings (id, asset_id, volume_item_id, value, read_at, needs_review)
     values ('ed000000-0000-0000-0000-000000000001', 'eb000000-0000-0000-0000-0000000000a1', 'ec000000-0000-0000-0000-0000000000c1', 50, '2026-01-15T10:00:00Z', true) $$,
  'needs_review=true below-previous reading is accepted');
select is(
  (select review_reason from public.asset_volume_readings where id = 'ed000000-0000-0000-0000-000000000001'),
  'below_previous', 'review_reason = below_previous');
select lives_ok(
  $$ insert into public.asset_volume_readings (id, asset_id, volume_item_id, value, read_at, needs_review)
     values ('ed000000-0000-0000-0000-000000000002', 'eb000000-0000-0000-0000-0000000000a1', 'ec000000-0000-0000-0000-0000000000c1', 300, '2026-02-01T10:00:00Z', true) $$,
  'needs_review=true above-next reading is accepted');
select is(
  (select review_reason from public.asset_volume_readings where id = 'ed000000-0000-0000-0000-000000000002'),
  'above_next', 'review_reason = above_next');

-- Flag on a consistent reading is reset.
select lives_ok(
  $$ insert into public.asset_volume_readings (id, asset_id, volume_item_id, value, read_at, needs_review)
     values ('ed000000-0000-0000-0000-000000000003', 'eb000000-0000-0000-0000-0000000000a1', 'ec000000-0000-0000-0000-0000000000c2', 20, '2026-02-01T10:00:00Z', true) $$,
  'needs_review=true on a consistent value is accepted');
select is(
  (select row(needs_review, review_reason)::text from public.asset_volume_readings where id = 'ed000000-0000-0000-0000-000000000003'),
  '(f,)', 'needs_review=true on a consistent value ends up false/null');

-- Other checks still apply to flagged rows (asset without a model).
select throws_ok(
  $$ insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at, needs_review)
     values ('eb000000-0000-0000-0000-0000000000a2', 'ec000000-0000-0000-0000-0000000000c1', 1, '2026-02-01T10:00:00Z', true) $$,
  'AV001', 'asset_volume_counter_not_configured', 'flagged reading still requires the counter on the model');

-- Engineer on their assigned WO, via RLS; review_reason is not client-writable.
select lives_ok(
  $$ insert into public.asset_volume_readings (id, asset_id, volume_item_id, value, read_at, work_order_id, needs_review)
     values ('ed000000-0000-0000-0000-000000000004', 'eb000000-0000-0000-0000-0000000000a1', 'ec000000-0000-0000-0000-0000000000c2', 5, '2026-03-01T10:00:00Z', 'e9000000-0000-0000-0000-00000000000a', true) $$,
  'engineer can insert a flagged reading on their assigned work order');
select throws_ok(
  $$ insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at, review_reason)
     values ('eb000000-0000-0000-0000-0000000000a1', 'ec000000-0000-0000-0000-0000000000c2', 99, '2026-04-01T10:00:00Z', 'above_next') $$,
  '42501', null, 'review_reason is trigger-only (no insert grant)');

select * from finish();
rollback;
