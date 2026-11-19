-- pgTAP tests for activity and quote numbering (issue #228,
-- 20261119160000_activity_numbering.sql + 20261119160100_quote_numbering.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Not covered: true concurrent inserts (single transaction); race-safety rests
-- on the FOR UPDATE row lock in assign_activity_number()/assign_quote_number().
-- The backfill ran before fixtures exist; its shape is covered by the
-- not-null + unique constraints and the sequential numbering assertions.
begin;
create extension if not exists pgtap with schema extensions;

select plan(47);

insert into auth.users (id, email) values
  ('e2111111-1111-1111-1111-111111111111', 'owner-an-a@test.local'),
  ('e2222222-2222-2222-2222-222222222222', 'planner-an-a@test.local'),
  ('e2444444-4444-4444-4444-444444444444', 'finance-an-a@test.local'),
  ('e2555555-5555-5555-5555-555555555555', 'administratie-an-a@test.local'),
  ('e2666666-6666-6666-6666-666666666666', 'owner-an-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Fixtures are written as the table owner.
select set_config('request.jwt.claims', json_build_object('sub', 'e2111111-1111-1111-1111-111111111111')::text, true);
insert into public.organizations (id, name, created_by) values ('e1000000-0000-0000-0000-00000000000a', 'Org AN A', 'e2111111-1111-1111-1111-111111111111');
insert into public.memberships (user_id, organization_id, role) values
  ('e2111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'owner'),
  ('e2222222-2222-2222-2222-222222222222', 'e1000000-0000-0000-0000-00000000000a', 'planner'),
  ('e2444444-4444-4444-4444-444444444444', 'e1000000-0000-0000-0000-00000000000a', 'finance'),
  ('e2555555-5555-5555-5555-555555555555', 'e1000000-0000-0000-0000-00000000000a', 'administratie');
insert into public.clients (id, organization_id, name) values ('e3000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'Client AN A');

select set_config('request.jwt.claims', json_build_object('sub', 'e2666666-6666-6666-6666-666666666666')::text, true);
insert into public.organizations (id, name, created_by) values ('e1000000-0000-0000-0000-00000000000b', 'Org AN B', 'e2666666-6666-6666-6666-666666666666');
insert into public.memberships (user_id, organization_id, role) values ('e2666666-6666-6666-6666-666666666666', 'e1000000-0000-0000-0000-00000000000b', 'owner');
insert into public.clients (id, organization_id, name) values ('e3000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b', 'Client AN B');

-- A work order in org B: its DB-trigger auto-draft quote must get Q100.
insert into public.work_orders (id, client_id) values ('e9000000-0000-0000-0000-00000000000b', 'e3000000-0000-0000-0000-00000000000b');
select is(
  (select quote_number from public.quotes where work_order_id = 'e9000000-0000-0000-0000-00000000000b'),
  'Q100', 'auto-draft quote created by the work order trigger gets a quote number'
);

-- ===========================================================================
-- activity
-- ===========================================================================
select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');
insert into public.activities (id, client_id, type_id, description) values ('e6000000-0000-0000-0000-00000000000b', 'e3000000-0000-0000-0000-00000000000b', (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id where rl.organization_id = 'e1000000-0000-0000-0000-00000000000b' and rl.list_key = 'activity_type' and rli.value = 'afspraak'), 'B act');
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');
insert into public.activities (id, client_id, type_id, description) values ('e6000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-00000000000a', (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id where rl.organization_id = 'e1000000-0000-0000-0000-00000000000a' and rl.list_key = 'activity_type' and rli.value = 'afspraak'), 'A act 1');
insert into public.activities (id, client_id, type_id, description) values ('e6000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-00000000000a', (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id where rl.organization_id = 'e1000000-0000-0000-0000-00000000000a' and rl.list_key = 'activity_type' and rli.value = 'afspraak'), 'A act 2');

select is((select activity_number from public.activities where id = 'e6000000-0000-0000-0000-000000000001'), 'ACT100', 'first activity in a new org gets ACT100');
select is((select activity_number from public.activities where id = 'e6000000-0000-0000-0000-000000000002'), 'ACT101', 'second activity gets ACT101');
select is((select count(*)::int from public.activities where id = 'e6000000-0000-0000-0000-00000000000b'), 0, 'org A owner cannot see org B activity');
select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');
select is((select activity_number from public.activities where id = 'e6000000-0000-0000-0000-00000000000b'), 'ACT100', 'org B has its own series');
select is((select count(*)::int from public.activities where organization_id = 'e1000000-0000-0000-0000-00000000000a'), 0, 'org B owner cannot see org A activities');
reset role;
select col_is_unique('public', 'activities', array['organization_id', 'activity_number'], 'activity_number is unique per organization');
select col_not_null('public', 'activities', 'activity_number', 'activity_number is not null (backfill numbered every existing row)');

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');
select throws_ok($$ insert into public.activities (client_id, type_id, description, activity_number) values ('e3000000-0000-0000-0000-00000000000a', (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id where rl.organization_id = 'e1000000-0000-0000-0000-00000000000a' and rl.list_key = 'activity_type' and rli.value = 'afspraak'), 'x', 'HACK1') $$, '42501', null, 'authenticated cannot insert activity_number');
select throws_ok($$ update public.activities set activity_number = 'HACK2' where id = 'e6000000-0000-0000-0000-000000000001' $$, '42501', null, 'authenticated cannot update activity_number');
reset role;
select throws_ok($$ update public.activities set activity_number = 'HACK3' where id = 'e6000000-0000-0000-0000-000000000001' $$, '42501', 'activities.activity_number is immutable', 'even a privileged role cannot change activity_number');

select pg_temp.act_as('e2555555-5555-5555-5555-555555555555');
select is((select next_number from public.get_activity_numbering_settings('e1000000-0000-0000-0000-00000000000a')), 102, 'administratie can read settings; next_number advanced to 102');
select is((select prefix from public.get_activity_numbering_settings('e1000000-0000-0000-0000-00000000000a')), 'ACT', 'default prefix is ACT');
select throws_ok($$ select * from public.update_activity_numbering_settings('e1000000-0000-0000-0000-00000000000a', 'ACT', 50) $$, '23514', null, 'lowering next_number is rejected');
select throws_ok($$ select * from public.update_activity_numbering_settings('e1000000-0000-0000-0000-00000000000a', 'con', 200) $$, '23514', null, 'lowercase prefix rejected');
select throws_ok($$ select * from public.update_activity_numbering_settings('e1000000-0000-0000-0000-00000000000a', 'ABCDEFGHIJK', 200) $$, '23514', null, 'prefix longer than 10 rejected');
select lives_ok($$ select * from public.update_activity_numbering_settings('e1000000-0000-0000-0000-00000000000a', 'ABC', 500) $$, 'administratie can raise next_number and change prefix');

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');
insert into public.activities (id, client_id, type_id, description) values ('e6000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-00000000000a', (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id where rl.organization_id = 'e1000000-0000-0000-0000-00000000000a' and rl.list_key = 'activity_type' and rli.value = 'afspraak'), 'A act 3');
select is((select activity_number from public.activities where id = 'e6000000-0000-0000-0000-000000000003'), 'ABC500', 'new activity uses the new prefix and number');
select is((select activity_number from public.activities where id = 'e6000000-0000-0000-0000-000000000001'), 'ACT100', 'existing activities keep their old number after a prefix change');

select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');
select throws_ok($$ select * from public.update_activity_numbering_settings('e1000000-0000-0000-0000-00000000000a', 'PLN', 900) $$, '42501', null, 'planner cannot change settings');
select pg_temp.act_as('e2444444-4444-4444-4444-444444444444');
select throws_ok($$ select * from public.get_activity_numbering_settings('e1000000-0000-0000-0000-00000000000a') $$, '42501', null, 'finance cannot read settings');
select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');
select throws_ok($$ select * from public.update_activity_numbering_settings('e1000000-0000-0000-0000-00000000000a', 'EVIL', 9000) $$, '42501', null, 'owner of another org cannot change settings');
select throws_ok($$ select * from public.activity_number_sequences $$, '42501', null, 'authenticated has no direct access to activity_number_sequences');
reset role;
select is(
  has_function_privilege('anon', 'public.get_activity_numbering_settings(uuid)', 'execute')
    or has_function_privilege('anon', 'public.update_activity_numbering_settings(uuid, text, integer)', 'execute'),
  false, 'anon cannot execute the activity numbering functions');

-- ===========================================================================
-- quote
-- ===========================================================================
select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');
insert into public.quotes (id, client_id, name) values ('e7000000-0000-0000-0000-00000000000b', 'e3000000-0000-0000-0000-00000000000b', 'B quote');
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');
insert into public.quotes (id, client_id, name) values ('e7000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-00000000000a', 'A quote 1');
insert into public.quotes (id, client_id, name) values ('e7000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-00000000000a', 'A quote 2');

select is((select quote_number from public.quotes where id = 'e7000000-0000-0000-0000-000000000001'), 'Q100', 'first quote in a new org gets Q100');
select is((select quote_number from public.quotes where id = 'e7000000-0000-0000-0000-000000000002'), 'Q101', 'second quote gets Q101');
select is((select count(*)::int from public.quotes where id = 'e7000000-0000-0000-0000-00000000000b'), 0, 'org A owner cannot see org B quote');
select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');
select is((select quote_number from public.quotes where id = 'e7000000-0000-0000-0000-00000000000b'), 'Q101', 'org B has its own series');
select is((select count(*)::int from public.quotes where organization_id = 'e1000000-0000-0000-0000-00000000000a'), 0, 'org B owner cannot see org A quotes');
reset role;
select col_is_unique('public', 'quotes', array['organization_id', 'quote_number'], 'quote_number is unique per organization');
select col_not_null('public', 'quotes', 'quote_number', 'quote_number is not null (backfill numbered every existing row)');

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');
select throws_ok($$ insert into public.quotes (client_id, name, quote_number) values ('e3000000-0000-0000-0000-00000000000a', 'x', 'HACK1') $$, '42501', null, 'authenticated cannot insert quote_number');
select throws_ok($$ update public.quotes set quote_number = 'HACK2' where id = 'e7000000-0000-0000-0000-000000000001' $$, '42501', null, 'authenticated cannot update quote_number');
reset role;
select throws_ok($$ update public.quotes set quote_number = 'HACK3' where id = 'e7000000-0000-0000-0000-000000000001' $$, '42501', 'quotes.quote_number is immutable', 'even a privileged role cannot change quote_number');

select pg_temp.act_as('e2555555-5555-5555-5555-555555555555');
select is((select next_number from public.get_quote_numbering_settings('e1000000-0000-0000-0000-00000000000a')), 102, 'administratie can read settings; next_number advanced to 102');
select is((select prefix from public.get_quote_numbering_settings('e1000000-0000-0000-0000-00000000000a')), 'Q', 'default prefix is Q');
select throws_ok($$ select * from public.update_quote_numbering_settings('e1000000-0000-0000-0000-00000000000a', 'Q', 50) $$, '23514', null, 'lowering next_number is rejected');
select throws_ok($$ select * from public.update_quote_numbering_settings('e1000000-0000-0000-0000-00000000000a', 'con', 200) $$, '23514', null, 'lowercase prefix rejected');
select throws_ok($$ select * from public.update_quote_numbering_settings('e1000000-0000-0000-0000-00000000000a', 'ABCDEFGHIJK', 200) $$, '23514', null, 'prefix longer than 10 rejected');
select lives_ok($$ select * from public.update_quote_numbering_settings('e1000000-0000-0000-0000-00000000000a', 'ABC', 500) $$, 'administratie can raise next_number and change prefix');

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');
insert into public.quotes (id, client_id, name) values ('e7000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-00000000000a', 'A quote 3');
select is((select quote_number from public.quotes where id = 'e7000000-0000-0000-0000-000000000003'), 'ABC500', 'new quote uses the new prefix and number');
select is((select quote_number from public.quotes where id = 'e7000000-0000-0000-0000-000000000001'), 'Q100', 'existing quotes keep their old number after a prefix change');

select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');
select throws_ok($$ select * from public.update_quote_numbering_settings('e1000000-0000-0000-0000-00000000000a', 'PLN', 900) $$, '42501', null, 'planner cannot change settings');
select pg_temp.act_as('e2444444-4444-4444-4444-444444444444');
select throws_ok($$ select * from public.get_quote_numbering_settings('e1000000-0000-0000-0000-00000000000a') $$, '42501', null, 'finance cannot read settings');
select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');
select throws_ok($$ select * from public.update_quote_numbering_settings('e1000000-0000-0000-0000-00000000000a', 'EVIL', 9000) $$, '42501', null, 'owner of another org cannot change settings');
select throws_ok($$ select * from public.quote_number_sequences $$, '42501', null, 'authenticated has no direct access to quote_number_sequences');
reset role;
select is(
  has_function_privilege('anon', 'public.get_quote_numbering_settings(uuid)', 'execute')
    or has_function_privilege('anon', 'public.update_quote_numbering_settings(uuid, text, integer)', 'execute'),
  false, 'anon cannot execute the quote numbering functions');

select * from finish();
rollback;
