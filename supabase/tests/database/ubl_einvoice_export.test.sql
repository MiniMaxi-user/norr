-- pgTAP tests for the UBL e-invoice / CSV export schema (issue #241,
-- 20261123090000_ubl_einvoice_export.sql): new column defaults, client and
-- settings toggles obey the existing RLS roles, recipient kvk_number in the
-- snapshot (invoice + credit note), invoices.ubl_path set-once, and the
-- email_outbox extra attachment validation.
--
-- Run with: supabase test db   (requires Docker)

begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, email) values
  ('c2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('c2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('c2555555-5555-5555-5555-555555555555', 'finance-a@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Fixtures as the table owner.
select set_config('request.jwt.claims', json_build_object('sub', 'c2111111-1111-1111-1111-111111111111')::text, true);
insert into public.organizations (id, name, created_by)
values ('c1000000-0000-0000-0000-00000000000a', 'Org A', 'c2111111-1111-1111-1111-111111111111');
insert into public.memberships (user_id, organization_id, role) values
  ('c2111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-00000000000a', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('c2222222-2222-2222-2222-222222222222', 'c1000000-0000-0000-0000-00000000000a', 'planner'),
  ('c2555555-5555-5555-5555-555555555555', 'c1000000-0000-0000-0000-00000000000a', 'finance');
insert into public.clients (id, organization_id, name, kvk_number, vat_number) values
  ('c3000000-0000-0000-0000-0000000000a0', 'c1000000-0000-0000-0000-00000000000a', 'Own Co', '00000001', 'NL000000000B01'),
  ('c3000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-00000000000a', 'Client A', '12345678', 'NL111111111B01');
update public.organizations set own_client_id = 'c3000000-0000-0000-0000-0000000000a0'
where id = 'c1000000-0000-0000-0000-00000000000a';
insert into public.invoice_email_settings (organization_id, from_email)
values ('c1000000-0000-0000-0000-00000000000a', 'billing@example.com');
insert into public.quotes (id, client_id, name)
values ('c7000000-0000-0000-0000-0000000000a1', 'c3000000-0000-0000-0000-0000000000a1', 'Quote 1');
insert into public.quote_line_items (quote_id, description, quantity, unit_price, sort_order)
values ('c7000000-0000-0000-0000-0000000000a1', 'Labour', 1, 50.00, 1);

create or replace function pg_temp.upd(p_sql text) returns integer
language plpgsql
as $$
declare v integer;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
end;
$$;
grant execute on function pg_temp.upd(text) to authenticated;

-- Defaults
select is((select ubl_email_enabled from public.clients where id = 'c3000000-0000-0000-0000-0000000000a1'),
  false, 'clients.ubl_email_enabled defaults to false');
select is((select attach_ubl from public.invoice_email_settings where organization_id = 'c1000000-0000-0000-0000-00000000000a'),
  true, 'invoice_email_settings.attach_ubl defaults to true');

-- Snapshot (invoice + credit note)
select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');
select public.create_invoice('c7000000-0000-0000-0000-0000000000a1');
select is((select recipient ->> 'kvk_number' from public.invoices where quote_id = 'c7000000-0000-0000-0000-0000000000a1' and kind = 'invoice'),
  '12345678', 'new invoice snapshots the buyer kvk_number');
select public.credit_invoice((select id from public.invoices where quote_id = 'c7000000-0000-0000-0000-0000000000a1' and kind = 'invoice'), 'test');
select is((select recipient ->> 'kvk_number' from public.invoices where quote_id = 'c7000000-0000-0000-0000-0000000000a1' and kind = 'credit_note'),
  '12345678', 'credit note carries the buyer kvk_number');

-- Client toggle: owner only (clients_update_owner)
select is(pg_temp.upd($q$update public.clients set ubl_email_enabled = true where id = 'c3000000-0000-0000-0000-0000000000a1'$q$),
  1, 'owner can enable ubl_email_enabled on a client');
select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');
select is(pg_temp.upd($q$update public.clients set ubl_email_enabled = false where id = 'c3000000-0000-0000-0000-0000000000a1'$q$),
  0, 'planner cannot change ubl_email_enabled');

-- Settings toggle: invoicing members only
select pg_temp.act_as('c2555555-5555-5555-5555-555555555555');
select is(pg_temp.upd($q$update public.invoice_email_settings set attach_ubl = false$q$),
  1, 'finance can change attach_ubl');
select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');
select is(pg_temp.upd($q$update public.invoice_email_settings set attach_ubl = true$q$),
  0, 'planner cannot change attach_ubl');

-- ubl_path: set once, canonical, invoicing members only
select is(pg_temp.upd($q$update public.invoices set ubl_path = 'x' where kind = 'invoice'$q$),
  0, 'planner cannot set ubl_path');
select pg_temp.act_as('c2555555-5555-5555-5555-555555555555');
select throws_ok(
  $$ update public.invoices set ubl_path = 'c1000000-0000-0000-0000-00000000000a/wrong.xml' where kind = 'invoice' $$,
  '23514', null, 'non-canonical ubl_path is rejected');
select lives_ok(
  $$ update public.invoices
       set ubl_path = organization_id::text || '/' || quote_id::text || '/' || invoice_number || '.xml'
     where kind = 'invoice' $$,
  'canonical ubl_path can be set once by an invoicing member');
select throws_ok(
  $$ update public.invoices set ubl_path = null where kind = 'invoice' $$,
  '23514', null, 'ubl_path cannot be changed once set');

-- Outbox extra attachment
select throws_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text,
       extra_attachment_path, extra_attachment_filename)
     select 'invoice', id, array['a@example.com'], 'billing@example.com', 's', 'b',
       'c1000000-0000-0000-0000-00000000000b/secret.xml', 'x.xml'
     from public.invoices where kind = 'invoice' $$,
  '42501', null, 'foreign extra_attachment_path is rejected');
select lives_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text,
       extra_attachment_path, extra_attachment_filename)
     select 'invoice', id, array['a@example.com'], 'billing@example.com', 's-ubl', 'b', ubl_path, 'x.xml'
     from public.invoices where kind = 'invoice' $$,
  'the invoice ubl_path is accepted as extra attachment');
select lives_ok(
  $$ update public.invoices
       set ubl_path = organization_id::text || '/' || quote_id::text || '/' || invoice_number || '.xml'
     where kind = 'credit_note' $$,
  'canonical ubl_path can be set on the credit note row');
select lives_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text,
       extra_attachment_path, extra_attachment_filename)
     select 'credit_note', id, array['a@example.com'], 'billing@example.com', 's-cn-ubl', 'b', ubl_path, 'x.xml'
     from public.invoices where kind = 'credit_note' $$,
  'credit note mail accepts the credit note row ubl_path as extra attachment');
select throws_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text,
       extra_attachment_path, extra_attachment_filename)
     select 'credit_note', c.id, array['a@example.com'], 'billing@example.com', 's', 'b', i.ubl_path, 'x.xml'
     from public.invoices c join public.invoices i on i.id = c.credits_invoice_id
     where c.kind = 'credit_note' $$,
  '42501', null, 'credit note mail rejects the original invoice ubl_path (foreign to its own row)');
select throws_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text, extra_attachment_path)
     select 'invoice', id, array['a@example.com'], 'billing@example.com', 's', 'b', ubl_path
     from public.invoices where kind = 'invoice' $$,
  '23514', null, 'extra attachment path and filename must be set together');

reset role;
select * from finish();
rollback;
