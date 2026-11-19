-- pgTAP tests for public.create_field_work_order (issue #223,
-- 20261119110000_create_field_work_order.sql).
--
-- Run with: supabase test db   (requires Docker)

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email) values
  ('f2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('f2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('f2333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('f2555555-5555-5555-5555-555555555555', 'finance-a@test.local'),
  ('f2777777-7777-7777-7777-777777777777', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Org A fixtures
select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');
insert into public.organizations (id, name, created_by)
values ('f1000000-0000-0000-0000-00000000000a', 'Org A', 'f2111111-1111-1111-1111-111111111111');
insert into public.memberships (user_id, organization_id, role) values
  ('f2111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-00000000000a', 'owner'),
  ('f2222222-2222-2222-2222-222222222222', 'f1000000-0000-0000-0000-00000000000a', 'planner'),
  ('f2333333-3333-3333-3333-333333333333', 'f1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('f2555555-5555-5555-5555-555555555555', 'f1000000-0000-0000-0000-00000000000a', 'finance');
insert into public.clients (id, organization_id, name) values
  ('f3000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 'Client A');
insert into public.sites (id, client_id) values
  ('f4000000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-00000000000a'),
  ('f4000000-0000-0000-0000-00000000000b', 'f3000000-0000-0000-0000-00000000000a');
insert into public.assets (id, site_id, name, type_id, serial_number)
select 'f5000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000a', 'Asset A', rli.id, 'SN-A'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

-- Org B fixtures
select pg_temp.act_as('f2777777-7777-7777-7777-777777777777');
insert into public.organizations (id, name, created_by)
values ('f1000000-0000-0000-0000-00000000000b', 'Org B', 'f2777777-7777-7777-7777-777777777777');
insert into public.memberships (user_id, organization_id, role)
values ('f2777777-7777-7777-7777-777777777777', 'f1000000-0000-0000-0000-00000000000b', 'owner');
insert into public.clients (id, organization_id, name)
values ('f3000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-00000000000b', 'Client B');

-- Activity type item ids (read as the superuser, then exposed to the test roles)
reset role;
create temp table t_ids as
select
  (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
    where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'activity_type' and rli.value = 'storing') as storing_id,
  (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
    where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'activity_type' and rli.value = 'bel_activiteit') as bel_id;
grant select on t_ids to authenticated;

-- 1-3. Engineer, self-assigned.
select pg_temp.act_as('f2333333-3333-3333-3333-333333333333');
select lives_ok(
  $$ select * from public.create_field_work_order(
       'f3000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000a',
       'f5000000-0000-0000-0000-00000000000a', (select storing_id from t_ids), '  Leak on site  ', true) $$,
  'engineer can create a self-assigned work order'
);
select is(
  (select count(*)::int from public.work_orders wo
    join public.reference_list_items s on s.id = wo.status_id
    where wo.description = 'Leak on site' and wo.assigned_to = 'f2333333-3333-3333-3333-333333333333'
      and s.value = 'scheduled' and wo.scheduled_at is not null
      and extract(minute from wo.scheduled_at at time zone 'UTC')::int in (0, 30)
      and wo.work_order_number is not null and wo.source_activity_id is not null),
  1,
  'self-assigned work order is visible to the engineer, scheduled on a half-hour slot, numbered and linked to an activity'
);
select is(
  (select count(*)::int from public.activities a
    join public.reference_list_items s on s.id = a.status_id
    where a.description = 'Leak on site' and s.value = 'open'
      and a.reported_by = 'f2333333-3333-3333-3333-333333333333'
      and a.action_holder_id = 'f2333333-3333-3333-3333-333333333333'),
  1,
  'source activity is open with reported_by/action_holder = engineer'
);

-- 4-6. Engineer, unassigned: exists but not visible to the engineer.
select lives_ok(
  $$ select * from public.create_field_work_order(
       'f3000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000a',
       'f5000000-0000-0000-0000-00000000000a', (select storing_id from t_ids), 'Unassigned job', false) $$,
  'engineer can create an unassigned work order'
);
select is(
  (select count(*)::int from public.work_orders where description = 'Unassigned job'),
  0,
  'unassigned work order is not visible to the engineer (RLS)'
);
select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.work_orders wo
    join public.reference_list_items s on s.id = wo.status_id
    where wo.description = 'Unassigned job' and wo.assigned_to is null and wo.scheduled_at is null and s.value = 'new'),
  1,
  'unassigned work order exists for the owner with default status new'
);

-- 7-8. Planner / finance rejected.
select pg_temp.act_as('f2222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select * from public.create_field_work_order(
       'f3000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000a',
       'f5000000-0000-0000-0000-00000000000a', (select storing_id from t_ids), 'x', false) $$,
  '42501', null, 'planner is rejected');
select pg_temp.act_as('f2555555-5555-5555-5555-555555555555');
select throws_ok(
  $$ select * from public.create_field_work_order(
       'f3000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000a',
       'f5000000-0000-0000-0000-00000000000a', (select storing_id from t_ids), 'x', false) $$,
  '42501', null, 'finance is rejected');

-- 9-14. Engineer validation failures.
select pg_temp.act_as('f2333333-3333-3333-3333-333333333333');
select throws_ok(
  $$ select * from public.create_field_work_order(
       'f3000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000a',
       'f5000000-0000-0000-0000-00000000000a', (select bel_id from t_ids), 'x', false) $$,
  '22023', null, 'type outside storing/onderhoud/inspectie is rejected');
select throws_ok(
  $$ select * from public.create_field_work_order(
       'f3000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000b',
       'f5000000-0000-0000-0000-00000000000a', (select storing_id from t_ids), 'x', false) $$,
  '22023', null, 'asset not on the given site is rejected');
select throws_ok(
  $$ select * from public.create_field_work_order(
       'f3000000-0000-0000-0000-00000000000b', 'f4000000-0000-0000-0000-00000000000a',
       'f5000000-0000-0000-0000-00000000000a', (select storing_id from t_ids), 'x', false) $$,
  '42501', null, 'cross-org client is rejected');
select throws_ok(
  $$ select * from public.create_field_work_order(
       'f3000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000a',
       'f5000000-0000-0000-0000-00000000000a', (select storing_id from t_ids), '   ', false) $$,
  '22023', null, 'blank description is rejected');
select throws_ok(
  $$ select * from public.create_field_work_order(
       'f3000000-0000-0000-0000-00000000000a', null,
       'f5000000-0000-0000-0000-00000000000a', (select storing_id from t_ids), 'x', false) $$,
  '22023', null, 'missing site is rejected');
select throws_ok(
  $$ insert into public.work_orders (client_id, description) values ('f3000000-0000-0000-0000-00000000000a', 'direct') $$,
  '42501', null, 'engineer still cannot insert work orders directly (RLS unchanged)');

-- 15-16. Function privileges.
reset role;
select is(
  has_function_privilege('anon', 'public.create_field_work_order(uuid,uuid,uuid,uuid,text,boolean)', 'execute'),
  false, 'anon cannot execute the function');
select is(
  has_function_privilege('authenticated', 'public.create_field_work_order(uuid,uuid,uuid,uuid,text,boolean)', 'execute'),
  true, 'authenticated can execute the function');

select * from finish();
rollback;
