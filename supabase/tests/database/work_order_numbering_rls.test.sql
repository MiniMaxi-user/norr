-- pgTAP tests for work order numbering (issue #218,
-- 20261117100000_work_order_numbering.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Not covered here: true concurrent inserts (a single pgTAP transaction cannot
-- interleave sessions); race-safety rests on the FOR UPDATE row lock in
-- assign_work_order_number(). The one-off backfill ran before any test fixtures
-- exist, so its shape is covered indirectly by the sequential WO100, WO101,
-- ... assertions (same numbering scheme) and the lazily created sequence row.
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

insert into auth.users (id, email) values
  ('d2111111-1111-1111-1111-111111111111', 'owner-wn-a@test.local'),
  ('d2222222-2222-2222-2222-222222222222', 'planner-wn-a@test.local'),
  ('d2444444-4444-4444-4444-444444444444', 'finance-wn-a@test.local'),
  ('d2555555-5555-5555-5555-555555555555', 'administratie-wn-a@test.local'),
  ('d2666666-6666-6666-6666-666666666666', 'owner-wn-b@test.local');

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
values ('d1000000-0000-0000-0000-00000000000a', 'Org WN A', 'd2111111-1111-1111-1111-111111111111');
insert into public.memberships (user_id, organization_id, role) values
  ('d2111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-00000000000a', 'owner'),
  ('d2222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-00000000000a', 'planner'),
  ('d2444444-4444-4444-4444-444444444444', 'd1000000-0000-0000-0000-00000000000a', 'finance'),
  ('d2555555-5555-5555-5555-555555555555', 'd1000000-0000-0000-0000-00000000000a', 'administratie');
insert into public.clients (id, organization_id, name)
values ('d3000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'Client WN A');

-- Org B
select pg_temp.act_as('d2666666-6666-6666-6666-666666666666');
insert into public.organizations (id, name, created_by)
values ('d1000000-0000-0000-0000-00000000000b', 'Org WN B', 'd2666666-6666-6666-6666-666666666666');
insert into public.memberships (user_id, organization_id, role)
values ('d2666666-6666-6666-6666-666666666666', 'd1000000-0000-0000-0000-00000000000b', 'owner');
insert into public.clients (id, organization_id, name)
values ('d3000000-0000-0000-0000-00000000000b', 'd1000000-0000-0000-0000-00000000000b', 'Client WN B');
insert into public.work_orders (id, client_id)
values ('d6000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-00000000000b');

-- Org A work orders (external_reference optional).
select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');
insert into public.work_orders (id, client_id)
values ('d6000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-00000000000a');
insert into public.work_orders (id, client_id, external_reference)
values ('d6000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-00000000000a', 'PO 4711');

select is(
  (select work_order_number from public.work_orders where id = 'd6000000-0000-0000-0000-000000000001'),
  'WO100', 'first work order in a new org gets WO100 (no external_reference required)'
);
select is(
  (select work_order_number from public.work_orders where id = 'd6000000-0000-0000-0000-000000000002'),
  'WO101', 'second work order gets WO101'
);
select is(
  (select external_reference from public.work_orders where id = 'd6000000-0000-0000-0000-000000000002'),
  'PO 4711', 'external_reference stored'
);

-- Tenant isolation / per-tenant numbering.
select is(
  (select count(*)::int from public.work_orders where id = 'd6000000-0000-0000-0000-00000000000b'),
  0, 'org A owner cannot see org B work order'
);
select pg_temp.act_as('d2666666-6666-6666-6666-666666666666');
select is(
  (select work_order_number from public.work_orders where id = 'd6000000-0000-0000-0000-00000000000b'),
  'WO100', 'org B has its own series, also starting at WO100'
);
select is(
  (select count(*)::int from public.work_orders where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  0, 'org B owner cannot see org A work orders'
);

-- Uniqueness per tenant.
reset role;
select col_is_unique('public', 'work_orders', array['organization_id', 'work_order_number'],
  'work_order_number is unique per organization');

-- Not writable / updatable by authenticated.
select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');
select throws_ok(
  $$ insert into public.work_orders (client_id, work_order_number)
     values ('d3000000-0000-0000-0000-00000000000a', 'HACK1') $$,
  '42501', null, 'authenticated cannot insert work_order_number'
);
select throws_ok(
  $$ update public.work_orders set work_order_number = 'HACK2' where id = 'd6000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'authenticated cannot update work_order_number'
);
reset role;
select throws_ok(
  $$ update public.work_orders set work_order_number = 'HACK3' where id = 'd6000000-0000-0000-0000-000000000001' $$,
  '42501', 'work_orders.work_order_number is immutable', 'even a privileged role cannot change work_order_number'
);

-- Settings: read access.
select pg_temp.act_as('d2555555-5555-5555-5555-555555555555');
select is(
  (select next_number from public.get_work_order_numbering_settings('d1000000-0000-0000-0000-00000000000a')),
  102, 'administratie can read settings; next_number advanced to 102'
);
select is(
  (select prefix from public.get_work_order_numbering_settings('d1000000-0000-0000-0000-00000000000a')),
  'WO', 'default prefix is WO'
);

-- Lowering rejected.
select throws_ok(
  $$ select * from public.update_work_order_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'WO', 50) $$,
  '23514', null, 'lowering next_number is rejected'
);
-- Invalid prefixes.
select throws_ok(
  $$ select * from public.update_work_order_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'con', 200) $$,
  '23514', null, 'lowercase prefix rejected'
);
select throws_ok(
  $$ select * from public.update_work_order_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'ABCDEFGHIJK', 200) $$,
  '23514', null, 'prefix longer than 10 rejected'
);
-- Raise + change prefix.
select lives_ok(
  $$ select * from public.update_work_order_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'ABC', 500) $$,
  'administratie can raise next_number and change prefix'
);

select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');
insert into public.work_orders (id, client_id)
values ('d6000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-00000000000a');
select is(
  (select work_order_number from public.work_orders where id = 'd6000000-0000-0000-0000-000000000003'),
  'ABC500', 'new work order uses the new prefix and number'
);
select is(
  (select work_order_number from public.work_orders where id = 'd6000000-0000-0000-0000-000000000001'),
  'WO100', 'existing work orders keep their old number after a prefix change'
);

-- Prefix with separator characters (- _ . /) is accepted and used literally.
select lives_ok(
  $$ select * from public.update_work_order_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'WO-', 600) $$,
  'owner can set a prefix containing a dash'
);
insert into public.work_orders (id, client_id)
values ('d6000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-00000000000a');
select is(
  (select work_order_number from public.work_orders where id = 'd6000000-0000-0000-0000-000000000004'),
  'WO-600', 'new work order uses the dashed prefix'
);

-- Other roles cannot read or change settings.
select pg_temp.act_as('d2222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select * from public.update_work_order_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'PLN', 900) $$,
  '42501', null, 'planner cannot change settings'
);
select pg_temp.act_as('d2444444-4444-4444-4444-444444444444');
select throws_ok(
  $$ select * from public.update_work_order_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'FIN', 900) $$,
  '42501', null, 'finance cannot change settings'
);
select throws_ok(
  $$ select * from public.get_work_order_numbering_settings('d1000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'finance cannot read settings'
);
-- Cross-tenant: org B owner cannot touch org A settings.
select pg_temp.act_as('d2666666-6666-6666-6666-666666666666');
select throws_ok(
  $$ select * from public.update_work_order_numbering_settings('d1000000-0000-0000-0000-00000000000a', 'EVIL', 9000) $$,
  '42501', null, 'owner of another org cannot change settings'
);
-- Direct table access denied.
select throws_ok(
  $$ select * from public.work_order_number_sequences $$,
  '42501', null, 'authenticated has no direct access to work_order_number_sequences'
);

select * from finish();
rollback;
