-- pgTAP tests for contract final balance / counter settlement frequency /
-- under-use credit (issue #271, 20261124090000_contract_final_balance.sql and the race guard of 20261124100000).
--
-- Run with: supabase test db (Docker), or against the linked project via
-- `supabase db query --linked` with a forced-exception rollback.
--
-- Coverage: contracts frequency/month checks and defaults; credit_under_use
-- check and reset on counter detach; quotes final/counter settlement checks
-- and the per-period unique index; ledger RLS (member read, owner/planner/
-- finance write, engineer + other tenant refused), derived organization,
-- unique window, same-contract quote, cascade on quote delete; guard against
-- reactivating a contract with a final settlement; advance_contract_on_invoice
-- / credit_invoice ignoring counter settlement quotes; complete_contract_end
-- refusals (role, tenant, dates, uncovered asset, foreign counter, foreign /
-- invoiced quote) and happy paths (with and without quote).

begin;
create extension if not exists pgtap with schema extensions;

select plan(57);

-- Fixtures are inserted as the table owner (before any act_as).
insert into auth.users (id, email) values
  ('d2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('d2222222-2222-2222-2222-222222222222', 'owner-b@test.local'),
  ('d2333333-3333-3333-3333-333333333333', 'finance-a@test.local'),
  ('d2444444-4444-4444-4444-444444444444', 'planner-a@test.local'),
  ('d2555555-5555-5555-5555-555555555555', 'engineer-a@test.local');

insert into public.organizations (id, name, created_by) values
  ('d1000000-0000-0000-0000-00000000000a', 'Org A', 'd2111111-1111-1111-1111-111111111111'),
  ('d1000000-0000-0000-0000-00000000000b', 'Org B', 'd2222222-2222-2222-2222-222222222222');

insert into public.memberships (user_id, organization_id, role) values
  ('d2111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-00000000000a', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('d2222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-00000000000b', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('d2333333-3333-3333-3333-333333333333', 'd1000000-0000-0000-0000-00000000000a', 'finance');
insert into public.memberships (user_id, organization_id, role) values
  ('d2444444-4444-4444-4444-444444444444', 'd1000000-0000-0000-0000-00000000000a', 'planner');
insert into public.memberships (user_id, organization_id, role) values
  ('d2555555-5555-5555-5555-555555555555', 'd1000000-0000-0000-0000-00000000000a', 'engineer');

insert into public.clients (id, organization_id, name) values
  ('d3000000-0000-0000-0000-0000000000a0', 'd1000000-0000-0000-0000-00000000000a', 'Own company A'),
  ('d3000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'Client A'),
  ('d3000000-0000-0000-0000-00000000000b', 'd1000000-0000-0000-0000-00000000000b', 'Client B');

update public.organizations set own_client_id = 'd3000000-0000-0000-0000-0000000000a0'
  where id = 'd1000000-0000-0000-0000-00000000000a';

insert into public.sites (id, client_id, is_visit_address) values
  ('d4000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-00000000000a', true);

insert into public.asset_models (id, organization_id, brand_item_id, type_item_id, name)
select 'd5000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', b.id, t.id, 'Model A'
from public.reference_list_items b
join public.reference_lists bl on bl.id = b.reference_list_id
join public.reference_list_items t on t.organization_id = b.organization_id
join public.reference_lists tl on tl.id = t.reference_list_id
where bl.organization_id = 'd1000000-0000-0000-0000-00000000000a' and bl.list_key = 'asset_brand' and b.value = 'kyocera'
  and tl.list_key = 'asset_type' and t.value = 'hvac';

insert into public.assets (id, site_id, name, type_id, model_id)
select v.id, 'd4000000-0000-0000-0000-00000000000a', v.name, rli.id, 'd5000000-0000-0000-0000-00000000000a'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id,
  (values ('d7000000-0000-0000-0000-0000000000a1'::uuid, 'Asset A1'),
          ('d7000000-0000-0000-0000-0000000000a2'::uuid, 'Asset A2'),
          ('d7000000-0000-0000-0000-0000000000a3'::uuid, 'Asset A3')) as v(id, name)
where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

-- A2 is a component of A1.
insert into public.asset_components (parent_asset_id, component_asset_id, quantity) values
  ('d7000000-0000-0000-0000-0000000000a1', 'd7000000-0000-0000-0000-0000000000a2', 1);

-- Two counters (volume list is dependent on article_unit: any unit as parent).
insert into public.reference_list_items (id, reference_list_id, value, label, sort_order, parent_item_id)
select v.id, vl.id, v.val, v.lbl, v.so,
  (select u.id from public.reference_list_items u join public.reference_lists ul on ul.id = u.reference_list_id
    where ul.organization_id = vl.organization_id and ul.list_key = 'article_unit' order by u.sort_order limit 1)
from public.reference_lists vl,
  (values ('d0000000-0000-0000-0000-0000000000a1'::uuid, 'bw_prints', 'B/W prints', 1),
          ('d0000000-0000-0000-0000-0000000000a2'::uuid, 'colour_prints', 'Colour prints', 2)) as v(id, val, lbl, so)
where vl.organization_id = 'd1000000-0000-0000-0000-00000000000a' and vl.list_key = 'volume';

insert into public.asset_model_volumes (asset_model_id, volume_item_id) values
  ('d5000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-0000000000a1'),
  ('d5000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-0000000000a2');

insert into public.articles (id, organization_id, article_number, description) values
  ('d8000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'ART-A', 'Article A');

-- C1: asset A1 (+ component A2), B/W volume line; the happy-path contract.
-- C2: quote constraint / invoicing contract. C3: ended with final quote.
-- C4: active, no assets (legacy ended without final quote path).
-- C5: Org B contract. C6: scratch contract for line/frequency checks.
insert into public.contracts (id, client_id, external_reference, start_date) values
  ('d6000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-00000000000a', 'Contract 1', '2026-01-01'),
  ('d6000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-00000000000a', 'Contract 2', '2026-01-01'),
  ('d6000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-00000000000a', 'Contract 3', '2026-01-01'),
  ('d6000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-00000000000a', 'Contract 4', '2026-01-01'),
  ('d6000000-0000-0000-0000-000000000005', 'd3000000-0000-0000-0000-00000000000b', 'Contract 5', '2026-01-01'),
  ('d6000000-0000-0000-0000-000000000006', 'd3000000-0000-0000-0000-00000000000a', 'Contract 6', '2026-01-01');

insert into public.contract_assets (contract_id, asset_id) values
  ('d6000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-0000000000a1');

insert into public.contract_line_items (id, contract_id, article_id, article_number, description, is_volume, volume_item_id, overage_unit_price)
values
  ('d9000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 'd8000000-0000-0000-0000-00000000000a', 'ART-A', 'Article A', true, 'd0000000-0000-0000-0000-0000000000a1', 0.05);

-- Baseline readings, then activate C1, C3, C4.
insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at) values
  ('d7000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1', 100, '2026-01-01 12:00:00+00'),
  ('d7000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-0000000000a1', 50, '2026-01-01 12:00:00+00');

update public.contracts set status = 'active'
  where id in ('d6000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000003',
               'd6000000-0000-0000-0000-000000000004');

-- Quotes (table owner): C2 period quote P1 + counter quote QC (later period
-- start) for the invoicing checks; C1 invoiced period quote QI and an
-- un-invoiced period quote QD; C2 period quote QX (foreign quote for C1).
insert into public.quotes (id, client_id, name, quote_type, contract_id, contract_period_start, contract_period_end) values
  ('da000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-00000000000a', 'C2 P1', 'contract', 'd6000000-0000-0000-0000-000000000002', '2026-01-01', '2026-01-31'),
  ('da000000-0000-0000-0000-0000000000a1', 'd3000000-0000-0000-0000-00000000000a', 'C1 invoiced period', 'contract', 'd6000000-0000-0000-0000-000000000001', '2026-01-01', '2026-01-31'),
  ('da000000-0000-0000-0000-0000000000a2', 'd3000000-0000-0000-0000-00000000000a', 'C1 open period', 'contract', 'd6000000-0000-0000-0000-000000000001', '2026-02-01', '2026-02-28'),
  ('da000000-0000-0000-0000-0000000000b1', 'd3000000-0000-0000-0000-00000000000a', 'C2 other period', 'contract', 'd6000000-0000-0000-0000-000000000002', '2026-03-01', '2026-03-31');
insert into public.quotes (id, client_id, name, quote_type, contract_id, contract_period_start, contract_period_end,
                           counter_settlement_start, counter_settlement_end, is_counter_settlement) values
  ('da000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-00000000000a', 'C2 counter', 'contract', 'd6000000-0000-0000-0000-000000000002', '2026-02-01', '2026-02-28', '2025-01-01', '2025-12-31', true);

insert into public.quote_line_items (quote_id, description, quantity, unit_price) values
  ('da000000-0000-0000-0000-000000000001', 'Period', 1, 100),
  ('da000000-0000-0000-0000-000000000002', 'Counter', 1, 10),
  ('da000000-0000-0000-0000-0000000000a1', 'Period', 1, 100);

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- contracts: frequency / month
-- ---------------------------------------------------------------------------
select is(
  (select counter_settlement_frequency from public.contracts where id = 'd6000000-0000-0000-0000-000000000006'),
  'with_invoice',
  'counter_settlement_frequency defaults to with_invoice'
); -- 1

select throws_ok(
  $$ update public.contracts set counter_settlement_frequency = 'weekly' where id = 'd6000000-0000-0000-0000-000000000006' $$,
  '23514', null, 'invalid frequency is rejected'
); -- 2

select throws_ok(
  $$ update public.contracts set counter_settlement_frequency = 'quarterly' where id = 'd6000000-0000-0000-0000-000000000006' $$,
  '23514', null, 'quarterly without a settlement month is rejected'
); -- 3

select throws_ok(
  $$ update public.contracts set counter_settlement_month = 3 where id = 'd6000000-0000-0000-0000-000000000006' $$,
  '23514', null, 'a settlement month with frequency with_invoice is rejected'
); -- 4

select throws_ok(
  $$ update public.contracts set counter_settlement_frequency = 'annually', counter_settlement_month = 13 where id = 'd6000000-0000-0000-0000-000000000006' $$,
  '23514', null, 'settlement month outside 1..12 is rejected'
); -- 5

select lives_ok(
  $$ update public.contracts set counter_settlement_frequency = 'annually', counter_settlement_month = 1,
       end_scheduled_at = now(), end_date_before_scheduling = '2027-01-01'
     where id = 'd6000000-0000-0000-0000-000000000006' $$,
  'owner can set annually + month and the scheduled-ending columns'
); -- 6

-- ---------------------------------------------------------------------------
-- contract_line_items.credit_under_use
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.contract_line_items (contract_id, article_id, credit_under_use)
     values ('d6000000-0000-0000-0000-000000000006', 'd8000000-0000-0000-0000-00000000000a', true) $$,
  '23514', null, 'credit_under_use on a non-volume line is rejected'
); -- 7

select throws_ok(
  $$ insert into public.contract_line_items (contract_id, article_id, is_volume, credit_under_use)
     values ('d6000000-0000-0000-0000-000000000006', 'd8000000-0000-0000-0000-00000000000a', true, true) $$,
  '23514', null, 'credit_under_use on a volume line without a counter is rejected'
); -- 8

select lives_ok(
  $$ insert into public.contract_line_items (id, contract_id, article_id, is_volume, volume_item_id, credit_under_use)
     values ('d9000000-0000-0000-0000-000000000006', 'd6000000-0000-0000-0000-000000000006', 'd8000000-0000-0000-0000-00000000000a',
             true, 'd0000000-0000-0000-0000-0000000000a1', true) $$,
  'credit_under_use on a volume line with a counter is accepted'
); -- 9

select lives_ok(
  $$ update public.contract_line_items set volume_item_id = null where id = 'd9000000-0000-0000-0000-000000000006' $$,
  'detaching the counter does not violate the check'
); -- 10

select is(
  (select credit_under_use from public.contract_line_items where id = 'd9000000-0000-0000-0000-000000000006'),
  false,
  'detaching the counter switched credit_under_use off'
); -- 11

-- ---------------------------------------------------------------------------
-- quotes: final / counter settlement checks (as table owner)
-- ---------------------------------------------------------------------------
reset role;

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end,
       counter_settlement_start, counter_settlement_end, is_final_settlement, is_counter_settlement)
     values ('d3000000-0000-0000-0000-00000000000a', 'both', 'contract', 'd6000000-0000-0000-0000-000000000006',
       '2026-05-01', '2026-05-31', '2026-05-01', '2026-05-31', true, true) $$,
  '23514', null, 'a quote cannot be both final and counter settlement'
); -- 12

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end, is_counter_settlement)
     values ('d3000000-0000-0000-0000-00000000000a', 'counter w/o window', 'contract', 'd6000000-0000-0000-0000-000000000006',
       '2026-05-01', '2026-05-31', true) $$,
  '23514', null, 'a counter settlement quote requires counter_settlement_start'
); -- 13

select lives_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end, is_final_settlement)
     values ('d3000000-0000-0000-0000-00000000000a', 'final w/o counter part', 'contract', 'd6000000-0000-0000-0000-000000000006',
       '2026-05-01', '2026-05-31', true) $$,
  'a final settlement quote may carry no counter part'
); -- 14

select lives_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end,
       counter_settlement_start, counter_settlement_end, is_counter_settlement)
     values ('d3000000-0000-0000-0000-00000000000a', 'counter same start as a period', 'contract', 'd6000000-0000-0000-0000-000000000002',
       '2026-01-01', '2026-01-31', '2024-01-01', '2024-12-31', true) $$,
  'a counter settlement quote does not collide with the per-period unique index'
); -- 15

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end)
     values ('d3000000-0000-0000-0000-00000000000a', 'dup period', 'contract', 'd6000000-0000-0000-0000-000000000002',
       '2026-01-01', '2026-01-31') $$,
  '23505', null, 'two period quotes for the same period are still refused'
); -- 16

-- ---------------------------------------------------------------------------
-- Invoicing: counter settlement quotes are not periods
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ select public.create_invoice('da000000-0000-0000-0000-000000000001') $$,
  'owner invoices the period quote'
); -- 17

select is(
  (select invoiced_period_count from public.contracts where id = 'd6000000-0000-0000-0000-000000000002'),
  1,
  'invoicing a period quote advances invoiced_period_count'
); -- 18

select lives_ok(
  $$ select public.create_invoice('da000000-0000-0000-0000-000000000002') $$,
  'owner invoices the counter settlement quote'
); -- 19

select is(
  (select invoiced_period_count from public.contracts where id = 'd6000000-0000-0000-0000-000000000002'),
  1,
  'invoicing a counter settlement quote does not advance invoiced_period_count'
); -- 20

select lives_ok(
  $$ select public.credit_invoice(
       (select id from public.invoices where quote_id = 'da000000-0000-0000-0000-000000000001' and kind = 'invoice'),
       'test') $$,
  'the period invoice can be credited although a later counter settlement quote is invoiced'
); -- 21

select is(
  (select invoiced_period_count from public.contracts where id = 'd6000000-0000-0000-0000-000000000002'),
  0,
  'crediting the period rolled invoiced_period_count back'
); -- 22

-- ---------------------------------------------------------------------------
-- Ledger RLS
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.contract_counter_settlements (contract_id, period_start, period_end, details)
     values ('d6000000-0000-0000-0000-000000000006', '2025-01-01', '2025-12-31', '[{"counter":"x"}]') $$,
  'owner can insert a ledger row without a quote'
); -- 23

select is(
  (select organization_id from public.contract_counter_settlements where contract_id = 'd6000000-0000-0000-0000-000000000006'),
  'd1000000-0000-0000-0000-00000000000a'::uuid,
  'organization_id is derived from the contract'
); -- 24

select throws_ok(
  $$ insert into public.contract_counter_settlements (contract_id, period_start, period_end)
     values ('d6000000-0000-0000-0000-000000000006', '2025-01-01', '2025-06-30') $$,
  '23505', null, 'a window start can only be settled once per contract'
); -- 25

select throws_ok(
  $$ insert into public.contract_counter_settlements (contract_id, period_start, period_end)
     values ('d6000000-0000-0000-0000-000000000006', '2026-03-31', '2026-03-01') $$,
  '23514', null, 'period_end before period_start is rejected'
); -- 26

select throws_ok(
  $$ insert into public.contract_counter_settlements (contract_id, period_start, period_end, quote_id)
     values ('d6000000-0000-0000-0000-000000000006', '2026-03-01', '2026-03-31', 'da000000-0000-0000-0000-000000000001') $$,
  '23514', null, 'a ledger row cannot point to a quote of another contract'
); -- 27

select pg_temp.act_as('d2444444-4444-4444-4444-444444444444');
select lives_ok(
  $$ insert into public.contract_counter_settlements (contract_id, period_start, period_end)
     values ('d6000000-0000-0000-0000-000000000006', '2026-01-01', '2026-01-31') $$,
  'planner can insert a ledger row (batch generation)'
); -- 28

select pg_temp.act_as('d2555555-5555-5555-5555-555555555555');
select throws_ok(
  $$ insert into public.contract_counter_settlements (contract_id, period_start, period_end)
     values ('d6000000-0000-0000-0000-000000000006', '2026-02-01', '2026-02-28') $$,
  '42501', null, 'engineer cannot insert a ledger row'
); -- 29

select is(
  (select count(*)::int from public.contract_counter_settlements),
  2,
  'engineer (member) can read the ledger'
); -- 30

select pg_temp.act_as('d2222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.contract_counter_settlements),
  0,
  'another tenant sees no ledger rows'
); -- 31

select throws_ok(
  $$ insert into public.contract_counter_settlements (contract_id, period_start, period_end)
     values ('d6000000-0000-0000-0000-000000000006', '2026-02-01', '2026-02-28') $$,
  '42501', null, 'another tenant cannot insert for our contract'
); -- 32

delete from public.contract_counter_settlements;
reset role;
select is(
  (select count(*)::int from public.contract_counter_settlements),
  2,
  'another tenant cannot delete ledger rows'
); -- 33

-- Deleting a quote un-settles its window.
insert into public.contract_counter_settlements (contract_id, period_start, period_end, quote_id)
  values ('d6000000-0000-0000-0000-000000000002', '2024-01-01', '2024-12-31',
          (select id from public.quotes where name = 'counter same start as a period'));
delete from public.quotes where name = 'counter same start as a period';
select is(
  (select count(*)::int from public.contract_counter_settlements where contract_id = 'd6000000-0000-0000-0000-000000000002' and period_start = '2024-01-01'),
  0,
  'deleting a quote removes its ledger row (window un-settled)'
); -- 34

-- ---------------------------------------------------------------------------
-- Guard: no reactivation once a final settlement exists
-- ---------------------------------------------------------------------------
insert into public.quotes (id, client_id, name, quote_type, contract_id, contract_period_start, contract_period_end, is_final_settlement)
  values ('da000000-0000-0000-0000-0000000000f3', 'd3000000-0000-0000-0000-00000000000a', 'C3 final', 'contract',
          'd6000000-0000-0000-0000-000000000003', '2026-06-01', '2026-06-30', true);
update public.contracts set status = 'ended', end_date = '2026-05-31' where id = 'd6000000-0000-0000-0000-000000000003';

select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');
select throws_ok(
  $$ update public.contracts set status = 'active' where id = 'd6000000-0000-0000-0000-000000000003' $$,
  '23514', 'An ended contract with a final settlement cannot be reactivated',
  'ended -> active is refused when a final settlement quote exists'
); -- 35

-- ---------------------------------------------------------------------------
-- complete_contract_end: refusals
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d2444444-4444-4444-4444-444444444444');
select throws_ok(
  $$ select public.complete_contract_end('d6000000-0000-0000-0000-000000000001', (now() at time zone 'UTC')::date, '[]', null, '[]', '[]', '{}') $$,
  '42501', null, 'a planner cannot complete a contract end'
); -- 36

select pg_temp.act_as('d2222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select public.complete_contract_end('d6000000-0000-0000-0000-000000000001', (now() at time zone 'UTC')::date, '[]', null, '[]', '[]', '{}') $$,
  '42501', null, 'another tenant cannot complete a contract end'
); -- 37

select pg_temp.act_as('d2333333-3333-3333-3333-333333333333');
select throws_ok(
  $$ select public.complete_contract_end('d6000000-0000-0000-0000-000000000001', ((now() at time zone 'UTC')::date + 1), '[]', null, '[]', '[]', '{}') $$,
  '23514', null, 'an end date in the future is refused'
); -- 38

select throws_ok(
  $$ select public.complete_contract_end('d6000000-0000-0000-0000-000000000001', '2025-12-31', '[]', null, '[]', '[]', '{}') $$,
  '23514', null, 'an end date before the start date is refused'
); -- 39

select throws_ok(
  $$ select public.complete_contract_end('d6000000-0000-0000-0000-000000000001', (now() at time zone 'UTC')::date,
       '[{"asset_id":"d7000000-0000-0000-0000-0000000000a3","volume_item_id":"d0000000-0000-0000-0000-0000000000a1","value":10}]',
       null, '[]', '[]', array['da000000-0000-0000-0000-0000000000a2']::uuid[]) $$,
  '23514', null, 'a closing reading for an uncovered asset is refused'
); -- 40

select throws_ok(
  $$ select public.complete_contract_end('d6000000-0000-0000-0000-000000000001', (now() at time zone 'UTC')::date,
       '[{"asset_id":"d7000000-0000-0000-0000-0000000000a1","volume_item_id":"d0000000-0000-0000-0000-0000000000a2","value":150}]',
       null, '[]', '[]', array['da000000-0000-0000-0000-0000000000a2']::uuid[]) $$,
  '23514', null, 'a closing reading for a counter the contract does not use is refused'
); -- 41

select throws_ok(
  $$ select public.complete_contract_end('d6000000-0000-0000-0000-000000000001', (now() at time zone 'UTC')::date, '[]', null, '[]', '[]',
       array['da000000-0000-0000-0000-0000000000b1', 'da000000-0000-0000-0000-0000000000a2']::uuid[]) $$,
  '23514', null, 'deleting a quote of another contract is refused'
); -- 42

select throws_ok(
  $$ select public.complete_contract_end('d6000000-0000-0000-0000-000000000003', (now() at time zone 'UTC')::date, '[]', null, '[]', '[]', '{}') $$,
  '23514', null, 'a contract that already has a final settlement cannot be completed again'
); -- 43

-- Invoice the C1 quote that must not be deletable (as owner), then try.
select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');
select public.create_invoice('da000000-0000-0000-0000-0000000000a1');

select pg_temp.act_as('d2333333-3333-3333-3333-333333333333');
select throws_ok(
  $$ select public.complete_contract_end('d6000000-0000-0000-0000-000000000001', (now() at time zone 'UTC')::date, '[]', null, '[]', '[]',
       array['da000000-0000-0000-0000-0000000000a1', 'da000000-0000-0000-0000-0000000000a2']::uuid[]) $$,
  '23514', null, 'deleting an invoiced quote is refused'
); -- 44

select throws_ok(
  $$ select public.complete_contract_end('d6000000-0000-0000-0000-000000000001', (now() at time zone 'UTC')::date, '[]', null, '[]', '[]', '{}') $$,
  '23514', 'New contract quotes were created meanwhile; reload the final balance.',
  'race guard: a surviving un-invoiced period quote refuses the completion'
); -- 56

select throws_ok(
  $$ select public.complete_contract_end('d6000000-0000-0000-0000-000000000001', (now() at time zone 'UTC')::date, '[]', null, '[]',
       '[{"period_start":"2026-01-01","period_end":"2026-01-31","details":[]}]', '{}') $$,
  '23514', 'New contract quotes were created meanwhile; reload the final balance.',
  'race guard also fires when the settlement windows are given'
); -- 57

-- ---------------------------------------------------------------------------
-- complete_contract_end: happy paths (as finance)
-- ---------------------------------------------------------------------------
create temp table result (quote_id uuid);
grant all on result to authenticated;

insert into result
select public.complete_contract_end(
  'd6000000-0000-0000-0000-000000000001',
  (now() at time zone 'UTC')::date,
  '[{"asset_id":"d7000000-0000-0000-0000-0000000000a1","volume_item_id":"d0000000-0000-0000-0000-0000000000a1","value":150},
    {"asset_id":"d7000000-0000-0000-0000-0000000000a2","volume_item_id":"d0000000-0000-0000-0000-0000000000a1","value":80}]'::jsonb,
  ('{"name":"Final settlement C1","notes":"n","contract_period_start":"' || ((now() at time zone 'UTC')::date + 1) ||
   '","contract_period_end":"' || ((now() at time zone 'UTC')::date + 1) ||
   '","counter_settlement_start":"2026-01-01","counter_settlement_end":"' || ((now() at time zone 'UTC')::date) || '"}')::jsonb,
  '[{"article_id":"d8000000-0000-0000-0000-00000000000a","article_number":"ART-A","description":"Open period","quantity":0.5,"unit_price":100,"sort_order":1},
    {"article_id":"d8000000-0000-0000-0000-00000000000a","article_number":"ART-A","description":"Credit","quantity":-0.25,"unit_price":100,"sort_order":2}]'::jsonb,
  ('[{"period_start":"2026-01-01","period_end":"' || ((now() at time zone 'UTC')::date) || '","details":[{"counter":"B/W"}]}]')::jsonb,
  array['da000000-0000-0000-0000-0000000000a2']::uuid[]
);

select ok(
  (select q.is_final_settlement and q.contract_id = 'd6000000-0000-0000-0000-000000000001'
     from public.quotes q join result r on r.quote_id = q.id),
  'the RPC returns the id of a final settlement quote of the contract'
); -- 45

select is(
  (select count(*)::int from public.quote_line_items l join result r on r.quote_id = l.quote_id where l.quantity < 0),
  1,
  'the final quote has its lines, including the negative credit line'
); -- 46

select is(
  (select (status, end_date, end_scheduled_at, end_date_before_scheduling)::text
     from public.contracts where id = 'd6000000-0000-0000-0000-000000000001'),
  '(ended,' || (now() at time zone 'UTC')::date || ',,)',
  'the contract is ended with end_date set and the scheduled-ending columns cleared'
); -- 47

select is(
  (select count(*)::int from public.asset_volume_readings
    where asset_id in ('d7000000-0000-0000-0000-0000000000a1', 'd7000000-0000-0000-0000-0000000000a2')
      and read_at = (((now() at time zone 'UTC')::date)::timestamp + interval '12 hours') at time zone 'UTC'
      and not needs_review),
  2,
  'closing readings were saved at 12:00 UTC on the end date'
); -- 48

select is(
  (select count(*)::int from public.contract_counter_settlements s join result r on r.quote_id = s.quote_id where s.is_final),
  1,
  'a final ledger row points at the final quote'
); -- 49

select is(
  (select count(*)::int from public.quotes where id = 'da000000-0000-0000-0000-0000000000a2'),
  0,
  'the replaced un-invoiced period quote was deleted'
); -- 50

select is(
  (select count(*)::int from public.quotes where id = 'da000000-0000-0000-0000-0000000000a1'),
  1,
  'the invoiced period quote is untouched'
); -- 51

select throws_ok(
  $$ select public.complete_contract_end('d6000000-0000-0000-0000-000000000001', (now() at time zone 'UTC')::date, '[]', null, '[]', '[]', '{}') $$,
  '23514', null, 'completing again is refused'
); -- 52

select throws_ok(
  $$ update public.contracts set status = 'active' where id = 'd6000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'the completed contract cannot be reactivated'
); -- 53

-- Legacy path: active contract, nothing to bill, no quote.
select is(
  (select public.complete_contract_end('d6000000-0000-0000-0000-000000000004', '2026-06-30', '[]', null, '[]', '[]', '{}')),
  null::uuid,
  'without quote the RPC returns null'
); -- 54

select is(
  (select status || ' ' || end_date from public.contracts where id = 'd6000000-0000-0000-0000-000000000004'),
  'ended 2026-06-30',
  'the contract without a quote is ended on the given date'
); -- 55

select * from finish();
rollback;
