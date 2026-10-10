-- pgTAP tests for contract quotes, the 'invoiced' quote status, invoice
-- permanence/e-mail columns, the contract-period-advancing trigger and
-- invoice_email_settings (issues #210/#211,
-- 20261010100000_contract_quotes_and_invoicing.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

insert into auth.users (id, email) values
  ('d1111111-1111-1111-1111-111111111111', 'owner-cq@test.local'),
  ('d1222222-2222-2222-2222-222222222222', 'planner-cq@test.local'),
  ('d1333333-3333-3333-3333-333333333333', 'administratie-cq@test.local'),
  ('d1444444-4444-4444-4444-444444444444', 'owner-cq-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Fixtures: org A (owner, planner, administratie), org B (owner).
select pg_temp.act_as('d1111111-1111-1111-1111-111111111111');
insert into public.organizations (id, name, created_by)
values ('d2000000-0000-0000-0000-00000000000a', 'Org CQ A', 'd1111111-1111-1111-1111-111111111111');
insert into public.memberships (user_id, organization_id, role) values
  ('d1111111-1111-1111-1111-111111111111', 'd2000000-0000-0000-0000-00000000000a', 'owner'),
  ('d1222222-2222-2222-2222-222222222222', 'd2000000-0000-0000-0000-00000000000a', 'planner'),
  ('d1333333-3333-3333-3333-333333333333', 'd2000000-0000-0000-0000-00000000000a', 'administratie');
insert into public.clients (id, organization_id, name) values
  ('d3000000-0000-0000-0000-00000000000a', 'd2000000-0000-0000-0000-00000000000a', 'Client CQ A1'),
  ('d3000000-0000-0000-0000-00000000000c', 'd2000000-0000-0000-0000-00000000000a', 'Client CQ A2');

create or replace function pg_temp.monthly_id() returns uuid
language sql
as $$
  select rli.id
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rl.organization_id = 'd2000000-0000-0000-0000-00000000000a'
    and rl.list_key = 'billing_terms' and rli.value = 'monthly'
$$;

insert into public.contracts (id, client_id, name, start_date, billing_terms_id) values
  ('d6000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-00000000000a', 'Contract A1', '2026-01-15', pg_temp.monthly_id()),
  ('d6000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-00000000000c', 'Contract A2 (other client)', '2026-01-15', pg_temp.monthly_id());

select pg_temp.act_as('d1444444-4444-4444-4444-444444444444');
insert into public.organizations (id, name, created_by)
values ('d2000000-0000-0000-0000-00000000000b', 'Org CQ B', 'd1444444-4444-4444-4444-444444444444');
insert into public.memberships (user_id, organization_id, role)
values ('d1444444-4444-4444-4444-444444444444', 'd2000000-0000-0000-0000-00000000000b', 'owner');
insert into public.clients (id, organization_id, name)
values ('d3000000-0000-0000-0000-00000000000b', 'd2000000-0000-0000-0000-00000000000b', 'Client CQ B');
insert into public.contracts (id, client_id, name, start_date)
values ('d6000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-00000000000b', 'Contract B', '2026-01-01');

-- ---------------------------------------------------------------------------
-- quotes
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d1111111-1111-1111-1111-111111111111');

insert into public.quotes (id, client_id, name)
values ('d7000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-00000000000a', 'Default quote');

select is(
  (select quote_type::text from public.quotes where id = 'd7000000-0000-0000-0000-000000000001'),
  'default',
  'quote_type defaults to default'
); -- 1

select is(
  (select count(*)::int
   from public.reference_list_items rli
   join public.reference_lists rl on rl.id = rli.reference_list_id
   where rl.organization_id = 'd2000000-0000-0000-0000-00000000000a'
     and rl.list_key = 'quote_status' and rli.value = 'invoiced' and rli.label = 'Invoiced'),
  1,
  'quote_status has an Invoiced item for a new org'
); -- 2

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_period_start, contract_period_end)
     values ('d3000000-0000-0000-0000-00000000000a', 'No contract', 'contract', '2026-01-15', '2026-02-14') $$,
  '23514', null,
  'contract quote without contract_id rejected'
); -- 3

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id)
     values ('d3000000-0000-0000-0000-00000000000a', 'No period', 'contract', 'd6000000-0000-0000-0000-000000000001') $$,
  '23514', null,
  'contract quote without period dates rejected'
); -- 4

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end)
     values ('d3000000-0000-0000-0000-00000000000a', 'Bad order', 'contract', 'd6000000-0000-0000-0000-000000000001', '2026-02-14', '2026-01-15') $$,
  '23514', null,
  'contract period end before start rejected'
); -- 5

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end)
     values ('d3000000-0000-0000-0000-00000000000a', 'Other client contract', 'contract', 'd6000000-0000-0000-0000-000000000002', '2026-01-15', '2026-02-14') $$,
  '23514', null,
  'contract of a different client rejected'
); -- 6

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end)
     values ('d3000000-0000-0000-0000-00000000000a', 'Cross-org contract', 'contract', 'd6000000-0000-0000-0000-00000000000b', '2026-01-15', '2026-02-14') $$,
  '23514', null,
  'contract of a different organization rejected'
); -- 7

select throws_ok(
  $$ insert into public.quotes (client_id, name, contract_id)
     values ('d3000000-0000-0000-0000-00000000000a', 'Default with contract', 'd6000000-0000-0000-0000-000000000001') $$,
  '23514', null,
  'default quote cannot carry a contract_id'
); -- 8

select lives_ok(
  $$ insert into public.quotes (id, client_id, name, quote_type, contract_id, contract_period_start, contract_period_end)
     values ('d7000000-0000-0000-0000-000000000002', 'd3000000-0000-0000-0000-00000000000a', 'Contract quote P1',
       'contract', 'd6000000-0000-0000-0000-000000000001', '2026-01-15', '2026-02-14') $$,
  'valid contract quote inserts'
); -- 9

select throws_ok(
  $$ insert into public.quotes (client_id, name, quote_type, contract_id, contract_period_start, contract_period_end)
     values ('d3000000-0000-0000-0000-00000000000a', 'Duplicate period', 'contract',
       'd6000000-0000-0000-0000-000000000001', '2026-01-15', '2026-02-14') $$,
  '23505', null,
  'second contract quote for the same contract period rejected'
); -- 10

select throws_ok(
  $$ update public.quotes set quote_type = 'default' where id = 'd7000000-0000-0000-0000-000000000002' $$,
  '42501', null,
  'quote_type is not updatable'
); -- 11

-- ---------------------------------------------------------------------------
-- invoices on a contract quote advance the contract
-- ---------------------------------------------------------------------------
select is(
  (select invoiced_period_count from public.contracts where id = 'd6000000-0000-0000-0000-000000000001'),
  0,
  'contract starts with invoiced_period_count 0'
); -- 12

select lives_ok(
  $$ insert into public.invoices (id, quote_id, invoice_number)
     values ('d8000000-0000-0000-0000-000000000001', 'd7000000-0000-0000-0000-000000000002', 'INV-2026-9001') $$,
  'owner can insert an invoice without pdf_path'
); -- 13

select is(
  (select invoiced_period_count from public.contracts where id = 'd6000000-0000-0000-0000-000000000001'),
  1,
  'invoicing a contract quote increments invoiced_period_count'
); -- 14

select is(
  (select next_invoice_date from public.contracts where id = 'd6000000-0000-0000-0000-000000000001'),
  '2026-02-15'::date,
  'next_invoice_date advances by one monthly interval'
); -- 15

insert into public.invoices (id, quote_id, invoice_number)
values ('d8000000-0000-0000-0000-000000000002', 'd7000000-0000-0000-0000-000000000001', 'INV-2026-9002');

select is(
  (select invoiced_period_count from public.contracts where id = 'd6000000-0000-0000-0000-000000000001'),
  1,
  'invoicing a default quote does not touch any contract'
); -- 16

select throws_ok(
  $$ delete from public.invoices where id = 'd8000000-0000-0000-0000-000000000002' $$,
  '42501', null,
  'authenticated cannot delete invoices'
); -- 17

select lives_ok(
  $$ update public.invoices set emailed_to = 'klant@example.com', emailed_at = now(), email_error = null
     where id = 'd8000000-0000-0000-0000-000000000001' $$,
  'owner can update the e-mail columns'
); -- 18

select throws_ok(
  $$ update public.invoices set invoice_number = 'INV-2026-0000' where id = 'd8000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'other invoice columns remain non-updatable'
); -- 19

select pg_temp.act_as('d1222222-2222-2222-2222-222222222222');
update public.invoices set emailed_to = 'hack@example.com' where id = 'd8000000-0000-0000-0000-000000000001';

select pg_temp.act_as('d1333333-3333-3333-3333-333333333333');
select lives_ok(
  $$ update public.invoices set email_error = 'smtp down' where id = 'd8000000-0000-0000-0000-000000000001' $$,
  'administratie can update the e-mail columns'
); -- 20

select is(
  (select emailed_to from public.invoices where id = 'd8000000-0000-0000-0000-000000000001'),
  'klant@example.com',
  'planner update of invoice e-mail columns was excluded by RLS'
); -- 21

-- ---------------------------------------------------------------------------
-- invoice_email_settings
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d1222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ insert into public.invoice_email_settings (organization_id, from_email)
     values ('d2000000-0000-0000-0000-00000000000a', 'billing@example.com') $$,
  '42501', null,
  'planner cannot insert invoice_email_settings'
); -- 22

select pg_temp.act_as('d1111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ insert into public.invoice_email_settings (organization_id, from_email, from_name, cc_email, subject_template, body_template)
     values ('d2000000-0000-0000-0000-00000000000a', 'billing@example.com', 'Billing', 'cc@example.com', 'Invoice {{number}}', 'Dear {{client}}') $$,
  'owner can insert invoice_email_settings'
); -- 23

select throws_ok(
  $$ insert into public.invoice_email_settings (organization_id, from_email)
     values ('d2000000-0000-0000-0000-00000000000b', 'x@example.com') $$,
  '42501', null,
  'owner of org A cannot insert settings for org B'
); -- 24

select throws_ok(
  $$ update public.invoice_email_settings set from_email = 'not-an-email'
     where organization_id = 'd2000000-0000-0000-0000-00000000000a' $$,
  '23514', null,
  'malformed from_email rejected'
); -- 25

select throws_ok(
  $$ update public.invoice_email_settings set organization_id = 'd2000000-0000-0000-0000-00000000000b'
     where organization_id = 'd2000000-0000-0000-0000-00000000000a' $$,
  '42501', null,
  'organization_id is not updatable'
); -- 26

select pg_temp.act_as('d1333333-3333-3333-3333-333333333333');
select lives_ok(
  $$ update public.invoice_email_settings set from_name = 'Finance' where organization_id = 'd2000000-0000-0000-0000-00000000000a' $$,
  'administratie can update invoice_email_settings'
); -- 27

select is(
  (select count(*)::int from public.invoice_email_settings),
  1,
  'administratie can read the org settings row'
); -- 28

select pg_temp.act_as('d1222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from public.invoice_email_settings),
  0,
  'planner cannot read invoice_email_settings'
); -- 29

select pg_temp.act_as('d1444444-4444-4444-4444-444444444444');
select is(
  (select count(*)::int from public.invoice_email_settings),
  0,
  'org B owner cannot read org A invoice_email_settings'
); -- 30

select throws_ok(
  $$ delete from public.invoice_email_settings $$,
  '42501', null,
  'authenticated cannot delete invoice_email_settings'
); -- 31

select pg_temp.act_as('d1111111-1111-1111-1111-111111111111');
insert into public.quotes (id, client_id, name)
values ('d7000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-00000000000a', 'Quote for administratie invoice');

select pg_temp.act_as('d1333333-3333-3333-3333-333333333333');
select lives_ok(
  $$ insert into public.invoices (id, quote_id, invoice_number)
     values ('d8000000-0000-0000-0000-000000000003', 'd7000000-0000-0000-0000-000000000003', 'INV-2026-9003') $$,
  'administratie can insert an invoice'
); -- 32

select is(
  (select rli.value from public.quotes q join public.reference_list_items rli on rli.id = q.status_id
   where q.id = 'd7000000-0000-0000-0000-000000000003'),
  'invoiced',
  'invoice insert by administratie sets the quote status to invoiced'
); -- 33

select * from finish();
rollback;
