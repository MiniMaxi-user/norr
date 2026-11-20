-- pgTAP tests for contract status / invoicing timing / baseline readings /
-- counter settlement columns (issues #269 and #270,
-- 20261123120000_contract_status_and_invoicing_timing.sql).
--
-- Run with: supabase test db (Docker), or against the linked project via
-- `supabase db query --linked` with a forced-exception rollback.
--
-- Coverage: status defaults to draft; invoicing_timing default + check;
-- status check; activation refused while baseline readings are missing (the
-- message lists asset - counter, components included) and allowed once a
-- reading on the start date exists (a reading the next day does not count);
-- ended -> active refused after the end date, allowed before it; insert as
-- active passes the same guard; contract_assets.added_on and the coverage
-- start of direct assets and components; quotes: per-period uniqueness,
-- final settlement (own unique index, exempt from the period index),
-- counter settlement uniqueness and check constraints, immutable columns;
-- tenant isolation of the new functions; coverage requires an active contract.

begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- Fixtures are inserted as the table owner (before any act_as).
insert into auth.users (id, email) values
  ('c2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('c2222222-2222-2222-2222-222222222222', 'owner-b@test.local');

insert into public.organizations (id, name, created_by) values
  ('c1000000-0000-0000-0000-00000000000a', 'Org A', 'c2111111-1111-1111-1111-111111111111'),
  ('c1000000-0000-0000-0000-00000000000b', 'Org B', 'c2222222-2222-2222-2222-222222222222');

insert into public.memberships (user_id, organization_id, role) values
  ('c2111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-00000000000a', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('c2222222-2222-2222-2222-222222222222', 'c1000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name) values
  ('c3000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Client A'),
  ('c3000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000b', 'Client B');

insert into public.sites (id, client_id, is_visit_address) values
  ('c4000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-00000000000a', true);

-- Asset model (seeded kyocera brand + hvac type) with one counter.
insert into public.asset_models (id, organization_id, brand_item_id, type_item_id, name)
select 'c5000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', b.id, t.id, 'Model A'
from public.reference_list_items b
join public.reference_lists bl on bl.id = b.reference_list_id
join public.reference_list_items t on t.organization_id = b.organization_id
join public.reference_lists tl on tl.id = t.reference_list_id
where bl.organization_id = 'c1000000-0000-0000-0000-00000000000a' and bl.list_key = 'asset_brand' and b.value = 'kyocera'
  and tl.list_key = 'asset_type' and t.value = 'hvac';

insert into public.assets (id, site_id, name, type_id, model_id)
select v.id, 'c4000000-0000-0000-0000-00000000000a', v.name, rli.id, 'c5000000-0000-0000-0000-00000000000a'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id,
  (values ('c7000000-0000-0000-0000-0000000000a1'::uuid, 'Asset A1'),
          ('c7000000-0000-0000-0000-0000000000a2'::uuid, 'Asset A2'),
          ('c7000000-0000-0000-0000-0000000000a3'::uuid, 'Asset A3')) as v(id, name)
where rl.organization_id = 'c1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

-- A2 is a component of A1.
insert into public.asset_components (parent_asset_id, component_asset_id, quantity) values
  ('c7000000-0000-0000-0000-0000000000a1', 'c7000000-0000-0000-0000-0000000000a2', 1);

-- Counter (volume list is dependent on article_unit: pick any unit as parent).
insert into public.reference_list_items (id, reference_list_id, value, label, sort_order, parent_item_id)
select 'c0000000-0000-0000-0000-0000000000a1', vl.id, 'bw_prints', 'B/W prints', 1,
  (select u.id from public.reference_list_items u join public.reference_lists ul on ul.id = u.reference_list_id
    where ul.organization_id = vl.organization_id and ul.list_key = 'article_unit' order by u.sort_order limit 1)
from public.reference_lists vl
where vl.organization_id = 'c1000000-0000-0000-0000-00000000000a' and vl.list_key = 'volume';

insert into public.asset_model_volumes (asset_model_id, volume_item_id) values
  ('c5000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1');

insert into public.articles (id, organization_id, article_number, description) values
  ('c8000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'ART-A', 'Article A');

-- C1: asset A1 (+ component A2), volume line. C2: asset A3, volume line.
insert into public.contracts (id, client_id, external_reference, start_date) values
  ('c6000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-00000000000a', 'Contract 1', '2026-01-01'),
  ('c6000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-00000000000a', 'Contract 2', '2026-01-01');

insert into public.contract_assets (contract_id, asset_id) values
  ('c6000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-0000000000a1'),
  ('c6000000-0000-0000-0000-000000000002', 'c7000000-0000-0000-0000-0000000000a3');

insert into public.contract_line_items (contract_id, article_id, is_volume, volume_item_id, overage_unit_price)
values
  ('c6000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-00000000000a', true, 'c0000000-0000-0000-0000-0000000000a1', 0.05),
  ('c6000000-0000-0000-0000-000000000002', 'c8000000-0000-0000-0000-00000000000a', true, 'c0000000-0000-0000-0000-0000000000a1', 0.05);

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- Defaults and checks
-- ---------------------------------------------------------------------------
select is(
  (select status from public.contracts where id = 'c6000000-0000-0000-0000-000000000001'),
  'draft',
  'a new contract starts as draft'
); -- 1

select is(
  (select invoicing_timing from public.contracts where id = 'c6000000-0000-0000-0000-000000000001'),
  'in_advance',
  'invoicing_timing defaults to in_advance'
); -- 2

select throws_ok(
  $$ update public.contracts set invoicing_timing = 'weekly' where id = 'c6000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'invalid invoicing_timing is rejected'
); -- 3

select throws_ok(
  $$ update public.contracts set status = 'paused' where id = 'c6000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'invalid status is rejected'
); -- 4

select lives_ok(
  $$ update public.contracts set invoicing_timing = 'in_arrears' where id = 'c6000000-0000-0000-0000-000000000001' $$,
  'owner can set invoicing_timing in_arrears'
); -- 5

-- ---------------------------------------------------------------------------
-- added_on and coverage start
-- ---------------------------------------------------------------------------
select is(
  (select added_on from public.contract_assets
    where contract_id = 'c6000000-0000-0000-0000-000000000001' and asset_id = 'c7000000-0000-0000-0000-0000000000a1'),
  null::date,
  'asset linked while the contract is draft has added_on null (covered from the start date)'
); -- 6

select is(
  (select count(*)::int from public.contract_covered_assets('c6000000-0000-0000-0000-000000000001')),
  2,
  'coverage walk returns the direct asset and its component'
); -- 7

select is(
  (select coverage_start from public.contract_covered_assets('c6000000-0000-0000-0000-000000000001')
    where asset_id = 'c7000000-0000-0000-0000-0000000000a2'),
  '2026-01-01'::date,
  'a component inherits the coverage start of its covered ancestor'
); -- 8

-- ---------------------------------------------------------------------------
-- Activation guard
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.contract_missing_baseline_readings('c6000000-0000-0000-0000-000000000001')),
  2,
  'both the asset and its component miss a baseline reading'
); -- 9

select throws_ok(
  $$ update public.contracts set status = 'active' where id = 'c6000000-0000-0000-0000-000000000001' $$,
  '23514',
  'Missing baseline readings: Asset A1 – B/W prints, Asset A2 – B/W prints',
  'activation is refused and lists each asset – counter'
); -- 10

reset role;
insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at) values
  ('c7000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', 100, '2026-01-01 23:59:59+00');
select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');

select throws_like(
  $$ update public.contracts set status = 'active' where id = 'c6000000-0000-0000-0000-000000000001' $$,
  'Missing baseline readings: Asset A2%',
  'activation is still refused while the component misses its reading'
); -- 11

reset role;
insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at) values
  ('c7000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000a1', 50, '2026-01-01 23:59:59.500+00');
select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.contract_missing_baseline_readings('c6000000-0000-0000-0000-000000000001')),
  0,
  'a reading on the start date counts (end of the UTC day)'
); -- 12

select lives_ok(
  $$ update public.contracts set status = 'active' where id = 'c6000000-0000-0000-0000-000000000001' $$,
  'activation is allowed once every baseline reading exists'
); -- 13

select is(
  (select status from public.contracts where id = 'c6000000-0000-0000-0000-000000000001'),
  'active',
  'the contract is active'
); -- 14

-- A reading the day AFTER the start date is not a baseline.
reset role;
insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at) values
  ('c7000000-0000-0000-0000-0000000000a3', 'c0000000-0000-0000-0000-0000000000a1', 10, '2026-01-02 00:00:00+00');
select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.contract_missing_baseline_readings('c6000000-0000-0000-0000-000000000002')),
  1,
  'a reading after the start date day does not count as a baseline'
); -- 15

select throws_like(
  $$ update public.contracts set status = 'active' where id = 'c6000000-0000-0000-0000-000000000002' $$,
  'Missing baseline readings: Asset A3%',
  'activation is refused when only a later reading exists'
); -- 16

-- Adding an asset to an ACTIVE contract: allowed, baseline = the date added.
insert into public.contract_assets (contract_id, asset_id)
values ('c6000000-0000-0000-0000-000000000001', 'c7000000-0000-0000-0000-0000000000a3');

select is(
  (select added_on from public.contract_assets
    where contract_id = 'c6000000-0000-0000-0000-000000000001' and asset_id = 'c7000000-0000-0000-0000-0000000000a3'),
  (now() at time zone 'UTC')::date,
  'asset added to an active contract gets added_on = today (UTC)'
); -- 17

select is(
  (select coverage_start from public.contract_covered_assets('c6000000-0000-0000-0000-000000000001')
    where asset_id = 'c7000000-0000-0000-0000-0000000000a3'),
  (now() at time zone 'UTC')::date,
  'its coverage start is the date it was added'
); -- 18

-- ---------------------------------------------------------------------------
-- Ended -> active, insert as active
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.contracts (id, client_id, external_reference, start_date, end_date, status)
     values ('c6000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-00000000000a', 'Past contract', '2025-01-01', '2025-06-30', 'active') $$,
  'inserting directly as active passes the guard when nothing is missing'
); -- 19

select lives_ok(
  $$ update public.contracts set status = 'ended' where id = 'c6000000-0000-0000-0000-000000000003' $$,
  'active -> ended is allowed'
); -- 20

select throws_ok(
  $$ update public.contracts set status = 'active' where id = 'c6000000-0000-0000-0000-000000000003' $$,
  '23514',
  'An ended contract cannot be reactivated after its end date',
  'ended -> active is refused after the end date'
); -- 21

select lives_ok(
  $$ insert into public.contracts (id, client_id, external_reference, start_date, end_date, status)
     values ('c6000000-0000-0000-0000-000000000004', 'c3000000-0000-0000-0000-00000000000a', 'Future end', '2026-01-01', '2999-12-31', 'ended') $$,
  'a contract can be inserted as ended'
); -- 22

select lives_ok(
  $$ update public.contracts set status = 'active' where id = 'c6000000-0000-0000-0000-000000000004' $$,
  'ended -> active is allowed while the end date has not passed'
); -- 23

-- ---------------------------------------------------------------------------
-- Quotes: period uniqueness, final settlement, counter settlement
-- ---------------------------------------------------------------------------
insert into public.quotes (id, client_id, name, quote_type, contract_id, contract_period_start, contract_period_end)
values ('c9000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-00000000000a', 'Period 1', 'contract',
  'c6000000-0000-0000-0000-000000000001', '2026-01-01', '2026-01-31');

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end)
     values ('c3000000-0000-0000-0000-00000000000a', 'Period 1 again', 'contract',
       'c6000000-0000-0000-0000-000000000001', '2026-01-01', '2026-01-31') $$,
  '23505', null,
  'a regular contract period still has at most one quote'
); -- 24

select lives_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end,
       counter_settlement_start, counter_settlement_end, is_final_settlement)
     values ('c3000000-0000-0000-0000-00000000000a', 'Final settlement', 'contract',
       'c6000000-0000-0000-0000-000000000001', '2026-01-01', '2026-01-31', '2026-01-01', '2026-01-31', true) $$,
  'a final settlement quote may share contract_period_start with a regular quote'
); -- 25

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end,
       counter_settlement_start, counter_settlement_end, is_final_settlement)
     values ('c3000000-0000-0000-0000-00000000000a', 'Final settlement 2', 'contract',
       'c6000000-0000-0000-0000-000000000001', '2026-02-01', '2026-02-01', '2026-02-01', '2026-02-28', true) $$,
  '23505', null,
  'a contract has at most one final settlement quote'
); -- 26

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end,
       counter_settlement_start, counter_settlement_end)
     values ('c3000000-0000-0000-0000-00000000000a', 'Settles same period', 'contract',
       'c6000000-0000-0000-0000-000000000001', '2026-02-01', '2026-02-28', '2026-01-01', '2026-01-31') $$,
  '23505', null,
  'a counter period is never settled on two quotes'
); -- 27

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end,
       counter_settlement_start)
     values ('c3000000-0000-0000-0000-00000000000a', 'Half settlement', 'contract',
       'c6000000-0000-0000-0000-000000000001', '2026-03-01', '2026-03-31', '2026-02-01') $$,
  '23514', null,
  'counter_settlement_start and _end are both set or both null'
); -- 28

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end,
       is_final_settlement)
     values ('c3000000-0000-0000-0000-00000000000a', 'Final without settlement', 'contract',
       'c6000000-0000-0000-0000-000000000004', '2026-03-01', '2026-03-31', true) $$,
  '23514', null,
  'a final settlement quote requires a settled counter period'
); -- 29

select throws_ok(
  $$ update public.quotes set is_final_settlement = true where id = 'c9000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'is_final_settlement is insert-only (no UPDATE grant)'
); -- 30

-- ---------------------------------------------------------------------------
-- Tenant isolation
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.contract_missing_baseline_readings('c6000000-0000-0000-0000-000000000002'))
  + (select count(*)::int from public.contract_covered_assets('c6000000-0000-0000-0000-000000000001')),
  0,
  'RLS: a foreign organization gets nothing from the baseline / coverage functions'
); -- 31

select * from finish();
rollback;
