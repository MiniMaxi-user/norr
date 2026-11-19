-- pgTAP tests for immutable invoices (issues #227, #232, #233,
-- 20261120090000_invoice_snapshot_payment_terms_and_work_order_invoiced.sql):
-- create_invoice() role/state checks, the snapshot (lines, VAT per rate,
-- totals, payment term + due date, recipient/sender), the frozen quote lines,
-- the revoked direct INSERT, invoice_lines RLS, pdf_path set-once, the
-- invoice_settings RLS and the work order -> Invoiced trigger.
--
-- Run with: supabase test db   (requires Docker)

begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

insert into auth.users (id, email) values
  ('b2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('b2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('b2555555-5555-5555-5555-555555555555', 'administratie-a@test.local'),
  ('b2777777-7777-7777-7777-777777777777', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Fixtures are written as the table owner (no RLS/column grants in the way);
-- created_by still needs auth.uid() for the org-creation triggers.
select set_config('request.jwt.claims', json_build_object('sub', 'b2111111-1111-1111-1111-111111111111')::text, true);
insert into public.organizations (id, name, created_by)
values ('b1000000-0000-0000-0000-00000000000a', 'Org A', 'b2111111-1111-1111-1111-111111111111');
insert into public.memberships (user_id, organization_id, role) values
  ('b2111111-1111-1111-1111-111111111111', 'b1000000-0000-0000-0000-00000000000a', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('b2222222-2222-2222-2222-222222222222', 'b1000000-0000-0000-0000-00000000000a', 'planner'),
  ('b2555555-5555-5555-5555-555555555555', 'b1000000-0000-0000-0000-00000000000a', 'administratie');

insert into public.clients (id, organization_id, name, vat_number, payment_term_days) values
  ('b3000000-0000-0000-0000-0000000000a0', 'b1000000-0000-0000-0000-00000000000a', 'Own Co', 'NL000000000B01', null),
  ('b3000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-00000000000a', 'Client A', 'NL111111111B01', null),
  ('b3000000-0000-0000-0000-0000000000a2', 'b1000000-0000-0000-0000-00000000000a', 'Client A2', null, 14);
update public.organizations set own_client_id = 'b3000000-0000-0000-0000-0000000000a0'
where id = 'b1000000-0000-0000-0000-00000000000a';

insert into public.sites (id, client_id, address_line1, postal_code, city, is_visit_address, is_invoice_address) values
  ('b4000000-0000-0000-0000-0000000000a0', 'b3000000-0000-0000-0000-0000000000a0', 'Own Street 1', '1000 AA', 'Utrecht', true, true),
  ('b4000000-0000-0000-0000-0000000000a1', 'b3000000-0000-0000-0000-0000000000a1', 'Visit Lane 9', '2000 BB', 'Delft', true, false),
  ('b4000000-0000-0000-0000-0000000000a2', 'b3000000-0000-0000-0000-0000000000a1', 'Billing Road 2', '3000 CC', 'Gouda', false, true);

insert into public.invoice_settings (organization_id, payment_term_days)
values ('b1000000-0000-0000-0000-00000000000a', 21);

insert into public.articles (id, organization_id, article_number, description, vat_rate_item_id)
select 'b5000000-0000-0000-0000-0000000000a1', 'b1000000-0000-0000-0000-00000000000a', 'ART-21', 'Part at 21%', rli.id
from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'b1000000-0000-0000-0000-00000000000a' and rl.list_key = 'vat_rate' and rli.value = '21';
insert into public.articles (id, organization_id, article_number, description, vat_rate_item_id)
select 'b5000000-0000-0000-0000-0000000000a2', 'b1000000-0000-0000-0000-00000000000a', 'ART-9', 'Part at 9%', rli.id
from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'b1000000-0000-0000-0000-00000000000a' and rl.list_key = 'vat_rate' and rli.value = '9';

-- Work orders: WO1 completed, WO2 in progress (both for Client A).
insert into public.work_orders (id, client_id, status_id)
select 'b6000000-0000-0000-0000-0000000000a1', 'b3000000-0000-0000-0000-0000000000a1', rli.id
from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'b1000000-0000-0000-0000-00000000000a' and rl.list_key = 'work_order_status' and rli.value = 'completed';
insert into public.work_orders (id, client_id, status_id)
select 'b6000000-0000-0000-0000-0000000000a2', 'b3000000-0000-0000-0000-0000000000a1', rli.id
from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'b1000000-0000-0000-0000-00000000000a' and rl.list_key = 'work_order_status' and rli.value = 'in_progress';

-- Quotes: Q1 mixed VAT, Q2 client with own term, Q3 no lines, Q4 from WO1,
-- Q5 from WO2.
insert into public.quotes (id, client_id, name, work_order_id) values
  ('b7000000-0000-0000-0000-0000000000a1', 'b3000000-0000-0000-0000-0000000000a1', 'Quote mixed VAT', null),
  ('b7000000-0000-0000-0000-0000000000a2', 'b3000000-0000-0000-0000-0000000000a2', 'Quote own term', null),
  ('b7000000-0000-0000-0000-0000000000a3', 'b3000000-0000-0000-0000-0000000000a1', 'Quote without lines', null),
  ('b7000000-0000-0000-0000-0000000000a4', 'b3000000-0000-0000-0000-0000000000a1', 'Quote from WO1', 'b6000000-0000-0000-0000-0000000000a1'),
  ('b7000000-0000-0000-0000-0000000000a5', 'b3000000-0000-0000-0000-0000000000a1', 'Quote from WO2', 'b6000000-0000-0000-0000-0000000000a2');

-- Q1: 2 x 10.00 -10% = 18.00 @21%, 1 x 5.55 = 5.55 @9%, 3 x 1.00 = 3.00 manual (0%).
insert into public.quote_line_items (id, quote_id, article_id, article_number, description, quantity, unit_price, discount_percent, sort_order) values
  ('b8000000-0000-0000-0000-0000000000a1', 'b7000000-0000-0000-0000-0000000000a1', 'b5000000-0000-0000-0000-0000000000a1', 'ART-21', 'Part at 21%', 2, 10.00, 10, 1),
  ('b8000000-0000-0000-0000-0000000000a2', 'b7000000-0000-0000-0000-0000000000a1', 'b5000000-0000-0000-0000-0000000000a2', 'ART-9', 'Part at 9%', 1, 5.55, 0, 2),
  ('b8000000-0000-0000-0000-0000000000a3', 'b7000000-0000-0000-0000-0000000000a1', null, null, 'Manual line', 3, 1.00, 0, 3),
  ('b8000000-0000-0000-0000-0000000000a4', 'b7000000-0000-0000-0000-0000000000a2', 'b5000000-0000-0000-0000-0000000000a1', 'ART-21', 'Part at 21%', 1, 100.00, 0, 1),
  ('b8000000-0000-0000-0000-0000000000a5', 'b7000000-0000-0000-0000-0000000000a4', null, null, 'Labour', 1, 50.00, 0, 1),
  ('b8000000-0000-0000-0000-0000000000a6', 'b7000000-0000-0000-0000-0000000000a5', null, null, 'Labour', 1, 50.00, 0, 1);

-- Org B
select set_config('request.jwt.claims', json_build_object('sub', 'b2777777-7777-7777-7777-777777777777')::text, true);
insert into public.organizations (id, name, created_by)
values ('b1000000-0000-0000-0000-00000000000b', 'Org B', 'b2777777-7777-7777-7777-777777777777');
insert into public.memberships (user_id, organization_id, role)
values ('b2777777-7777-7777-7777-777777777777', 'b1000000-0000-0000-0000-00000000000b', 'owner');

-- The auto-draft quote the WO1 insert created (read as the table owner).
reset role;
create temp table t_ids as
select (select q.id from public.quotes q where q.work_order_id = 'b6000000-0000-0000-0000-0000000000a1' and q.is_auto_draft) as auto_draft_id;
grant select on t_ids to authenticated;

-- 1. Planner may not invoice.
select pg_temp.act_as('b2222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select public.create_invoice('b7000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'planner cannot create an invoice');

-- 2-9. Owner invoices Q1: snapshot.
select pg_temp.act_as('b2111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.create_invoice('b7000000-0000-0000-0000-0000000000a1') $$,
  'owner can create an invoice');
select results_eq(
  $$ select subtotal, vat_total, total from public.invoices where quote_id = 'b7000000-0000-0000-0000-0000000000a1' $$,
  $$ values (26.55::numeric(12,2), 4.28::numeric(12,2), 30.83::numeric(12,2)) $$,
  'subtotal = rounded lines, VAT per rate rounded (3.78 + 0.50 + 0.00), total');
select results_eq(
  $$ select l.sort_order, l.vat_percent, l.line_total from public.invoice_lines l
       join public.invoices i on i.id = l.invoice_id
       where i.quote_id = 'b7000000-0000-0000-0000-0000000000a1' order by l.sort_order $$,
  $$ values (1, 21.00::numeric(5,2), 18.00::numeric(12,2)), (2, 9.00::numeric(5,2), 5.55::numeric(12,2)), (3, 0.00::numeric(5,2), 3.00::numeric(12,2)) $$,
  'invoice lines snapshot the VAT percentage and the discounted, rounded line total');
select is(
  (select jsonb_array_length(vat_breakdown) || ':' || (vat_breakdown -> 0 ->> 'vat_percent')
     from public.invoices where quote_id = 'b7000000-0000-0000-0000-0000000000a1'),
  '3:21.00',
  'VAT breakdown has one entry per rate, highest first');
select ok(
  (select payment_term_days = 21 and due_date = invoice_date + 21
     from public.invoices where quote_id = 'b7000000-0000-0000-0000-0000000000a1'),
  'client without own term: organization default (21 days) sets the due date');
select is(
  (select recipient ->> 'name' || ' | ' || (recipient -> 'address' ->> 'line1') || ' | ' || (sender ->> 'name')
     from public.invoices where quote_id = 'b7000000-0000-0000-0000-0000000000a1'),
  'Client A | Billing Road 2 | Own Co',
  'recipient uses the invoice-address site; sender is the own company');
select is(
  (select s.value from public.quotes q join public.reference_list_items s on s.id = q.status_id
    where q.id = 'b7000000-0000-0000-0000-0000000000a1'),
  'invoiced',
  'the quote is set to Invoiced');
select throws_ok(
  $$ select public.create_invoice('b7000000-0000-0000-0000-0000000000a1') $$,
  '23505', null, 'a quote cannot be invoiced twice');

-- 10-12. Frozen lines and no direct insert.
select throws_ok(
  $$ update public.quote_line_items set unit_price = 99 where id = 'b8000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'lines of an invoiced quote cannot be changed');
select throws_ok(
  $$ insert into public.quote_line_items (quote_id, description, quantity, unit_price)
     values ('b7000000-0000-0000-0000-0000000000a1', 'Extra', 1, 1) $$,
  '23514', null, 'no line can be added to an invoiced quote');
select throws_ok(
  $$ insert into public.invoices (quote_id, invoice_number) values ('b7000000-0000-0000-0000-0000000000a3', 'INV-X') $$,
  '42501', null, 'direct INSERT into invoices is no longer granted');

-- 13-15. Refusals: no lines, auto-draft; administratie with client term.
select throws_ok(
  $$ select public.create_invoice('b7000000-0000-0000-0000-0000000000a3') $$,
  '23514', null, 'a quote without lines cannot be invoiced');
select throws_ok(
  $$ select public.create_invoice((select auto_draft_id from t_ids)) $$,
  '23514', null, 'an automatic draft quote cannot be invoiced');
select pg_temp.act_as('b2555555-5555-5555-5555-555555555555');
select lives_ok(
  $$ select public.create_invoice('b7000000-0000-0000-0000-0000000000a2') $$,
  'administratie can create an invoice');
select ok(
  (select payment_term_days = 14 and due_date = invoice_date + 14 and total = 121.00
     from public.invoices where quote_id = 'b7000000-0000-0000-0000-0000000000a2'),
  'the client''s own payment term (14 days) wins over the organization default');

-- 17-18. Work order -> Invoiced only from Completed.
select lives_ok(
  $$ select public.create_invoice('b7000000-0000-0000-0000-0000000000a4') $$,
  'invoice the quote of the completed work order');
select lives_ok(
  $$ select public.create_invoice('b7000000-0000-0000-0000-0000000000a5') $$,
  'invoice the quote of the in-progress work order');
select pg_temp.act_as('b2111111-1111-1111-1111-111111111111');
select results_eq(
  $$ select wo.id::text, s.value from public.work_orders wo join public.reference_list_items s on s.id = wo.status_id
       where wo.id in ('b6000000-0000-0000-0000-0000000000a1', 'b6000000-0000-0000-0000-0000000000a2') order by wo.id $$,
  $$ values ('b6000000-0000-0000-0000-0000000000a1', 'invoiced'), ('b6000000-0000-0000-0000-0000000000a2', 'in_progress') $$,
  'completed work order moves to Invoiced; the in-progress one is left alone');

-- 21-23. pdf_path set once, canonical only.
select throws_ok(
  $$ update public.invoices set pdf_path = 'somewhere/else.pdf' where quote_id = 'b7000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'pdf_path must be the canonical path');
select lives_ok(
  $$ update public.invoices set pdf_path = organization_id::text || '/' || quote_id::text || '/' || invoice_number || '.pdf'
       where quote_id = 'b7000000-0000-0000-0000-0000000000a1' $$,
  'pdf_path can be set to the canonical path');
select throws_ok(
  $$ update public.invoices set pdf_path = null where quote_id = 'b7000000-0000-0000-0000-0000000000a1' $$,
  '23514', null, 'pdf_path cannot be changed once set');

-- 24-26. RLS on invoice_lines and invoice_settings.
select pg_temp.act_as('b2222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.invoice_lines), 0, 'planner cannot read invoice lines');
select throws_ok(
  $$ insert into public.invoice_settings (organization_id, payment_term_days) values ('b1000000-0000-0000-0000-00000000000a', 5) $$,
  '42501', null, 'planner cannot write invoice settings');
select pg_temp.act_as('b2777777-7777-7777-7777-777777777777');
select is((select count(*)::int from public.invoice_lines), 0, 'another organization''s owner cannot read invoice lines');

select * from finish();
rollback;
