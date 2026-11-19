-- pgTAP tests for invoice payments, credit notes and the invoice overview
-- (issues #234, #235, #236,
-- 20261121090000_invoice_payments_and_credit_notes.sql): is_invoicing_member
-- role boundary (owner/finance/administratie yes, planner/engineer no),
-- invoice_payments RLS + delete rules + overpayment/credit refusals, derived
-- payment/e-mail status in invoice_overview, credit_invoice() side effects
-- (quote, work order, contract period) and re-invoicing after a credit.
--
-- Run with: supabase test db   (requires Docker)
-- (Without Docker: run inside a rolled-back transaction via `supabase db query --linked`.)

begin;
create extension if not exists pgtap with schema extensions;

select plan(75);

insert into auth.users (id, email) values
  ('c2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('c2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('c2333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('c2444444-4444-4444-4444-444444444444', 'finance-a@test.local'),
  ('c2555555-5555-5555-5555-555555555555', 'administratie-a@test.local'),
  ('c2777777-7777-7777-7777-777777777777', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.item_id(p_org uuid, p_list text, p_value text) returns uuid
language sql
as $$
  select rli.id
  from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
  where rl.organization_id = p_org and rl.list_key = p_list and rli.value = p_value;
$$;
grant execute on function pg_temp.item_id(uuid, text, text) to authenticated;

-- Deletes payments with the given note as the current role; returns the row count (RLS hides rows).
create or replace function pg_temp.delete_payments(p_note text) returns integer
language plpgsql
as $$
declare v integer;
begin
  delete from public.invoice_payments where note = p_note;
  get diagnostics v = row_count;
  return v;
end;
$$;
grant execute on function pg_temp.delete_payments(text) to authenticated;

-- Fixtures are written as the table owner.
select set_config('request.jwt.claims', json_build_object('sub', 'c2111111-1111-1111-1111-111111111111')::text, true);
insert into public.organizations (id, name, created_by)
values ('c1000000-0000-0000-0000-00000000000a', 'Org A', 'c2111111-1111-1111-1111-111111111111');
insert into public.memberships (user_id, organization_id, role)
values ('c2111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-00000000000a', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('c2222222-2222-2222-2222-222222222222', 'c1000000-0000-0000-0000-00000000000a', 'planner'),
  ('c2333333-3333-3333-3333-333333333333', 'c1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('c2444444-4444-4444-4444-444444444444', 'c1000000-0000-0000-0000-00000000000a', 'finance'),
  ('c2555555-5555-5555-5555-555555555555', 'c1000000-0000-0000-0000-00000000000a', 'administratie');

insert into public.clients (id, organization_id, name, vat_number) values
  ('c3000000-0000-0000-0000-0000000000a0', 'c1000000-0000-0000-0000-00000000000a', 'Own Co', 'NL000000000B01'),
  ('c3000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-00000000000a', 'Client A', 'NL111111111B01');
update public.organizations set own_client_id = 'c3000000-0000-0000-0000-0000000000a0'
where id = 'c1000000-0000-0000-0000-00000000000a';
insert into public.sites (id, client_id, address_line1, postal_code, city, is_visit_address, is_invoice_address) values
  ('c4000000-0000-0000-0000-0000000000a0', 'c3000000-0000-0000-0000-0000000000a0', 'Own Street 1', '1000 AA', 'Utrecht', true, true),
  ('c4000000-0000-0000-0000-0000000000a1', 'c3000000-0000-0000-0000-0000000000a1', 'Billing Road 2', '3000 CC', 'Gouda', true, true);

insert into public.articles (id, organization_id, article_number, description, vat_rate_item_id)
values ('c5000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-00000000000a', 'ART-21', 'Part at 21%',
        pg_temp.item_id('c1000000-0000-0000-0000-00000000000a', 'vat_rate', '21'));

insert into public.work_orders (id, client_id, status_id)
values ('c6000000-0000-0000-0000-0000000000a1', 'c3000000-0000-0000-0000-0000000000a1',
        pg_temp.item_id('c1000000-0000-0000-0000-00000000000a', 'work_order_status', 'completed'));

insert into public.contracts (id, client_id, external_reference, start_date, billing_terms_id)
values ('c9000000-0000-0000-0000-0000000000a1', 'c3000000-0000-0000-0000-0000000000a1', 'Contract A1', '2026-01-15',
        pg_temp.item_id('c1000000-0000-0000-0000-00000000000a', 'billing_terms', 'monthly'));

-- Q1 plain (121.00 incl. VAT), Q2 from the completed WO (50.00, no VAT),
-- Q3 contract quote (80.00), Q4 plain (100.00, made overdue below).
insert into public.quotes (id, client_id, name, work_order_id) values
  ('c7000000-0000-0000-0000-0000000000a1', 'c3000000-0000-0000-0000-0000000000a1', 'Quote 1', null),
  ('c7000000-0000-0000-0000-0000000000a2', 'c3000000-0000-0000-0000-0000000000a1', 'Quote 2 from WO', 'c6000000-0000-0000-0000-0000000000a1'),
  ('c7000000-0000-0000-0000-0000000000a4', 'c3000000-0000-0000-0000-0000000000a1', 'Quote 4', null);
insert into public.quotes (id, client_id, name, quote_type, contract_id, contract_period_start, contract_period_end)
values ('c7000000-0000-0000-0000-0000000000a3', 'c3000000-0000-0000-0000-0000000000a1', 'Contract quote', 'contract',
        'c9000000-0000-0000-0000-0000000000a1', '2026-01-15', '2026-02-14');

insert into public.quote_line_items (id, quote_id, article_id, article_number, description, quantity, unit_price, discount_percent, sort_order) values
  ('c8000000-0000-0000-0000-0000000000a1', 'c7000000-0000-0000-0000-0000000000a1', 'c5000000-0000-0000-0000-0000000000a1', 'ART-21', 'Part at 21%', 1, 100.00, 0, 1),
  ('c8000000-0000-0000-0000-0000000000a2', 'c7000000-0000-0000-0000-0000000000a2', null, null, 'Labour', 1, 50.00, 0, 1),
  ('c8000000-0000-0000-0000-0000000000a3', 'c7000000-0000-0000-0000-0000000000a3', null, null, 'Contract fee', 1, 80.00, 0, 1),
  ('c8000000-0000-0000-0000-0000000000a4', 'c7000000-0000-0000-0000-0000000000a4', null, null, 'Labour', 1, 100.00, 0, 1);

-- Org B
select set_config('request.jwt.claims', json_build_object('sub', 'c2777777-7777-7777-7777-777777777777')::text, true);
insert into public.organizations (id, name, created_by)
values ('c1000000-0000-0000-0000-00000000000b', 'Org B', 'c2777777-7777-7777-7777-777777777777');
insert into public.memberships (user_id, organization_id, role)
values ('c2777777-7777-7777-7777-777777777777', 'c1000000-0000-0000-0000-00000000000b', 'owner');

reset role;

-- ---------------------------------------------------------------------------
-- Seed + helper
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
   where rl.organization_id = 'c1000000-0000-0000-0000-00000000000a' and rl.list_key = 'payment_method'),
  4, 'payment_method list seeded with four items'); -- 1
select is(
  (select rli.value from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
   where rl.organization_id = 'c1000000-0000-0000-0000-00000000000a' and rl.list_key = 'payment_method' and rli.is_default),
  'bank_transfer', 'bank_transfer is the default payment method'); -- 2

select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');
select is(public.is_invoicing_member('c1000000-0000-0000-0000-00000000000a'), true, 'is_invoicing_member is true for owner');
select pg_temp.act_as('c2444444-4444-4444-4444-444444444444');
select is(public.is_invoicing_member('c1000000-0000-0000-0000-00000000000a'), true, 'is_invoicing_member is true for finance');
select pg_temp.act_as('c2555555-5555-5555-5555-555555555555');
select is(public.is_invoicing_member('c1000000-0000-0000-0000-00000000000a'), true, 'is_invoicing_member is true for administratie');
select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');
select is(public.is_invoicing_member('c1000000-0000-0000-0000-00000000000a'), false, 'is_invoicing_member is false for planner');
select pg_temp.act_as('c2333333-3333-3333-3333-333333333333');
select is(public.is_invoicing_member('c1000000-0000-0000-0000-00000000000a'), false, 'is_invoicing_member is false for engineer');
select pg_temp.act_as('c2777777-7777-7777-7777-777777777777');
select is(public.is_invoicing_member('c1000000-0000-0000-0000-00000000000a'), false, 'is_invoicing_member is false for a foreign owner');
reset role;

-- ---------------------------------------------------------------------------
-- Invoicing roles
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select public.create_invoice('c7000000-0000-0000-0000-0000000000a1') $$,
  '42501', 'Only an owner, finance or administratie member can generate invoices.', 'planner cannot create an invoice'); -- 5

select pg_temp.act_as('c2444444-4444-4444-4444-444444444444');
select lives_ok(
  $$ select public.create_invoice('c7000000-0000-0000-0000-0000000000a1') $$,
  'finance can create an invoice (Q1)'); -- 6
select throws_ok(
  $$ select public.create_invoice('c7000000-0000-0000-0000-0000000000a1') $$,
  '23505', 'This quote has already been invoiced.', 'a quote with a live invoice cannot be invoiced again'); -- 7

select pg_temp.act_as('c2555555-5555-5555-5555-555555555555');
select lives_ok(
  $$ select public.create_invoice('c7000000-0000-0000-0000-0000000000a2') $$,
  'administratie can create an invoice (Q2)'); -- 8

select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.create_invoice('c7000000-0000-0000-0000-0000000000a3') $$,
  'owner can create the contract invoice (Q3)'); -- 9
select lives_ok(
  $$ select public.create_invoice('c7000000-0000-0000-0000-0000000000a4') $$,
  'owner can create an invoice (Q4)'); -- 10

reset role;
-- Make Q4's invoice overdue.
update public.invoices set due_date = current_date - 10
where quote_id = 'c7000000-0000-0000-0000-0000000000a4';

create temp table t_ids as
select (select id from public.invoices where quote_id = 'c7000000-0000-0000-0000-0000000000a1' and kind = 'invoice') as inv1,
       (select id from public.invoices where quote_id = 'c7000000-0000-0000-0000-0000000000a2' and kind = 'invoice') as inv2,
       (select id from public.invoices where quote_id = 'c7000000-0000-0000-0000-0000000000a3' and kind = 'invoice') as inv3,
       (select id from public.invoices where quote_id = 'c7000000-0000-0000-0000-0000000000a4' and kind = 'invoice') as inv4,
       pg_temp.item_id('c1000000-0000-0000-0000-00000000000b', 'payment_method', 'cash') as method_b;
grant select on t_ids to authenticated;

select is(
  (select wo_status.value from public.work_orders wo join public.reference_list_items wo_status on wo_status.id = wo.status_id
   where wo.id = 'c6000000-0000-0000-0000-0000000000a1'),
  'invoiced', 'work order of Q2 is Invoiced after invoicing'); -- 11
select is(
  (select ct.invoiced_period_count from public.contracts ct where ct.id = 'c9000000-0000-0000-0000-0000000000a1'),
  1, 'contract invoiced_period_count advanced to 1'); -- 12
select is(
  (select ct.next_invoice_date from public.contracts ct where ct.id = 'c9000000-0000-0000-0000-0000000000a1'),
  '2026-02-15'::date, 'contract next_invoice_date advanced one month'); -- 13

-- ---------------------------------------------------------------------------
-- invoice_payments RLS (INV1 = Q1, total 121.00)
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ insert into public.invoice_payments (invoice_id, paid_on, amount, method_id, note)
     values ((select inv1 from t_ids), current_date, 10.00, pg_temp.item_id('c1000000-0000-0000-0000-00000000000a', 'payment_method', 'bank_transfer'), 'owner payment') $$,
  'owner can register a payment'); -- 14

select pg_temp.act_as('c2444444-4444-4444-4444-444444444444');
select lives_ok(
  $$ insert into public.invoice_payments (invoice_id, paid_on, amount, method_id, note)
     values ((select inv1 from t_ids), current_date, 20.00, pg_temp.item_id('c1000000-0000-0000-0000-00000000000a', 'payment_method', 'pin'), 'finance payment') $$,
  'finance can register a payment'); -- 15

select pg_temp.act_as('c2555555-5555-5555-5555-555555555555');
select lives_ok(
  $$ insert into public.invoice_payments (invoice_id, paid_on, amount, method_id, note)
     values ((select inv1 from t_ids), current_date, 15.00, pg_temp.item_id('c1000000-0000-0000-0000-00000000000a', 'payment_method', 'cash'), 'administratie payment') $$,
  'administratie can register a payment'); -- 16
select is(
  (select created_by from public.invoice_payments where note = 'administratie payment'),
  'c2555555-5555-5555-5555-555555555555'::uuid, 'created_by is set to the caller'); -- 17

select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ insert into public.invoice_payments (invoice_id, paid_on, amount, method_id)
     values ((select inv1 from t_ids), current_date, 1.00, pg_temp.item_id('c1000000-0000-0000-0000-00000000000a', 'payment_method', 'cash')) $$,
  '42501', null, 'planner cannot register a payment'); -- 18
select is((select count(*)::int from public.invoice_payments), 0, 'planner sees no payments'); -- 19
select is((select count(*)::int from public.invoice_overview), 0, 'planner sees no invoice_overview rows'); -- 20

select pg_temp.act_as('c2333333-3333-3333-3333-333333333333');
select throws_ok(
  $$ insert into public.invoice_payments (invoice_id, paid_on, amount, method_id)
     values ((select inv1 from t_ids), current_date, 1.00, pg_temp.item_id('c1000000-0000-0000-0000-00000000000a', 'payment_method', 'cash')) $$,
  '42501', null, 'engineer cannot register a payment'); -- 21
select is((select count(*)::int from public.invoice_payments), 0, 'engineer sees no payments'); -- 22

select pg_temp.act_as('c2777777-7777-7777-7777-777777777777');
select is((select count(*)::int from public.invoice_payments), 0, 'cross-tenant owner sees no payments'); -- 23
select is((select count(*)::int from public.invoice_overview), 0, 'cross-tenant owner sees no invoice_overview rows'); -- 24
select throws_ok(
  $$ insert into public.invoice_payments (invoice_id, paid_on, amount, method_id)
     values ((select inv1 from t_ids), current_date, 1.00, (select method_b from t_ids)) $$,
  null, null, 'cross-tenant owner cannot pay an invoice of another organization'); -- 25

select pg_temp.act_as('c2444444-4444-4444-4444-444444444444');
select is((select count(*)::int from public.invoice_payments), 3, 'finance sees the three payments'); -- 26

-- ---------------------------------------------------------------------------
-- Derived status + overpayment
-- ---------------------------------------------------------------------------
select is(
  (select payment_status from public.invoice_overview where quote_id = 'c7000000-0000-0000-0000-0000000000a1'),
  'partially_paid', 'status partially_paid after partial payments'); -- 27
select results_eq(
  $$ select paid_amount, outstanding from public.invoice_overview where quote_id = 'c7000000-0000-0000-0000-0000000000a1' $$,
  $$ values (45.00::numeric(12,2), 76.00::numeric(12,2)) $$,
  'paid_amount 45.00, outstanding 76.00'); -- 28
select throws_ok(
  $$ insert into public.invoice_payments (invoice_id, paid_on, amount, method_id)
     values ((select inv1 from t_ids), current_date, 76.01, pg_temp.item_id('c1000000-0000-0000-0000-00000000000a', 'payment_method', 'bank_transfer')) $$,
  '23514', 'The payment exceeds the outstanding amount (€ 76.00).', 'overpayment is refused with the outstanding amount'); -- 29
select lives_ok(
  $$ insert into public.invoice_payments (invoice_id, paid_on, amount, method_id)
     values ((select inv1 from t_ids), current_date, 76.00, pg_temp.item_id('c1000000-0000-0000-0000-00000000000a', 'payment_method', 'bank_transfer')) $$,
  'paying exactly the outstanding amount is allowed'); -- 30
select is(
  (select payment_status from public.invoice_overview where quote_id = 'c7000000-0000-0000-0000-0000000000a1'),
  'paid', 'status paid once fully paid'); -- 31
select is(
  (select payment_status from public.invoice_overview where quote_id = 'c7000000-0000-0000-0000-0000000000a4'),
  'overdue', 'unpaid invoice past its due date is overdue'); -- 32
select is(
  (select payment_status from public.invoice_overview where quote_id = 'c7000000-0000-0000-0000-0000000000a3'),
  'open', 'unpaid invoice before its due date is open'); -- 33
select throws_ok(
  $$ insert into public.invoice_payments (invoice_id, paid_on, amount, method_id)
     values ((select inv4 from t_ids), current_date, 0, pg_temp.item_id('c1000000-0000-0000-0000-00000000000a', 'payment_method', 'cash')) $$,
  '23514', null, 'a zero amount is refused'); -- 34
select throws_ok(
  $$ insert into public.invoice_payments (invoice_id, paid_on, amount, method_id)
     values ((select inv4 from t_ids), current_date, 5, pg_temp.item_id('c1000000-0000-0000-0000-00000000000a', 'vat_rate', '21')) $$,
  '23514', null, 'a method from another reference list is refused'); -- 35
select throws_ok(
  $$ insert into public.invoice_payments (invoice_id, paid_on, amount, method_id)
     values ((select inv4 from t_ids), current_date, 5, (select method_b from t_ids)) $$,
  '23514', null, 'a method of another organization is refused'); -- 36
select throws_ok(
  $$ update public.invoice_payments set amount = 1 $$,
  '42501', null, 'payments cannot be updated'); -- 37

-- E-mail status
reset role;
select is(
  (select email_status from public.invoice_overview where quote_id = 'c7000000-0000-0000-0000-0000000000a4'),
  'not_sent', 'e-mail status not_sent by default'); -- 38
update public.invoices set emailed_at = now(), emailed_to = 'x@test.local' where quote_id = 'c7000000-0000-0000-0000-0000000000a4';
select is(
  (select email_status from public.invoice_overview where quote_id = 'c7000000-0000-0000-0000-0000000000a4'),
  'sent', 'e-mail status sent'); -- 39
update public.invoices set email_error = 'boom' where quote_id = 'c7000000-0000-0000-0000-0000000000a4';
select is(
  (select email_status from public.invoice_overview where quote_id = 'c7000000-0000-0000-0000-0000000000a4'),
  'failed', 'e-mail status failed'); -- 40

-- ---------------------------------------------------------------------------
-- Delete rules: creator or owner
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2555555-5555-5555-5555-555555555555');
select is(
  pg_temp.delete_payments('finance payment'),
  0, 'administratie cannot delete a payment of someone else'); -- 41
select is(
  pg_temp.delete_payments('administratie payment'),
  1, 'the creator can delete their own payment'); -- 42
select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');
select is(
  pg_temp.delete_payments('finance payment'),
  0, 'planner cannot delete a payment'); -- 43
select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');
select is(
  pg_temp.delete_payments('finance payment'),
  1, 'an owner can delete any payment'); -- 44

-- ---------------------------------------------------------------------------
-- Credit notes: Q2 (work order) invoice
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select public.credit_invoice((select inv2 from t_ids), 'x') $$,
  '42501', null, 'planner cannot credit an invoice (cannot even see it)'); -- 45

reset role;
select pg_temp.act_as('c2777777-7777-7777-7777-777777777777');
select throws_ok(
  $$ select public.credit_invoice((select inv2 from t_ids), 'x') $$,
  '42501', null, 'a foreign owner cannot credit the invoice'); -- 46

select pg_temp.act_as('c2444444-4444-4444-4444-444444444444');
select throws_ok(
  $$ select public.credit_invoice((select inv2 from t_ids), '   ') $$,
  '23514', 'A reason is required.', 'a blank reason is refused'); -- 47
select throws_ok(
  $$ select public.credit_invoice('c0000000-0000-0000-0000-000000000000', 'x') $$,
  'P0002', null, 'crediting an unknown invoice fails with P0002'); -- 48

-- Before the credit the quote lines are frozen; after it they are editable again.
select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');
select throws_ok(
  $$ update public.quote_line_items set quantity = 2 where id = 'c8000000-0000-0000-0000-0000000000a2' $$,
  '23514', null, 'quote lines are frozen while the invoice is live'); -- 49

select pg_temp.act_as('c2555555-5555-5555-5555-555555555555');
select lives_ok(
  $$ select public.credit_invoice((select inv2 from t_ids), 'Wrong hours billed') $$,
  'administratie can credit an invoice'); -- 50

reset role;
select is(
  (select wo_status.value from public.work_orders wo join public.reference_list_items wo_status on wo_status.id = wo.status_id
   where wo.id = 'c6000000-0000-0000-0000-0000000000a1'),
  'completed', 'work order goes back to Completed after the credit'); -- 51
select is(
  (select s.value from public.quotes q join public.reference_list_items s on s.id = q.status_id
   where q.id = 'c7000000-0000-0000-0000-0000000000a2'),
  'draft', 'quote is reopened (draft; accepted is not in the default list)'); -- 52
select is(
  (select credited_at is not null from public.invoices where id = (select inv2 from t_ids)),
  true, 'original invoice is marked credited'); -- 53
select results_eq(
  $$ select kind, credits_invoice_id, total, subtotal, vat_total, credit_reason, due_date = invoice_date, payment_term_days
     from public.invoices where credits_invoice_id = (select inv2 from t_ids) $$,
  $$ select 'credit_note'::text, (select inv2 from t_ids), -50.00::numeric(12,2), -50.00::numeric(12,2), 0.00::numeric(12,2),
            'Wrong hours billed'::text, true, 0 $$,
  'credit note carries negated amounts, the reason and a due date of today'); -- 54
select results_eq(
  $$ select l.quantity, l.line_total from public.invoice_lines l
     join public.invoices i on i.id = l.invoice_id where i.credits_invoice_id = (select inv2 from t_ids) $$,
  $$ values (-1.00::numeric(10,2), -50.00::numeric(12,2)) $$,
  'credit note lines are negated'); -- 55

select pg_temp.act_as('c2444444-4444-4444-4444-444444444444');
select is(
  (select array_agg(payment_status order by kind) from public.invoice_overview where quote_id = 'c7000000-0000-0000-0000-0000000000a2'),
  array['credit_note', 'credited'], 'overview shows credit_note and credited'); -- 56
select throws_ok(
  $$ select public.credit_invoice((select inv2 from t_ids), 'again') $$,
  '23505', 'This invoice has already been credited.', 'an invoice can be credited only once'); -- 57
select throws_ok(
  $$ select public.credit_invoice((select id from public.invoices where credits_invoice_id = (select inv2 from t_ids)), 'again') $$,
  '23514', 'A credit note cannot be credited.', 'a credit note cannot be credited'); -- 58
select throws_ok(
  $$ insert into public.invoice_payments (invoice_id, paid_on, amount, method_id)
     select i.id, current_date, 1, pg_temp.item_id(i.organization_id, 'payment_method', 'cash')
     from public.invoices i where i.credits_invoice_id = (select inv2 from t_ids) $$,
  '23514', 'Payments cannot be registered on a credit note.', 'no payments on a credit note'); -- 59
select throws_ok(
  $$ insert into public.invoice_payments (invoice_id, paid_on, amount, method_id)
     select i.id, current_date, 1, pg_temp.item_id(i.organization_id, 'payment_method', 'cash')
     from public.invoices i where i.id = (select inv2 from t_ids) $$,
  '23514', 'Payments cannot be registered on a credited invoice.', 'no payments on a credited invoice'); -- 60

-- Re-invoicing after the credit: lines editable, then a new live invoice, frozen again.
select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ update public.quote_line_items set quantity = 2 where id = 'c8000000-0000-0000-0000-0000000000a2' $$,
  'quote lines are editable again after the credit'); -- 61
select lives_ok(
  $$ select public.create_invoice('c7000000-0000-0000-0000-0000000000a2') $$,
  'a new invoice can be generated after a credit'); -- 62

-- Only the latest invoiced contract period can be credited (20261121100000):
-- invoice period 2 (Q5), then crediting period 1 (Q3) is refused until Q5 is credited.
reset role;
insert into public.quotes (id, client_id, name, quote_type, contract_id, contract_period_start, contract_period_end)
values ('c7000000-0000-0000-0000-0000000000a5', 'c3000000-0000-0000-0000-0000000000a1', 'Contract quote P2', 'contract',
        'c9000000-0000-0000-0000-0000000000a1', '2026-02-15', '2026-03-14');
insert into public.quote_line_items (id, quote_id, description, quantity, unit_price, discount_percent, sort_order)
values ('c8000000-0000-0000-0000-0000000000a5', 'c7000000-0000-0000-0000-0000000000a5', 'Contract fee P2', 1, 80.00, 0, 1);
select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.create_invoice('c7000000-0000-0000-0000-0000000000a5') $$,
  'owner can invoice contract period 2 (Q5)'); -- 63a
select throws_ok(
  $$ select public.credit_invoice((select inv3 from t_ids), 'Period billed twice') $$,
  '23514', 'Only the latest invoiced period of a contract can be credited. Credit the later periods first.',
  'an earlier contract period cannot be credited while a later one is invoiced'); -- 63b
select lives_ok(
  $$ select public.credit_invoice(
       (select i.id from public.invoices i where i.quote_id = 'c7000000-0000-0000-0000-0000000000a5' and i.kind = 'invoice'),
       'Period 2 billed too early') $$,
  'the latest contract period can be credited'); -- 63c

-- Contract rollback
select lives_ok(
  $$ select public.credit_invoice((select inv3 from t_ids), 'Period billed twice') $$,
  'owner can credit the contract invoice'); -- 63
reset role;
select is(
  (select ct.invoiced_period_count from public.contracts ct where ct.id = 'c9000000-0000-0000-0000-0000000000a1'),
  0, 'contract invoiced_period_count rolled back'); -- 64
select is(
  (select ct.next_invoice_date from public.contracts ct where ct.id = 'c9000000-0000-0000-0000-0000000000a1'),
  '2026-01-15'::date, 'contract next_invoice_date recomputed after the credit'); -- 65

-- ---------------------------------------------------------------------------
-- Widened settings + bucket policies
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2444444-4444-4444-4444-444444444444');
select lives_ok(
  $$ insert into public.invoice_settings (organization_id, payment_term_days) values ('c1000000-0000-0000-0000-00000000000a', 14) $$,
  'finance can write invoice_settings'); -- 66
select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.invoice_settings), 0, 'planner cannot read invoice_settings'); -- 67
reset role;
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'invoices_bucket_%'
     and coalesce(qual, '') || coalesce(with_check, '') like '%is_invoicing_member%'),
  2, 'invoices bucket select/insert policies use is_invoicing_member'); -- 68

select * from finish();
rollback;
