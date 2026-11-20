-- pgTAP tests for email_outbox (issue #268, 20261122110000_email_outbox.sql).
--
-- Run with: supabase test db   (requires Docker)

begin;
create extension if not exists pgtap with schema extensions;

select plan(64);

insert into auth.users (id, email) values
  ('ea111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('ea222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('ea333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('ea555555-5555-5555-5555-555555555555', 'finance-a@test.local'),
  ('ea666666-6666-6666-6666-666666666666', 'admin-a@test.local'),
  ('ea777777-7777-7777-7777-777777777777', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Fixtures are written as the table owner.
select set_config('request.jwt.claims', json_build_object('sub', 'ea111111-1111-1111-1111-111111111111')::text, true);
insert into public.organizations (id, name, created_by)
values ('eb000000-0000-0000-0000-00000000000a', 'Org A', 'ea111111-1111-1111-1111-111111111111');
insert into public.memberships (user_id, organization_id, role)
values ('ea111111-1111-1111-1111-111111111111', 'eb000000-0000-0000-0000-00000000000a', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('ea222222-2222-2222-2222-222222222222', 'eb000000-0000-0000-0000-00000000000a', 'planner'),
  ('ea333333-3333-3333-3333-333333333333', 'eb000000-0000-0000-0000-00000000000a', 'engineer'),
  ('ea555555-5555-5555-5555-555555555555', 'eb000000-0000-0000-0000-00000000000a', 'finance'),
  ('ea666666-6666-6666-6666-666666666666', 'eb000000-0000-0000-0000-00000000000a', 'administratie');
insert into public.clients (id, organization_id, name)
values ('ec000000-0000-0000-0000-00000000000a', 'eb000000-0000-0000-0000-00000000000a', 'Client A');
insert into public.work_orders (id, client_id, external_reference)
values ('ed000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-00000000000a', 'WO A');
update public.work_orders
set status_id = (
  select rli.id from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rli.organization_id = 'eb000000-0000-0000-0000-00000000000a'
    and rl.list_key = 'work_order_status' and rli.value = 'completed')
where id = 'ed000000-0000-0000-0000-00000000000a';
insert into public.work_receipts (work_order_id) values ('ed000000-0000-0000-0000-00000000000a');
insert into public.quotes (id, client_id, name)
values ('ee000000-0000-0000-0000-00000000000a', 'ec000000-0000-0000-0000-00000000000a', 'Quote A');
insert into public.invoices (id, organization_id, quote_id, invoice_number, invoice_date, due_date,
  payment_term_days, subtotal, vat_total, total, recipient, pdf_path)
values ('ef000000-0000-0000-0000-00000000000a', 'eb000000-0000-0000-0000-00000000000a',
  'ee000000-0000-0000-0000-00000000000a', 'INV-TEST-0001', current_date, current_date + 30, 30, 100, 21, 121, '{}'::jsonb,
  'eb000000-0000-0000-0000-00000000000a/INV-TEST-0001.pdf');
insert into public.invoice_email_settings (organization_id, from_email)
values ('eb000000-0000-0000-0000-00000000000a', 'billing@example.com');
insert into public.work_receipt_email_settings (organization_id, from_email)
values ('eb000000-0000-0000-0000-00000000000a', 'billing@example.com');
update public.work_receipts
set pdf_path = organization_id::text || '/' || work_order_id::text || '/' || receipt_number || '.pdf'
where work_order_id = 'ed000000-0000-0000-0000-00000000000a';

select set_config('request.jwt.claims', json_build_object('sub', 'ea777777-7777-7777-7777-777777777777')::text, true);
insert into public.organizations (id, name, created_by)
values ('eb000000-0000-0000-0000-00000000000b', 'Org B', 'ea777777-7777-7777-7777-777777777777');
insert into public.memberships (user_id, organization_id, role)
values ('ea777777-7777-7777-7777-777777777777', 'eb000000-0000-0000-0000-00000000000b', 'owner');

create temp table fx_receipt as select id from public.work_receipts where work_order_id = 'ed000000-0000-0000-0000-00000000000a';
grant select on fx_receipt to authenticated;

-- Queue helpers (subject = key). Run as the calling role, so RLS applies.
create or replace function pg_temp.q_invoice(p_subject text) returns void
language plpgsql
as $$
begin
  insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text)
  values ('invoice', 'ef000000-0000-0000-0000-00000000000a', array['client@example.com'], 'billing@example.com', p_subject, 'body');
end;
$$;
create or replace function pg_temp.q_receipt(p_subject text) returns void
language plpgsql
as $$
begin
  insert into public.email_outbox (kind, work_receipt_id, to_addresses, from_address, subject, body_text)
  values ('work_receipt', (select id from fx_receipt), array['client@example.com'], 'billing@example.com', p_subject, 'body');
end;
$$;
grant execute on function pg_temp.q_invoice(text), pg_temp.q_receipt(text) to authenticated;
create or replace function pg_temp.oid(p_subject text) returns uuid
language sql
as $$ select id from public.email_outbox where subject = p_subject $$;
grant execute on function pg_temp.oid(text) to authenticated, service_role;

-- ===== Inserts: invoice kind = owner / finance / administratie =====
select pg_temp.act_as('ea111111-1111-1111-1111-111111111111');
select lives_ok($$ select pg_temp.q_invoice('inv-owner') $$, 'owner can queue an invoice mail');
select is(
  (select queued_by from public.email_outbox where subject = 'inv-owner'),
  'ea111111-1111-1111-1111-111111111111'::uuid, 'queued_by stamped from auth.uid()');
select is(
  (select organization_id from public.email_outbox where subject = 'inv-owner'),
  'eb000000-0000-0000-0000-00000000000a'::uuid, 'organization_id derived from the invoice');
select is(
  (select status || attempts::text from public.email_outbox where subject = 'inv-owner'),
  'queued0', 'new mails start queued with 0 attempts');
select throws_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text, status)
     values ('invoice', 'ef000000-0000-0000-0000-00000000000a', array['a@example.com'], 'billing@example.com', 's', 'b', 'sent') $$,
  '42501', null, 'status cannot be set from a client insert');
select throws_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text, provider_message_id)
     values ('invoice', 'ef000000-0000-0000-0000-00000000000a', array['a@example.com'], 'billing@example.com', 's', 'b', 'fake') $$,
  '42501', null, 'provider_message_id cannot be set from a client insert');
select throws_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text)
     values ('credit_note', 'ef000000-0000-0000-0000-00000000000a', array['a@example.com'], 'billing@example.com', 's', 'b') $$,
  '23514', null, 'kind must match the invoice kind');
select throws_ok(
  $$ insert into public.email_outbox (kind, invoice_id, work_receipt_id, to_addresses, from_address, subject, body_text)
     values ('invoice', 'ef000000-0000-0000-0000-00000000000a', (select id from fx_receipt),
       array['a@example.com'], 'billing@example.com', 's', 'b') $$,
  '23514', null, 'exactly one source reference per kind');

select pg_temp.act_as('ea555555-5555-5555-5555-555555555555');
select lives_ok($$ select pg_temp.q_invoice('inv-finance') $$, 'finance can queue an invoice mail');
select throws_ok($$ select pg_temp.q_receipt('wr-finance') $$, '42501', null, 'finance cannot queue a work receipt mail');

select pg_temp.act_as('ea666666-6666-6666-6666-666666666666');
select lives_ok($$ select pg_temp.q_invoice('inv-admin') $$, 'administratie can queue an invoice mail');
select lives_ok($$ select pg_temp.q_receipt('wr-admin-extra') $$, 'administratie can queue a work receipt mail');

select pg_temp.act_as('ea222222-2222-2222-2222-222222222222');
select throws_ok($$ select pg_temp.q_invoice('inv-planner') $$, '42501', null, 'planner cannot queue an invoice mail');
select lives_ok($$ select pg_temp.q_receipt('wr-planner') $$, 'planner can queue a work receipt mail');

select pg_temp.act_as('ea333333-3333-3333-3333-333333333333');
select throws_ok($$ select pg_temp.q_receipt('wr-engineer') $$, '42501', null, 'engineer cannot queue a work receipt mail');

select pg_temp.act_as('ea777777-7777-7777-7777-777777777777');
select throws_ok($$ select pg_temp.q_invoice('inv-other-org') $$, '42501', null, 'other org owner cannot queue a mail for a foreign invoice');

-- ===== Reads (5 mails: inv-owner, inv-finance, inv-admin, wr-admin-extra, wr-planner) =====
select pg_temp.act_as('ea111111-1111-1111-1111-111111111111');
select is((select count(*)::int from public.email_outbox), 5, 'owner sees all mails');
select pg_temp.act_as('ea555555-5555-5555-5555-555555555555');
select is((select count(*)::int from public.email_outbox), 5, 'finance sees invoice and work receipt mails');
select pg_temp.act_as('ea222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.email_outbox), 2, 'planner sees only the work receipt mails');
select pg_temp.act_as('ea333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.email_outbox), 0, 'engineer sees nothing');
select pg_temp.act_as('ea777777-7777-7777-7777-777777777777');
select is((select count(*)::int from public.email_outbox), 0, 'other organization sees nothing');

-- ===== No direct update / delete =====
select pg_temp.act_as('ea111111-1111-1111-1111-111111111111');
select throws_ok($$ update public.email_outbox set status = 'sent' $$, '42501', null, 'owner cannot update status directly');
select throws_ok($$ delete from public.email_outbox $$, '42501', null, 'owner cannot delete mails');

-- ===== retry_email_outbox =====
reset role;
update public.email_outbox set status = 'failed', attempts = 5, last_error = 'boom'
where subject in ('inv-owner', 'wr-planner');

select pg_temp.act_as('ea222222-2222-2222-2222-222222222222');
select throws_ok($$ select public.retry_email_outbox(pg_temp.oid('inv-owner')) $$,
  'P0002', null, 'planner cannot see (so not retry) an invoice mail');
select lives_ok($$ select public.retry_email_outbox(pg_temp.oid('wr-planner')) $$,
  'planner can retry a failed work receipt mail');
select is(
  (select status || attempts::text from public.email_outbox where subject = 'wr-planner'), 'queued0',
  'retry resets to queued with 0 attempts');

select pg_temp.act_as('ea111111-1111-1111-1111-111111111111');
select throws_ok($$ select public.retry_email_outbox(pg_temp.oid('inv-finance')) $$,
  '55000', null, 'only failed mails can be retried');
select lives_ok($$ select public.retry_email_outbox(pg_temp.oid('inv-owner')) $$, 'owner can retry a failed invoice mail');

select pg_temp.act_as('ea777777-7777-7777-7777-777777777777');
select throws_ok($$ select public.retry_email_outbox(pg_temp.oid('inv-owner')) $$,
  'P0002', null, 'other organization cannot retry (row invisible)');

-- ===== Processor functions are service_role only =====
select pg_temp.act_as('ea111111-1111-1111-1111-111111111111');
select throws_ok($$ select * from public.claim_email_outbox(10) $$, '42501', null, 'authenticated cannot claim');
select throws_ok($$ select public.email_outbox_sent_count(now() - interval '1 hour') $$, '42501', null, 'authenticated cannot count sent');
select throws_ok($$ select public.complete_email_outbox(pg_temp.oid('inv-owner'), true, 'x', null, null) $$,
  '42501', null, 'authenticated cannot complete');

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((select count(*)::int from public.claim_email_outbox(2)), 2, 'claim respects p_limit');
select is((select count(*)::int from public.claim_email_outbox(10)), 3, 'claim takes the remaining due mails');
select is((select count(*)::int from public.claim_email_outbox(10)), 0, 'nothing left to claim (no double claim)');

-- complete: sent / failed (+ source trail) / retry later
select lives_ok($$ select public.complete_email_outbox(pg_temp.oid('inv-owner'), true, 'resend-1', null, null) $$,
  'service_role completes a mail as sent');
select lives_ok($$ select public.complete_email_outbox(pg_temp.oid('wr-planner'), false, null, 'Invalid address', null) $$,
  'service_role completes a mail as definitively failed');
select lives_ok($$ select public.complete_email_outbox(pg_temp.oid('inv-finance'), false, null, '429', now() + interval '1 hour') $$,
  'service_role puts a mail back to queued for later');
select is(public.email_outbox_sent_count(now() - interval '1 hour'), 1, 'sent count covers all organizations');
reset role;

select is((select status || ':' || provider_message_id from public.email_outbox where subject = 'inv-owner'), 'sent:resend-1',
  'sent mail has status and provider id');
select is((select emailed_to || '|' || (emailed_at is not null)::text || '|' || coalesce(email_error, 'none')
  from public.invoices where id = 'ef000000-0000-0000-0000-00000000000a'),
  'client@example.com|true|none', 'invoice email trail updated on sent');
select is((select status || ':' || last_error from public.email_outbox where subject = 'wr-planner'), 'failed:Invalid address',
  'failed mail keeps a readable reason');
select is((select concat_ws('|', email_error, emailed_by::text) from public.work_receipts where work_order_id = 'ed000000-0000-0000-0000-00000000000a'),
  'Invalid address|ea222222-2222-2222-2222-222222222222', 'work receipt email_error set, emailed_by = queuing user');
select is((select status || ':' || (next_attempt_at > now() + interval '30 minutes')::text from public.email_outbox where subject = 'inv-finance'),
  'queued:true', 'retry-later mail is queued with a future next_attempt_at');

alter table public.email_outbox disable trigger email_outbox_touch_updated_at;
-- stuck in sending > 10 minutes is reclaimable
update public.email_outbox set status = 'sending', updated_at = now() - interval '11 minutes' where subject = 'inv-admin';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((select count(*)::int from public.claim_email_outbox(10)), 1, 'stale sending mail is reclaimed');
reset role;

-- ===== Hardening (20261122120000): attachment, sender, probing =====
create temp table fx_paths as
  select (select pdf_path from public.invoices where id = 'ef000000-0000-0000-0000-00000000000a') as inv_path,
         (select pdf_path from public.work_receipts where work_order_id = 'ed000000-0000-0000-0000-00000000000a') as wr_path;
grant select on fx_paths to authenticated;

select pg_temp.act_as('ea111111-1111-1111-1111-111111111111');
select throws_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text, attachment_path, attachment_filename)
     values ('invoice', 'ef000000-0000-0000-0000-00000000000a', array['a@example.com'], 'billing@example.com', 's', 'b',
       'eb000000-0000-0000-0000-00000000000b/secret.pdf', 'x.pdf') $$,
  '42501', null, 'foreign attachment_path is rejected');
select throws_ok(
  $$ insert into public.email_outbox (kind, work_receipt_id, to_addresses, from_address, subject, body_text, attachment_path, attachment_filename)
     values ('work_receipt', (select id from fx_receipt), array['a@example.com'], 'billing@example.com', 's', 'b',
       (select inv_path from fx_paths), 'x.pdf') $$,
  '42501', null, 'attachment_path of another source record is rejected');
select lives_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text, attachment_path, attachment_filename)
     values ('invoice', 'ef000000-0000-0000-0000-00000000000a', array['a@example.com'], 'billing@example.com', 's-att-inv', 'b',
       (select inv_path from fx_paths), 'x.pdf') $$,
  'the invoice pdf_path is accepted as attachment');
select lives_ok(
  $$ insert into public.email_outbox (kind, work_receipt_id, to_addresses, from_address, subject, body_text, attachment_path, attachment_filename)
     values ('work_receipt', (select id from fx_receipt), array['a@example.com'], 'billing@example.com', 's-att-wr', 'b',
       (select wr_path from fx_paths), 'x.pdf') $$,
  'the work receipt pdf_path is accepted as attachment');
select throws_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text)
     values ('invoice', 'ef000000-0000-0000-0000-00000000000a', array['a@example.com'], 'attacker@evil.test', 's', 'b') $$,
  '42501', null, 'from_address must be the configured sender');
select lives_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text)
     values ('invoice', 'ef000000-0000-0000-0000-00000000000a', array['a@example.com'], 'Acme BV <Billing@Example.com>', 's-name', 'b') $$,
  'display name + configured address (case-insensitive) is accepted');
select throws_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text)
     values ('invoice', 'ef000000-0000-0000-0000-00000000000a', array['a@example.com'], 'billing@example.com, x@evil.test', 's', 'b') $$,
  '23514', null, 'from_address must be a single mailbox');
select throws_ok(
  $$ insert into public.email_outbox (kind, invoice_id, to_addresses, from_address, subject, body_text)
     values ('invoice', gen_random_uuid(), array['a@example.com'], 'billing@example.com', 's', 'b') $$,
  '42501', null, 'unknown source id gives the same error as a foreign one');

-- ===== Processor lease =====
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(public.acquire_email_outbox_lease('a0000000-0000-0000-0000-00000000000a', 60), true, 'first holder acquires the lease');
select is(public.acquire_email_outbox_lease('b0000000-0000-0000-0000-00000000000b', 60), false, 'second holder is refused while the lease is live');
select is(public.acquire_email_outbox_lease('a0000000-0000-0000-0000-00000000000a', 60), true, 'holder can renew');
select lives_ok($$ select public.release_email_outbox_lease('b0000000-0000-0000-0000-00000000000b') $$, 'release by a non-holder is a no-op');
select is(public.acquire_email_outbox_lease('b0000000-0000-0000-0000-00000000000b', 60), false, 'lease still held after a foreign release');
reset role;
update public.email_outbox_processor_lease set expires_at = now() - interval '1 second';
set local role service_role;
select is(public.acquire_email_outbox_lease('b0000000-0000-0000-0000-00000000000b', 60), true, 'expired lease can be taken over');
select is(public.acquire_email_outbox_lease('a0000000-0000-0000-0000-00000000000a', 60), false, 'previous holder is refused after takeover');
select public.release_email_outbox_lease('b0000000-0000-0000-0000-00000000000b');
select is(public.acquire_email_outbox_lease('a0000000-0000-0000-0000-00000000000a', 60), true, 'lease is free after release');
reset role;
select pg_temp.act_as('ea111111-1111-1111-1111-111111111111');
select throws_ok($$ select public.acquire_email_outbox_lease('a0000000-0000-0000-0000-00000000000a', 60) $$, '42501', null, 'authenticated cannot acquire the lease');
select throws_ok($$ select public.release_email_outbox_lease('a0000000-0000-0000-0000-00000000000a') $$, '42501', null, 'authenticated cannot release the lease');
select throws_ok($$ select * from public.email_outbox_processor_lease $$, '42501', null, 'authenticated cannot read the lease table');
reset role;

select * from finish();
rollback;
