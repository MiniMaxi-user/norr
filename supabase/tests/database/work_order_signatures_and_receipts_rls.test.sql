-- pgTAP tests for work_order_signatures, work_receipts, work_receipt_email_settings
-- and their storage buckets (issue #226,
-- 20261119140000_work_order_signatures_and_receipts.sql).
--
-- Run with: supabase test db   (requires Docker)

begin;
create extension if not exists pgtap with schema extensions;

select plan(57);

insert into auth.users (id, email) values
  ('e6111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('e6222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('e6333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('e6444444-4444-4444-4444-444444444444', 'engineer2-a@test.local'),
  ('e6555555-5555-5555-5555-555555555555', 'finance-a@test.local'),
  ('e6666666-6666-6666-6666-666666666666', 'admin-a@test.local'),
  ('e6777777-7777-7777-7777-777777777777', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.del(p_table text, p_where text) returns int
language plpgsql
as $$
declare n int;
begin
  execute format('with d as (delete from %s where %s returning 1) select count(*)::int from d', p_table, p_where) into n;
  return n;
end;
$$;

-- Fixtures are written as the table owner.
select set_config('request.jwt.claims', json_build_object('sub', 'e6111111-1111-1111-1111-111111111111')::text, true);
insert into public.organizations (id, name, created_by)
values ('e7000000-0000-0000-0000-00000000000a', 'Org A', 'e6111111-1111-1111-1111-111111111111');
insert into public.memberships (user_id, organization_id, role) values
  ('e6111111-1111-1111-1111-111111111111', 'e7000000-0000-0000-0000-00000000000a', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('e6222222-2222-2222-2222-222222222222', 'e7000000-0000-0000-0000-00000000000a', 'planner'),
  ('e6333333-3333-3333-3333-333333333333', 'e7000000-0000-0000-0000-00000000000a', 'engineer'),
  ('e6444444-4444-4444-4444-444444444444', 'e7000000-0000-0000-0000-00000000000a', 'engineer'),
  ('e6555555-5555-5555-5555-555555555555', 'e7000000-0000-0000-0000-00000000000a', 'finance'),
  ('e6666666-6666-6666-6666-666666666666', 'e7000000-0000-0000-0000-00000000000a', 'administratie');
insert into public.clients (id, organization_id, name) values
  ('e8000000-0000-0000-0000-00000000000a', 'e7000000-0000-0000-0000-00000000000a', 'Client A');
insert into public.work_orders (id, client_id, external_reference, assigned_to) values
  ('e9000000-0000-0000-0000-00000000000a', 'e8000000-0000-0000-0000-00000000000a', 'WO A', 'e6333333-3333-3333-3333-333333333333'),
  ('e9000000-0000-0000-0000-00000000000b', 'e8000000-0000-0000-0000-00000000000a', 'WO B', 'e6444444-4444-4444-4444-444444444444'),
  ('e9000000-0000-0000-0000-00000000000c', 'e8000000-0000-0000-0000-00000000000a', 'WO C open', 'e6333333-3333-3333-3333-333333333333');
-- WO A and WO B are completed; WO C keeps its default (new) status.
update public.work_orders
set status_id = (
  select rli.id from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rli.organization_id = 'e7000000-0000-0000-0000-00000000000a'
    and rl.list_key = 'work_order_status' and rli.value = 'completed')
where id in ('e9000000-0000-0000-0000-00000000000a', 'e9000000-0000-0000-0000-00000000000b');

select set_config('request.jwt.claims', json_build_object('sub', 'e6777777-7777-7777-7777-777777777777')::text, true);
insert into public.organizations (id, name, created_by)
values ('e7000000-0000-0000-0000-00000000000b', 'Org B', 'e6777777-7777-7777-7777-777777777777');
insert into public.memberships (user_id, organization_id, role)
values ('e6777777-7777-7777-7777-777777777777', 'e7000000-0000-0000-0000-00000000000b', 'owner');

-- ===== Buckets =====
select is((select public from storage.buckets where id = 'work-order-signatures'), false, 'signatures bucket is private');
select is((select file_size_limit from storage.buckets where id = 'work-order-signatures'), 1048576::bigint, 'signatures bucket 1 MB limit');
select is((select allowed_mime_types from storage.buckets where id = 'work-order-signatures'), array['image/png'], 'signatures bucket is png only');
select is((select public from storage.buckets where id = 'work-receipts'), false, 'receipts bucket is private');
select is((select file_size_limit from storage.buckets where id = 'work-receipts'), 10485760::bigint, 'receipts bucket 10 MB limit');
select is((select allowed_mime_types from storage.buckets where id = 'work-receipts'), array['application/pdf'], 'receipts bucket is pdf only');

-- ===== Signatures: engineer A (assigned to WO A and C) =====
select pg_temp.act_as('e6333333-3333-3333-3333-333333333333');
select lives_ok(
  $$ insert into public.work_order_signatures (work_order_id, storage_path, signed_at)
     values ('e9000000-0000-0000-0000-00000000000a',
       'e7000000-0000-0000-0000-00000000000a/e9000000-0000-0000-0000-00000000000a/signature.png', now()) $$,
  'engineer can add a signature to an assigned work order');
select is(
  (select count(*)::int from public.work_order_signatures
    where organization_id = 'e7000000-0000-0000-0000-00000000000a'
      and uploaded_by = 'e6333333-3333-3333-3333-333333333333'),
  1, 'organization_id derived and uploaded_by stamped');
select lives_ok(
  $$ insert into public.work_order_signatures (work_order_id, storage_path, signed_at)
     values ('e9000000-0000-0000-0000-00000000000a',
       'e7000000-0000-0000-0000-00000000000a/e9000000-0000-0000-0000-00000000000a/signature.png', now())
     on conflict (work_order_id) do update set storage_path = excluded.storage_path, signed_at = excluded.signed_at $$,
  'retry/replace via upsert is idempotent');
select is((select count(*)::int from public.work_order_signatures), 1, 'still exactly one signature per work order');
select throws_ok(
  $$ insert into public.work_order_signatures (work_order_id, storage_path, signed_at)
     values ('e9000000-0000-0000-0000-00000000000b',
       'e7000000-0000-0000-0000-00000000000a/e9000000-0000-0000-0000-00000000000b/signature.png', now()) $$,
  '42501', null, 'engineer cannot sign an unassigned work order');
select throws_ok(
  $$ insert into public.work_order_signatures (work_order_id, storage_path, signed_at)
     values ('e9000000-0000-0000-0000-00000000000c', 'wrong/path.png', now()) $$,
  '23514', null, 'storage_path must be the canonical signature path');
select throws_ok(
  $$ update public.work_order_signatures set organization_id = 'e7000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'organization_id is not client-writable');
select throws_ok($$ delete from public.work_order_signatures $$, '42501', null, 'signatures cannot be deleted');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('work-order-signatures', 'e7000000-0000-0000-0000-00000000000a/e9000000-0000-0000-0000-00000000000a/signature.png') $$,
  'engineer can upload the signature object for an assigned work order');
select lives_ok(
  $$ update storage.objects set metadata = '{}'::jsonb
     where bucket_id = 'work-order-signatures' and name = 'e7000000-0000-0000-0000-00000000000a/e9000000-0000-0000-0000-00000000000a/signature.png' $$,
  'engineer can replace (update) the signature object');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('work-order-signatures', 'e7000000-0000-0000-0000-00000000000a/e9000000-0000-0000-0000-00000000000b/signature.png') $$,
  '42501', null, 'engineer cannot upload a signature for an unassigned work order');

-- Planner can sign any WO of the org.
select pg_temp.act_as('e6222222-2222-2222-2222-222222222222');
select lives_ok(
  $$ insert into public.work_order_signatures (work_order_id, storage_path, signed_at)
     values ('e9000000-0000-0000-0000-00000000000b',
       'e7000000-0000-0000-0000-00000000000a/e9000000-0000-0000-0000-00000000000b/signature.png', now()) $$,
  'planner can add a signature to any work order of the org');
select is((select count(*)::int from public.work_order_signatures), 2, 'planner sees all signatures');

-- Engineer 2 only sees WO B.
select pg_temp.act_as('e6444444-4444-4444-4444-444444444444');
select is((select count(*)::int from public.work_order_signatures), 1, 'engineer 2 sees only signatures of assigned work orders');

-- Finance: read only.
select pg_temp.act_as('e6555555-5555-5555-5555-555555555555');
select is((select count(*)::int from public.work_order_signatures), 2, 'finance reads all signatures');
select throws_ok(
  $$ insert into public.work_order_signatures (work_order_id, storage_path, signed_at)
     values ('e9000000-0000-0000-0000-00000000000c',
       'e7000000-0000-0000-0000-00000000000a/e9000000-0000-0000-0000-00000000000c/signature.png', now()) $$,
  '42501', null, 'finance cannot add signatures');

-- Org B isolation.
select pg_temp.act_as('e6777777-7777-7777-7777-777777777777');
select is((select count(*)::int from public.work_order_signatures), 0, 'other organization sees no signatures');
select throws_ok(
  $$ insert into public.work_order_signatures (work_order_id, storage_path, signed_at)
     values ('e9000000-0000-0000-0000-00000000000c',
       'e7000000-0000-0000-0000-00000000000a/e9000000-0000-0000-0000-00000000000c/signature.png', now()) $$,
  '42501', null, 'other organization cannot sign this work order');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'work-order-signatures'), 0,
  'other organization sees no signature objects');

-- ===== Work receipts =====
select pg_temp.act_as('e6222222-2222-2222-2222-222222222222');
select lives_ok(
  $$ insert into public.work_receipts (id, work_order_id) values ('ea000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-00000000000a') $$,
  'planner can generate a receipt for a completed work order');
select is(
  (select version from public.work_receipts where id = 'ea000000-0000-0000-0000-000000000001'), 1,
  'first receipt is version 1');
select is(
  (select receipt_number from public.work_receipts where id = 'ea000000-0000-0000-0000-000000000001'),
  (select work_order_number || '-1' from public.work_orders where id = 'e9000000-0000-0000-0000-00000000000a'),
  'receipt_number is <work_order_number>-<version>');
select is(
  (select generated_by from public.work_receipts where id = 'ea000000-0000-0000-0000-000000000001'),
  'e6222222-2222-2222-2222-222222222222'::uuid, 'generated_by stamped');
select is(
  (select organization_id from public.work_receipts where id = 'ea000000-0000-0000-0000-000000000001'),
  'e7000000-0000-0000-0000-00000000000a'::uuid, 'organization_id derived');
select lives_ok(
  $$ insert into public.work_receipts (id, work_order_id) values ('ea000000-0000-0000-0000-000000000002', 'e9000000-0000-0000-0000-00000000000a') $$,
  'second generation succeeds');
select is(
  (select array_agg(version order by version) from public.work_receipts where work_order_id = 'e9000000-0000-0000-0000-00000000000a'),
  array[1, 2], 'versions are 1, 2');
select throws_ok(
  $$ insert into public.work_receipts (work_order_id) values ('e9000000-0000-0000-0000-00000000000c') $$,
  '23514', null, 'receipt rejected when the work order is not completed/invoiced');
select throws_ok(
  $$ insert into public.work_receipts (work_order_id, version, receipt_number) values ('e9000000-0000-0000-0000-00000000000a', 9, 'X-9') $$,
  '42501', null, 'version/receipt_number are not client-writable');
select lives_ok(
  $$ update public.work_receipts set pdf_path = 'e7000000-0000-0000-0000-00000000000a/e9000000-0000-0000-0000-00000000000a/' || receipt_number || '.pdf'
     where id = 'ea000000-0000-0000-0000-000000000001' $$,
  'pdf_path can be set once');
select throws_ok(
  $$ update public.work_receipts set pdf_path = 'other' where id = 'ea000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'pdf_path cannot be changed once set');
select throws_ok(
  $$ update public.work_receipts set pdf_path = 'bad/path.pdf' where id = 'ea000000-0000-0000-0000-000000000002' $$,
  '23514', null, 'pdf_path must be the canonical path');
select lives_ok(
  $$ update public.work_receipts set emailed_to = 'a@b.nl', emailed_at = now() where id = 'ea000000-0000-0000-0000-000000000001' $$,
  'e-mail log can be written');
select is(
  (select emailed_by from public.work_receipts where id = 'ea000000-0000-0000-0000-000000000001'),
  'e6222222-2222-2222-2222-222222222222'::uuid, 'emailed_by stamped');
select throws_ok(
  $$ update public.work_receipts set version = 5 where id = 'ea000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'version cannot be updated');
select throws_ok($$ delete from public.work_receipts $$, '42501', null, 'receipts cannot be deleted');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('work-receipts', 'e7000000-0000-0000-0000-00000000000a/e9000000-0000-0000-0000-00000000000a/x-1.pdf') $$,
  'planner can upload a receipt pdf');

-- Engineer: nothing.
select pg_temp.act_as('e6333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.work_receipts), 0, 'engineer sees no receipts');
select throws_ok(
  $$ insert into public.work_receipts (work_order_id) values ('e9000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'engineer cannot generate receipts');
select is((select count(*)::int from storage.objects where bucket_id = 'work-receipts'), 0, 'engineer sees no receipt objects');

-- Finance: read only.
select pg_temp.act_as('e6555555-5555-5555-5555-555555555555');
select is((select count(*)::int from public.work_receipts), 2, 'finance reads receipts');
select throws_ok(
  $$ insert into public.work_receipts (work_order_id) values ('e9000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'finance cannot generate receipts');
select is((select count(*)::int from storage.objects where bucket_id = 'work-receipts'), 1, 'finance reads receipt objects');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('work-receipts', 'e7000000-0000-0000-0000-00000000000a/e9000000-0000-0000-0000-00000000000a/f.pdf') $$,
  '42501', null, 'finance cannot upload receipt objects');

-- Administratie can generate and manage e-mail settings.
select pg_temp.act_as('e6666666-6666-6666-6666-666666666666');
select lives_ok(
  $$ insert into public.work_receipts (work_order_id) values ('e9000000-0000-0000-0000-00000000000b') $$,
  'administratie can generate a receipt');
select lives_ok(
  $$ insert into public.work_receipt_email_settings (organization_id, from_email, subject_template)
     values ('e7000000-0000-0000-0000-00000000000a', 'werkbon@example.com', 'Werkbon {{receipt_number}}') $$,
  'administratie can create e-mail settings');

-- Planner can READ e-mail settings (needed to send receipts,
-- 20261119150000_work_receipt_email_settings_planner_read.sql).
select pg_temp.act_as('e6222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.work_receipt_email_settings), 1, 'planner can read e-mail settings (to send receipts)');

-- Org B isolation.
select pg_temp.act_as('e6777777-7777-7777-7777-777777777777');
select is((select count(*)::int from public.work_receipts), 0, 'other organization sees no receipts');
select is((select count(*)::int from public.work_receipt_email_settings), 0, 'other organization sees no e-mail settings');
select throws_ok(
  $$ insert into public.work_receipts (work_order_id) values ('e9000000-0000-0000-0000-00000000000a') $$,
  '42501', null, 'other organization cannot generate receipts');

-- Policies / privileges (as owner).
reset role;
select is(
  (select count(*)::int from pg_policies
    where (schemaname = 'public' and tablename in ('work_receipts', 'work_order_signatures') and cmd = 'DELETE')
       or (schemaname = 'storage' and tablename = 'objects'
           and (policyname like 'work_receipts_bucket%' or policyname like 'work_order_signatures_bucket%')
           and cmd = 'DELETE')
       or (schemaname = 'storage' and tablename = 'objects' and policyname like 'work_receipts_bucket%' and cmd = 'UPDATE')),
  0, 'no delete policies on receipts/signatures (tables and buckets) and no update on the receipts bucket');
select is(
  has_function_privilege('anon', 'public.work_receipt_object_access(text,boolean)', 'execute')
  or has_function_privilege('anon', 'public.prepare_work_receipt_insert()', 'execute')
  or has_function_privilege('anon', 'public.guard_work_receipt_update()', 'execute')
  or has_function_privilege('anon', 'public.prepare_work_order_signature()', 'execute'),
  false, 'anon cannot execute the new functions');

select * from finish();
rollback;
