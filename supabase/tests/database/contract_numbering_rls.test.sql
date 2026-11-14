-- pgTAP tests for contract numbering (issue #216,
-- 20261013090000_contract_numbering.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Not covered here: true concurrent inserts (a single pgTAP transaction cannot
-- interleave sessions); race-safety rests on the FOR UPDATE row lock in
-- assign_contract_number(). The one-off backfill ran before any test fixtures
-- exist, so its shape is covered indirectly by the sequential CON100, CON101,
-- ... assertions (same numbering scheme) and the lazily created sequence row.
begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

insert into auth.users (id, email) values
  ('d2111111-1111-1111-1111-111111111111', 'owner-cn-a@test.local'),
  ('d2222222-2222-2222-2222-222222222222', 'planner-cn-a@test.local'),
  ('d2444444-4444-4444-4444-444444444444', 'finance-cn-a@test.local'),
  ('d2555555-5555-5555-5555-555555555555', 'administratie-cn-a@test.local'),
  ('d2666666-6666-6666-6666-666666666666', 'owner-cn-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Org A
select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');
insert into public.organizations (id, name, created_by)
values ('d1000000-0000-0000-0000-00000000000a', 'Org CN A', 'd2111111-1111-1111-1111-111111111111');
insert into public.memberships (user_id, organization_id, role) values
  ('d2111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-00000000000a', 'owner'),
  ('d2222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-00000000000a', 'planner'),
  ('d2444444-4444-4444-4444-444444444444', 'd1000000-0000-0000-0000-00000000000a', 'finance'),
  ('d2555555-5555-5555-5555-555555555555', 'd1000000-0000-0000-0000-00000000000a', 'administratie');
insert into public.clients (id, organization_id, name)
values ('d3000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'Client CN A');

-- Org B
select pg_temp.act_as('d2666666-6666-6666-6666-666666666666');
insert into public.organizations (id, name, created_by)
values ('d1000000-0000-0000-0000-00000000000b', 'Org CN B', 'd2666666-6666-6666-6666-666666666666');
insert into public.memberships (user_id, organization_id, role)
values ('d2666666-6666-6666-6666-666666666666', 'd1000000-0000-0000-0000-00000000000b', 'owner');
insert into public.clients (id, organization_id, name)
values ('d3000000-0000-0000-0000-00000000000b', 'd1000000-0000-0000-0000-00000000000b', 'Client CN B');
insert into public.contracts (id, client_id, start_date)
values ('d6000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-00000000000b', '2026-01-01');

-- Org A contracts (external_reference optional).
select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');
insert into public.contracts (id, client_id, start_date)
values ('d6000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-00000000000a', '2026-01-01');
insert into public.contracts (id, client_id, external_reference, start_date)
values ('d6000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-00000000000a', 'PO 4711', '2026-01-01');

select is(
  (select contract_number from public.contracts where id = 'd6000000-0000-0000-0000-000000000001'),
  'CON100', 'first contract in a new org gets CON100 (no external_reference required)'
);
select is(
  (select contract_number from public.contracts where id = 'd6000000-0000-0000-0000-000000000002'),
  'CON101', 'second contract gets CON101'
);
select is(
  (select external_reference from public.contracts where id = 'd6000000-0000-0000-0000-000000000002'),
  'PO 4711', 'external_reference stored'
);

-- Tenant isolation / per-tenant numbering.
select is(
  (select count(*)::int from public.contracts where id = 'd6000000-0000-0000-0000-00000000000b'),
  0, 'org A owner cannot see org B contract'
);
select pg_temp.act_as('d2666666-6666-6666-6666-666666666666');
select is(
  (select contract_number from public.contracts where id = 'd6000000-0000-0000-0000-00000000000b'),
  'CON100', 'org B has its own series, also starting at CON100'
);
select is(
  (select count(*)::int from public.contracts where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  0, 'org B owner cannot see org A contracts'
);

-- Uniqueness per tenant.
reset role;
select col_is_unique('public', 'contracts', array['organization_id', 'contract_number'],
  'contract_number is unique per organization');

-- Not writable / updatable by authenticated.
select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');
select throws_ok(
  $$ insert into public.contracts (client_id, start_date, contract_number)
     values ('d3000000-0000-0000-0000-00000000000a', '2026-01-01', 'HACK1') $$,
  '42501', null, 'authenticated cannot insert contract_number'
);
select throws_ok(
  $$ update public.contracts set contract_number = 'HACK2' where id = 'd6000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'authenticated cannot update contract_number'
);
reset role;
select throws_ok(
  $$ update public.contracts set contract_number = 'HACK3' where id = 'd6000000-0000-0000-0000-000000000001' $$,
  '42501', 'contracts.contract_number is immutable', 'even a privileged role cannot change contract_number'
);

-- Settings: read access.
select pg_temp.act_as('d2555555-5555-5555-5555-555555555555');
select is(
  (select next_number from public.get_contract_numbering_settings('d1000000-0000-0000-0000-00000000000a')),
  102, 'administratie can read settings; next_number advanced to 102'
);
select is(
  (select prefix from public.get_contract_numbering_settings('d1000000-0000-0000-0000-00000000000a')),
  'CON', 'default prefix is CON'
);

-- Lowering rejected.
select throws_ok(
  $$ select * from public.update_contract_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'CON', 50) $$,
  '23514', null, 'lowering next_number is rejected'
);
-- Invalid prefixes.
select throws_ok(
  $$ select * from public.update_contract_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'con', 200) $$,
  '23514', null, 'lowercase prefix rejected'
);
select throws_ok(
  $$ select * from public.update_contract_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'ABCDEFGHIJK', 200) $$,
  '23514', null, 'prefix longer than 10 rejected'
);
-- Raise + change prefix.
select lives_ok(
  $$ select * from public.update_contract_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'ABC', 500) $$,
  'administratie can raise next_number and change prefix'
);

select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');
insert into public.contracts (id, client_id, start_date)
values ('d6000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-00000000000a', '2026-01-01');
select is(
  (select contract_number from public.contracts where id = 'd6000000-0000-0000-0000-000000000003'),
  'ABC500', 'new contract uses the new prefix and number'
);
select is(
  (select contract_number from public.contracts where id = 'd6000000-0000-0000-0000-000000000001'),
  'CON100', 'existing contracts keep their old number after a prefix change'
);

-- Other roles cannot read or change settings.
select pg_temp.act_as('d2222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select * from public.update_contract_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'PLN', 900) $$,
  '42501', null, 'planner cannot change settings'
);
select pg_temp.act_as('d2444444-4444-4444-4444-444444444444');
select throws_ok(
  $$ select * from public.update_contract_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'FIN', 900) $$,
  '42501', null, 'finance cannot change settings'
);
select throws_ok(
  $$ select * from public.get_contract_numbering_settings('d1000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'finance cannot read settings'
);
-- Cross-tenant: org B owner cannot touch org A settings.
select pg_temp.act_as('d2666666-6666-6666-6666-666666666666');
select throws_ok(
  $$ select * from public.update_contract_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'EVIL', 9000) $$,
  '42501', null, 'owner of another org cannot change settings'
);
-- Direct table access denied.
select throws_ok(
  $$ select * from public.contract_number_sequences $$,
  '42501', null, 'authenticated has no direct access to contract_number_sequences'
);

select * from finish();
rollback;
