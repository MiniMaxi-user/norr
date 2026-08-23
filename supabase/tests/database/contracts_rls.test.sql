-- pgTAP RLS tests for contracts + contract_assets + work_orders.contract_id
-- (issue #33, 20260823150000_contracts_core.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/work_orders_rls.test.sql and
-- contacts_dependent_reference_lists_rls.test.sql: switch to the
-- `authenticated` role and set `request.jwt.claims` to simulate auth.uid()
-- for a given fixture user. All auth.users rows here are test fixtures,
-- rolled back at the end of the transaction.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error — the row is silently excluded (0 rows changed). Only
-- INSERT/UPDATE `WITH CHECK` violations (and column-level privilege
-- revokes) raise error 42501.
--
-- This is the SECOND table (after work_orders) whose RBAC matrix row is
-- enforced in real RLS via current_member_role, with a NEW shape: owner AND
-- finance both get full CRUD; planner/engineer/administratie are read-only.
-- Coverage: tenant isolation on both contracts and contract_assets
-- specifically; owner+finance full CRUD on contracts (including owner's own
-- direct UPDATE/DELETE, not just indirectly via other roles' rejected
-- attempts) and contract_assets (including owner's own direct DELETE);
-- planner/engineer/administratie read-only (INSERT/UPDATE/DELETE all
-- rejected); the sla_tier/contract_type dependent-list cross-field check
-- (mismatched pairing, wrong list_key, cross-org for both type_id and
-- sla_tier_id); end_date < start_date rejected; contract_assets rejects an
-- asset from a different client than the contract's own client_id;
-- contract_assets' own owner-or-finance write boundary; work_orders.contract_id
-- cross-field validation.

begin;
create extension if not exists pgtap with schema extensions;

select plan(48);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with one of each relevant role, org_b for tenant
-- isolation. Two clients in org_a (client_a, client_a2) each with their own
-- site/asset, to exercise the contract_assets client-mismatch check and the
-- work_orders.contract_id cross-client check.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('e2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('e2333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('e2444444-4444-4444-4444-444444444444', 'finance-a@test.local'),
  ('e2555555-5555-5555-5555-555555555555', 'administratie-a@test.local'),
  ('e2666666-6666-6666-6666-666666666666', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create table pg_temp.captured_ids (key text primary key, val uuid not null);

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('e1000000-0000-0000-0000-00000000000a', 'Org A', 'e2111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role) values
  ('e2111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'owner'),
  ('e2222222-2222-2222-2222-222222222222', 'e1000000-0000-0000-0000-00000000000a', 'planner'),
  ('e2333333-3333-3333-3333-333333333333', 'e1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('e2444444-4444-4444-4444-444444444444', 'e1000000-0000-0000-0000-00000000000a', 'finance'),
  ('e2555555-5555-5555-5555-555555555555', 'e1000000-0000-0000-0000-00000000000a', 'administratie');

insert into public.clients (id, organization_id, name) values
  ('e3000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'Client A'),
  ('e3000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a', 'Client A2');

insert into public.sites (id, client_id, name) values
  ('e4000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a', 'Site A'),
  ('e4000000-0000-0000-0000-00000000000b', 'e3000000-0000-0000-0000-00000000000b', 'Site A2');

insert into public.assets (id, site_id, name, type_id, serial_number)
select 'e5000000-0000-0000-0000-00000000000a', 'e4000000-0000-0000-0000-00000000000a', 'Asset A', rli.id, 'SN-A'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'e1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into public.assets (id, site_id, name, type_id, serial_number)
select 'e5000000-0000-0000-0000-00000000000b', 'e4000000-0000-0000-0000-00000000000b', 'Asset A2', rli.id, 'SN-A2'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'e1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'electrical';

-- A second contract, under client_a2, used only for the
-- work_orders.contract_id cross-client check in section 8.
insert into public.contracts (id, client_id, name, start_date)
values ('e6000000-0000-0000-0000-00000000000c', 'e3000000-0000-0000-0000-00000000000b', 'Client A2 Contract', '2026-01-01');

select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');

insert into public.organizations (id, name, created_by)
values ('e1000000-0000-0000-0000-00000000000b', 'Org B', 'e2666666-6666-6666-6666-666666666666');

insert into public.memberships (user_id, organization_id, role)
values ('e2666666-6666-6666-6666-666666666666', 'e1000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name)
values ('e3000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-00000000000b', 'Client B');

-- Capture org_b's seeded contract_type "maintenance" (default) item id,
-- needed later (while acting as owner_a) for the cross-org type_id
-- hostile-insert test.
insert into pg_temp.captured_ids (key, val)
select 'org_b_contract_type_maintenance_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'e1000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'contract_type' and rli.value = 'maintenance';

-- Capture org_b's seeded sla_tier "maintenance_standard" item id, needed
-- later (while acting as owner_a) for the cross-org sla_tier_id
-- hostile-insert test (analogous to the type_id one above).
insert into pg_temp.captured_ids (key, val)
select 'org_b_sla_tier_maintenance_standard_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'e1000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'sla_tier' and rli.value = 'maintenance_standard';

-- ---------------------------------------------------------------------------
-- 1. owner: insert, derived columns, defaults, end_date check, and the
--    sla_tier/contract_type dependent-list cross-field validation.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.contracts (id, client_id, name, start_date)
     values ('e6000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a',
       'HVAC Maintenance Agreement', '2026-01-01') $$,
  'owner_a can insert a contract under client A (org_a), type_id omitted'
); -- 1

select is(
  (select organization_id from public.contracts where id = 'e6000000-0000-0000-0000-00000000000a'),
  'e1000000-0000-0000-0000-00000000000a'::uuid,
  'contracts.organization_id was auto-derived from clients.organization_id via client_id'
); -- 2

select is(
  (select created_by from public.contracts where id = 'e6000000-0000-0000-0000-00000000000a'),
  'e2111111-1111-1111-1111-111111111111'::uuid,
  'contracts.created_by was auto-stamped to the inserting user (trigger), not client-supplied'
); -- 3

select is(
  (select rli.value from public.contracts c
     join public.reference_list_items rli on rli.id = c.type_id
     where c.id = 'e6000000-0000-0000-0000-00000000000a'),
  'maintenance',
  'contracts.type_id defaulted to the org''s default contract_type item ("maintenance") when omitted on insert'
); -- 4

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, organization_id)
     values ('e3000000-0000-0000-0000-00000000000a', 'Spoofed', '2026-01-01', 'e1000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_a cannot set contracts.organization_id directly on insert (column-level grant withheld)'
); -- 5

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, created_by)
     values ('e3000000-0000-0000-0000-00000000000a', 'Spoofed', '2026-01-01', '00000000-0000-0000-0000-000000000000') $$,
  '42501',
  null,
  'owner_a cannot set contracts.created_by directly on insert (column-level grant withheld)'
); -- 6

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, end_date)
     values ('e3000000-0000-0000-0000-00000000000a', 'Backwards Dates', '2026-06-01', '2026-01-01') $$,
  '23514',
  null,
  'contracts.end_date before start_date is rejected (contracts_end_date_after_start_date check constraint)'
); -- 7

select lives_ok(
  $$ insert into public.contracts (id, client_id, name, start_date, end_date, type_id, sla_tier_id, billing_terms_id)
     select 'e6000000-0000-0000-0000-00000000000b', 'e3000000-0000-0000-0000-00000000000a',
       'Express Service Plan', '2026-02-01', '2027-02-01',
       type_item.id, sla_item.id, billing_item.id
     from public.reference_list_items type_item
     join public.reference_lists type_list on type_list.id = type_item.reference_list_id
     join public.reference_list_items sla_item on sla_item.parent_item_id = type_item.id
     join public.reference_lists sla_list on sla_list.id = sla_item.reference_list_id
     join public.reference_list_items billing_item on true
     join public.reference_lists billing_list on billing_list.id = billing_item.reference_list_id
     where type_list.organization_id = 'e1000000-0000-0000-0000-00000000000a'
       and type_list.list_key = 'contract_type' and type_item.value = 'service'
       and sla_list.list_key = 'sla_tier' and sla_item.value = 'service_standard'
       and billing_list.organization_id = 'e1000000-0000-0000-0000-00000000000a'
       and billing_list.list_key = 'billing_terms' and billing_item.value = 'quarterly' $$,
  'owner_a can insert a contract with type_id=service, sla_tier_id=service_standard (a valid, matching pairing), billing_terms_id=quarterly'
); -- 8

select is(
  (select rli.value from public.contracts c
     join public.reference_list_items rli on rli.id = c.sla_tier_id
     where c.id = 'e6000000-0000-0000-0000-00000000000b'),
  'service_standard',
  'the just-inserted contract''s sla_tier_id resolves to service_standard'
); -- 9

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, type_id, sla_tier_id)
     select 'e3000000-0000-0000-0000-00000000000a', 'Mismatched Tier', '2026-01-01',
       type_item.id, sla_item.id
     from public.reference_list_items type_item
     join public.reference_lists type_list on type_list.id = type_item.reference_list_id
     join public.reference_list_items sla_item on true
     join public.reference_lists sla_list on sla_list.id = sla_item.reference_list_id
     where type_list.organization_id = 'e1000000-0000-0000-0000-00000000000a'
       and type_list.list_key = 'contract_type' and type_item.value = 'service'
       and sla_list.organization_id = 'e1000000-0000-0000-0000-00000000000a'
       and sla_list.list_key = 'sla_tier' and sla_item.value = 'maintenance_priority' $$,
  '23514',
  null,
  'contracts.sla_tier_id=maintenance_priority (a Maintenance tier) is rejected when type_id=service (the sla_tier item''s parent_item_id must equal type_id)'
); -- 10

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, sla_tier_id)
     select 'e3000000-0000-0000-0000-00000000000a', 'Wrong List Tier', '2026-01-01', rli.id
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'e1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'billing_terms' and rli.value = 'monthly' $$,
  '23514',
  null,
  'contracts.sla_tier_id must be from the sla_tier list, not billing_terms (validate_contract_reference_items)'
); -- 11

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, billing_terms_id)
     select 'e3000000-0000-0000-0000-00000000000a', 'Wrong List Billing', '2026-01-01', rli.id
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'e1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'contract_type' and rli.value = 'maintenance' $$,
  '23514',
  null,
  'contracts.billing_terms_id must be from the billing_terms list, not contract_type (validate_contract_reference_items)'
); -- 12

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, type_id)
     select 'e3000000-0000-0000-0000-00000000000a', 'Cross Org Type', '2026-01-01', val
     from pg_temp.captured_ids where key = 'org_b_contract_type_maintenance_id' $$,
  '23514',
  null,
  'contracts.type_id from a different organization''s contract_type list (org_b''s) is rejected'
); -- 13

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, sla_tier_id)
     select 'e3000000-0000-0000-0000-00000000000a', 'Cross Org SLA Tier', '2026-01-01', val
     from pg_temp.captured_ids where key = 'org_b_sla_tier_maintenance_standard_id' $$,
  '23514',
  null,
  'contracts.sla_tier_id from a different organization''s sla_tier list (org_b''s) is rejected (same organization_id mismatch branch as the type_id cross-org check above, checked before the parent_item_id/type_id pairing check)'
); -- 14

-- ---------------------------------------------------------------------------
-- 2. planner: read-only (RBAC matrix: planner has Read on contracts).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.contracts where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  3,
  'planner_a can SELECT contracts in org_a (3: contract_a, contract_b, and the client_a2 fixture contract — all in org_a)'
); -- 15

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date)
     values ('e3000000-0000-0000-0000-00000000000a', 'Planner Attempt', '2026-01-01') $$,
  '42501',
  null,
  'planner_a cannot INSERT a contract (RBAC matrix: planner is read-only on contracts)'
); -- 16

update public.contracts set name = 'Hijacked' where id = 'e6000000-0000-0000-0000-00000000000a';

select is(
  (select name from public.contracts where id = 'e6000000-0000-0000-0000-00000000000a'),
  'HVAC Maintenance Agreement',
  'planner_a''s UPDATE is silently excluded by RLS (read-only); name unchanged'
); -- 17

delete from public.contracts where id = 'e6000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.contracts where id = 'e6000000-0000-0000-0000-00000000000a'),
  1,
  'planner_a''s DELETE is silently excluded by RLS (read-only); row still exists'
); -- 18

-- ---------------------------------------------------------------------------
-- 3. engineer: read-only (RBAC matrix: engineer has Read on contracts).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.contracts where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  3,
  'engineer_a can SELECT contracts in org_a (read-only, all rows — no assignment scoping on contracts)'
); -- 19

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date)
     values ('e3000000-0000-0000-0000-00000000000a', 'Engineer Attempt', '2026-01-01') $$,
  '42501',
  null,
  'engineer_a cannot INSERT a contract (RBAC matrix: engineer is read-only on contracts)'
); -- 20

update public.contracts set name = 'Hijacked' where id = 'e6000000-0000-0000-0000-00000000000a';

select is(
  (select name from public.contracts where id = 'e6000000-0000-0000-0000-00000000000a'),
  'HVAC Maintenance Agreement',
  'engineer_a''s UPDATE is silently excluded by RLS (read-only); name unchanged'
); -- 21

delete from public.contracts where id = 'e6000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.contracts where id = 'e6000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a''s DELETE is silently excluded by RLS (read-only); row still exists'
); -- 22

-- ---------------------------------------------------------------------------
-- 4. administratie: read-only (RBAC matrix: administratie has Read on contracts).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2555555-5555-5555-5555-555555555555');

select is(
  (select count(*)::int from public.contracts where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  3,
  'administratie_a can SELECT contracts in org_a (read-only, all rows)'
); -- 23

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date)
     values ('e3000000-0000-0000-0000-00000000000a', 'Administratie Attempt', '2026-01-01') $$,
  '42501',
  null,
  'administratie_a cannot INSERT a contract (RBAC matrix: administratie is read-only on contracts)'
); -- 24

update public.contracts set name = 'Hijacked' where id = 'e6000000-0000-0000-0000-00000000000a';

select is(
  (select name from public.contracts where id = 'e6000000-0000-0000-0000-00000000000a'),
  'HVAC Maintenance Agreement',
  'administratie_a''s UPDATE is silently excluded by RLS (read-only); name unchanged'
); -- 25

delete from public.contracts where id = 'e6000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.contracts where id = 'e6000000-0000-0000-0000-00000000000a'),
  1,
  'administratie_a''s DELETE is silently excluded by RLS (read-only); row still exists'
); -- 26

-- ---------------------------------------------------------------------------
-- 5. finance: full CRUD, matching the RBAC matrix's contracts row exactly
--    like owner (a NEW shape vs. work_orders' owner/planner pairing).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2444444-4444-4444-4444-444444444444');

select lives_ok(
  $$ insert into public.contracts (id, client_id, name, start_date)
     values ('e6000000-0000-0000-0000-00000000000d', 'e3000000-0000-0000-0000-00000000000a', 'Disposable', '2026-01-01') $$,
  'finance_a can insert a contract in org_a'
); -- 27

select lives_ok(
  $$ update public.contracts set name = 'Renamed by Finance' where id = 'e6000000-0000-0000-0000-00000000000d' $$,
  'finance_a can update any contract in org_a, not just their own'
); -- 28

select is(
  (select name from public.contracts where id = 'e6000000-0000-0000-0000-00000000000d'),
  'Renamed by Finance',
  'finance_a''s update took effect'
); -- 29

select lives_ok(
  $$ delete from public.contracts where id = 'e6000000-0000-0000-0000-00000000000d' $$,
  'finance_a can delete a contract in org_a'
); -- 30

select is(
  (select count(*)::int from public.contracts where id = 'e6000000-0000-0000-0000-00000000000d'),
  0,
  'the disposable contract is actually gone after finance_a''s delete'
); -- 31

-- ---------------------------------------------------------------------------
-- 5b. owner: direct UPDATE and DELETE on a contracts row. Previously only
--    owner_a's INSERT was exercised directly (section 1); owner_a's own
--    UPDATE/DELETE write path was only exercised indirectly via other
--    roles' rejected attempts (sections 2-4, which target contract_a and
--    always expect the row unchanged/still present). Uses its own
--    disposable row so contract_a/contract_b are left untouched for the
--    later sections that still depend on them.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

insert into public.contracts (id, client_id, name, start_date)
values ('e6000000-0000-0000-0000-00000000000e', 'e3000000-0000-0000-0000-00000000000a', 'Owner Disposable', '2026-01-01');

select lives_ok(
  $$ update public.contracts set name = 'Owner Disposable Renamed' where id = 'e6000000-0000-0000-0000-00000000000e' $$,
  'owner_a can directly update a contract in org_a'
); -- 32

select lives_ok(
  $$ delete from public.contracts where id = 'e6000000-0000-0000-0000-00000000000e' $$,
  'owner_a can directly delete a contract in org_a'
); -- 33

-- ---------------------------------------------------------------------------
-- 6. Tenant isolation: owner_b (org_b) cannot see or write org_a's contracts.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.contracts where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s contracts'
); -- 34

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date)
     values ('e3000000-0000-0000-0000-00000000000a', 'Hostile Cross Org Insert', '2026-01-01') $$,
  '42501',
  null,
  'owner_b cannot INSERT a contract under org_a''s client (not a member of org_a at all, so current_member_role is null)'
); -- 35

-- ---------------------------------------------------------------------------
-- 7. contract_assets: the first genuine many-to-many join table. Owner/
--    finance can manage links; the linked asset must belong to the same
--    client as the contract; planner cannot write.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.contract_assets (contract_id, asset_id)
     values ('e6000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-00000000000a') $$,
  'owner_a can link asset_a (client A) to contract_a (client A) — same client'
); -- 36

select is(
  (select organization_id from public.contract_assets
     where contract_id = 'e6000000-0000-0000-0000-00000000000a' and asset_id = 'e5000000-0000-0000-0000-00000000000a'),
  'e1000000-0000-0000-0000-00000000000a'::uuid,
  'contract_assets.organization_id was auto-derived from the contract''s organization_id'
); -- 37

select throws_ok(
  $$ insert into public.contract_assets (contract_id, asset_id)
     values ('e6000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-00000000000b') $$,
  '23514',
  null,
  'linking asset_a2 (client A2) to contract_a (client A) is rejected — asset must belong to the contract''s own client, even though both are in org_a'
); -- 38

select throws_ok(
  $$ insert into public.contract_assets (contract_id, asset_id)
     values ('e6000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-00000000000a') $$,
  '23505',
  null,
  'linking the same (contract_id, asset_id) pair twice violates the primary key'
); -- 39

select lives_ok(
  $$ delete from public.contract_assets
     where contract_id = 'e6000000-0000-0000-0000-00000000000a' and asset_id = 'e5000000-0000-0000-0000-00000000000a' $$,
  'owner_a can directly delete a contract_assets link'
); -- 40

-- Re-insert the same link (as owner_a) so it exists again for the
-- tenant-isolation check on contract_assets below (section 7b) — the DELETE
-- assertion above only needs to prove the delete itself works.
insert into public.contract_assets (contract_id, asset_id)
values ('e6000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-00000000000a');

select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.contract_assets (contract_id, asset_id)
     values ('e6000000-0000-0000-0000-00000000000b', 'e5000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'planner_a cannot INSERT a contract_assets link (same owner-or-finance write boundary as contracts itself)'
); -- 41

select pg_temp.act_as('e2444444-4444-4444-4444-444444444444');

select lives_ok(
  $$ insert into public.contract_assets (contract_id, asset_id)
     values ('e6000000-0000-0000-0000-00000000000b', 'e5000000-0000-0000-0000-00000000000a') $$,
  'finance_a can insert a contract_assets link (same CRUD parity as contracts itself)'
); -- 42

select lives_ok(
  $$ delete from public.contract_assets
     where contract_id = 'e6000000-0000-0000-0000-00000000000b' and asset_id = 'e5000000-0000-0000-0000-00000000000a' $$,
  'finance_a can delete a contract_assets link'
); -- 43

select is(
  (select count(*)::int from public.contract_assets
     where contract_id = 'e6000000-0000-0000-0000-00000000000b' and asset_id = 'e5000000-0000-0000-0000-00000000000a'),
  0,
  'the deleted contract_assets link is actually gone'
); -- 44

-- ---------------------------------------------------------------------------
-- 7b. Tenant isolation on contract_assets specifically (not just contracts):
--    owner_b (org_b) cannot see org_a's contract_assets rows, and cannot
--    INSERT a link naming org_a's contract_id/asset_id directly. The insert
--    is rejected purely by the owner-or-finance RLS WITH CHECK
--    (current_member_role(organization_id) is null for a non-member), the
--    same reasoning as the contracts hostile-insert test in section 6 — the
--    referenced contract_id/asset_id are themselves a valid, already-linked
--    same-org/same-client pair (contract_a/asset_a, re-inserted above), so
--    validate_contract_asset_relations would not itself object; only the
--    RLS boundary does, giving 42501.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.contract_assets where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s contract_assets rows'
); -- 45

select throws_ok(
  $$ insert into public.contract_assets (contract_id, asset_id)
     values ('e6000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_b cannot INSERT a contract_assets link referencing org_a''s contract/asset (not a member of org_a, so current_member_role is null)'
); -- 46

-- ---------------------------------------------------------------------------
-- 8. work_orders.contract_id: must belong to the same client_id as the work
--    order (validate_work_order_relations, extended by this migration).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.work_orders (client_id, title, contract_id)
     values ('e3000000-0000-0000-0000-00000000000a', 'Scheduled Maintenance Visit', 'e6000000-0000-0000-0000-00000000000a') $$,
  'owner_a can insert a work order under client A with contract_id set to contract_a (same client)'
); -- 47

select throws_ok(
  $$ insert into public.work_orders (client_id, title, contract_id)
     values ('e3000000-0000-0000-0000-00000000000a', 'Wrong Contract Client', 'e6000000-0000-0000-0000-00000000000c') $$,
  '23514',
  null,
  'work_orders.contract_id from a different client (the Client A2 contract) is rejected when client_id=Client A'
); -- 48

select * from finish();
rollback;
