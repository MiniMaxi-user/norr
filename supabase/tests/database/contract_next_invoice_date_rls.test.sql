-- pgTAP tests for contracts.next_invoice_date / invoiced_period_count and
-- reference_list_items.interval_months (issue #209,
-- 20261010090000_contract_next_invoice_date.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email) values
  ('f2111111-1111-1111-1111-111111111111', 'owner-nid@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.terms_id(p_value text) returns uuid
language sql
as $$
  select rli.id
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a'
    and rl.list_key = 'billing_terms' and rli.value = p_value
$$;

select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('f1000000-0000-0000-0000-00000000000a', 'Org NID', 'f2111111-1111-1111-1111-111111111111');
insert into public.memberships (user_id, organization_id, role)
values ('f2111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-00000000000a', 'owner');
insert into public.clients (id, organization_id, name)
values ('f3000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 'Client NID');

-- Seeded intervals for a new organization.
select is(
  (select array_agg(rli.interval_months order by rli.sort_order)
   from public.reference_list_items rli
   join public.reference_lists rl on rl.id = rli.reference_list_id
   where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'billing_terms'),
  array[1, 3, 12, null, null]::integer[],
  'new org billing_terms seeded with intervals 1/3/12/null/null'
);

-- Insert: next_invoice_date = start_date (no billing terms).
select lives_ok(
  $$ insert into public.contracts (id, client_id, name, start_date)
     values ('f6000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-00000000000a', 'No terms', '2026-01-31') $$,
  'insert contract without billing terms'
);
select is(
  (select next_invoice_date from public.contracts where id = 'f6000000-0000-0000-0000-000000000001'),
  '2026-01-31'::date,
  'next_invoice_date = start_date on insert'
);

-- Quarterly contract.
select lives_ok(
  format($$ insert into public.contracts (id, client_id, name, start_date, billing_terms_id)
     values ('f6000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-00000000000a', 'Quarterly', '2026-01-15', %L) $$,
     pg_temp.terms_id('quarterly')),
  'insert quarterly contract'
);
select is(
  (select next_invoice_date from public.contracts where id = 'f6000000-0000-0000-0000-000000000002'),
  '2026-01-15'::date,
  'quarterly contract: next_invoice_date = start_date at count 0'
);

-- Authenticated cannot write the derived/counter columns.
select throws_ok(
  $$ update public.contracts set next_invoice_date = '2030-01-01' where id = 'f6000000-0000-0000-0000-000000000002' $$,
  '42501', null, 'authenticated cannot update next_invoice_date'
);
select throws_ok(
  $$ update public.contracts set invoiced_period_count = 5 where id = 'f6000000-0000-0000-0000-000000000002' $$,
  '42501', null, 'authenticated cannot update invoiced_period_count'
);
select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, invoiced_period_count)
     values ('f3000000-0000-0000-0000-00000000000a', 'Hostile', '2026-01-01', 3) $$,
  '42501', null, 'authenticated cannot insert invoiced_period_count'
);
select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, next_invoice_date)
     values ('f3000000-0000-0000-0000-00000000000a', 'Hostile', '2026-01-01', '2027-01-01') $$,
  '42501', null, 'authenticated cannot insert next_invoice_date'
);

-- Privileged advance of the counter (future invoicing flow).
reset role;
update public.contracts set invoiced_period_count = 2 where id = 'f6000000-0000-0000-0000-000000000002';
select is(
  (select next_invoice_date from public.contracts where id = 'f6000000-0000-0000-0000-000000000002'),
  '2026-07-15'::date,
  'quarterly with count 2: start_date + 6 months'
);

-- Beyond end_date -> null.
update public.contracts set end_date = '2026-06-30' where id = 'f6000000-0000-0000-0000-000000000002';
select is(
  (select next_invoice_date from public.contracts where id = 'f6000000-0000-0000-0000-000000000002'),
  null::date,
  'next_invoice_date null when beyond end_date'
);

-- one_time with count 1 -> null; with count 0 -> start_date.
insert into public.contracts (id, organization_id, client_id, name, start_date, billing_terms_id)
values ('f6000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-00000000000a',
  'f3000000-0000-0000-0000-00000000000a', 'One time', '2026-03-01', pg_temp.terms_id('one_time'));
select is(
  (select next_invoice_date from public.contracts where id = 'f6000000-0000-0000-0000-000000000003'),
  '2026-03-01'::date,
  'one_time at count 0: start_date'
);
update public.contracts set invoiced_period_count = 1 where id = 'f6000000-0000-0000-0000-000000000003';
select is(
  (select next_invoice_date from public.contracts where id = 'f6000000-0000-0000-0000-000000000003'),
  null::date,
  'one_time at count 1: null'
);

-- Changing billing_terms recalculates (monthly, count 1 -> +1 month).
update public.contracts
set invoiced_period_count = 1, billing_terms_id = pg_temp.terms_id('monthly')
where id = 'f6000000-0000-0000-0000-000000000003';
select is(
  (select next_invoice_date from public.contracts where id = 'f6000000-0000-0000-0000-000000000003'),
  '2026-04-01'::date,
  'switching to monthly terms recalculates next_invoice_date'
);

-- Changing the item's interval recomputes affected contracts (monthly 1 -> 2).
update public.reference_list_items set interval_months = 2 where id = pg_temp.terms_id('monthly');
select is(
  (select next_invoice_date from public.contracts where id = 'f6000000-0000-0000-0000-000000000003'),
  '2026-05-01'::date,
  'interval_months change on the reference item recomputes contracts'
);

-- interval_months must be > 0.
select throws_ok(
  format($$ update public.reference_list_items set interval_months = 0 where id = %L $$, pg_temp.terms_id('monthly')),
  '23514', null, 'interval_months must be positive'
);

select * from finish();
rollback;
