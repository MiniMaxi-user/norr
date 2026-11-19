-- pgTAP tests for public.work_order_photos + the work-order-photos storage
-- bucket (issue #224, 20261119120000_work_order_photos.sql).
--
-- Run with: supabase test db   (requires Docker)

begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

insert into auth.users (id, email) values
  ('f6111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('f6222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('f6333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('f6444444-4444-4444-4444-444444444444', 'engineer2-a@test.local'),
  ('f6555555-5555-5555-5555-555555555555', 'finance-a@test.local'),
  ('f6777777-7777-7777-7777-777777777777', 'owner-b@test.local');

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

-- Fixtures are written as the table owner (see create_field_work_order test).
select set_config('request.jwt.claims', json_build_object('sub', 'f6111111-1111-1111-1111-111111111111')::text, true);
insert into public.organizations (id, name, created_by)
values ('f7000000-0000-0000-0000-00000000000a', 'Org A', 'f6111111-1111-1111-1111-111111111111');
insert into public.memberships (user_id, organization_id, role) values
  ('f6111111-1111-1111-1111-111111111111', 'f7000000-0000-0000-0000-00000000000a', 'owner');
insert into public.memberships (user_id, organization_id, role) values
  ('f6222222-2222-2222-2222-222222222222', 'f7000000-0000-0000-0000-00000000000a', 'planner'),
  ('f6333333-3333-3333-3333-333333333333', 'f7000000-0000-0000-0000-00000000000a', 'engineer'),
  ('f6444444-4444-4444-4444-444444444444', 'f7000000-0000-0000-0000-00000000000a', 'engineer'),
  ('f6555555-5555-5555-5555-555555555555', 'f7000000-0000-0000-0000-00000000000a', 'finance');
insert into public.clients (id, organization_id, name) values
  ('f8000000-0000-0000-0000-00000000000a', 'f7000000-0000-0000-0000-00000000000a', 'Client A');
insert into public.work_orders (id, client_id, external_reference, assigned_to) values
  ('f9000000-0000-0000-0000-00000000000a', 'f8000000-0000-0000-0000-00000000000a', 'WO A', 'f6333333-3333-3333-3333-333333333333'),
  ('f9000000-0000-0000-0000-00000000000b', 'f8000000-0000-0000-0000-00000000000a', 'WO B', 'f6444444-4444-4444-4444-444444444444');

select set_config('request.jwt.claims', json_build_object('sub', 'f6777777-7777-7777-7777-777777777777')::text, true);
insert into public.organizations (id, name, created_by)
values ('f7000000-0000-0000-0000-00000000000b', 'Org B', 'f6777777-7777-7777-7777-777777777777');
insert into public.memberships (user_id, organization_id, role)
values ('f6777777-7777-7777-7777-777777777777', 'f7000000-0000-0000-0000-00000000000b', 'owner');

-- Fixture photos + storage objects (as table owner).
insert into public.work_order_photos (id, work_order_id, storage_path, content_type, size_bytes, taken_at) values
  ('fa000000-0000-0000-0000-00000000000a', 'f9000000-0000-0000-0000-00000000000a',
   'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000a/fa000000-0000-0000-0000-00000000000a.jpg', 'image/jpeg', 1000, now()),
  ('fa000000-0000-0000-0000-00000000000b', 'f9000000-0000-0000-0000-00000000000b',
   'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000b/fa000000-0000-0000-0000-00000000000b.jpg', 'image/jpeg', 1000, now());
insert into storage.objects (bucket_id, name) values
  ('work-order-photos', 'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000a/fa000000-0000-0000-0000-00000000000a.jpg'),
  ('work-order-photos', 'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000b/fa000000-0000-0000-0000-00000000000b.jpg');

-- Bucket config.
select is(
  (select public from storage.buckets where id = 'work-order-photos'), false,
  'work-order-photos bucket is private');
select is(
  (select file_size_limit from storage.buckets where id = 'work-order-photos'), 10485760::bigint,
  'bucket has a 10 MB size limit');

-- Table: engineer A (assigned to WO A only).
select pg_temp.act_as('f6333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.work_order_photos), 1,
  'engineer sees only photos of work orders assigned to them');
select lives_ok(
  $$ insert into public.work_order_photos (id, work_order_id, storage_path, content_type, size_bytes, width, height, taken_at, client_photo_key)
     values ('fa000000-0000-0000-0000-0000000000c1', 'f9000000-0000-0000-0000-00000000000a',
       'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000a/fa000000-0000-0000-0000-0000000000c1.jpg',
       'image/jpeg', 2048, 800, 600, now(), 'fb000000-0000-0000-0000-000000000001') $$,
  'engineer can add a photo to their assigned work order');
select is(
  (select count(*)::int from public.work_order_photos
    where id = 'fa000000-0000-0000-0000-0000000000c1'
      and organization_id = 'f7000000-0000-0000-0000-00000000000a'
      and uploaded_by = 'f6333333-3333-3333-3333-333333333333'),
  1, 'organization_id is derived and uploaded_by stamped from auth.uid()');
select throws_ok(
  $$ insert into public.work_order_photos (work_order_id, storage_path, content_type, size_bytes, taken_at)
     values ('f9000000-0000-0000-0000-00000000000b',
       'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000b/x.jpg', 'image/jpeg', 10, now()) $$,
  '42501', null, 'engineer cannot add a photo to an unassigned work order');
select throws_ok(
  $$ insert into public.work_order_photos (work_order_id, storage_path, content_type, size_bytes, taken_at, client_photo_key)
     values ('f9000000-0000-0000-0000-00000000000a',
       'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000a/dup.jpg', 'image/jpeg', 10, now(),
       'fb000000-0000-0000-0000-000000000001') $$,
  '23505', null, 'same client_photo_key on the same work order is rejected');
select lives_ok(
  $$ insert into public.work_order_photos (work_order_id, storage_path, content_type, size_bytes, taken_at, client_photo_key)
     values ('f9000000-0000-0000-0000-00000000000a',
       'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000a/dup.jpg', 'image/jpeg', 10, now(),
       'fb000000-0000-0000-0000-000000000001') on conflict (work_order_id, client_photo_key) do nothing $$,
  'retried upload with on conflict do nothing is idempotent');
select throws_ok(
  $$ insert into public.work_order_photos (work_order_id, organization_id, storage_path, content_type, size_bytes, taken_at)
     values ('f9000000-0000-0000-0000-00000000000a', 'f7000000-0000-0000-0000-00000000000b',
       'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000a/y.jpg', 'image/jpeg', 10, now()) $$,
  '42501', null, 'organization_id is not client-writable');
select throws_ok(
  $$ update public.work_order_photos set content_type = 'image/png' $$,
  '42501', null, 'photos cannot be updated');
select is(
  pg_temp.del('public.work_order_photos', 'true'), 0,
  'engineer cannot delete photos');

-- Planner.
select pg_temp.act_as('f6222222-2222-2222-2222-222222222222');
select lives_ok(
  $$ insert into public.work_order_photos (id, work_order_id, storage_path, content_type, size_bytes, taken_at)
     values ('fa000000-0000-0000-0000-0000000000c2', 'f9000000-0000-0000-0000-00000000000b',
       'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000b/fa000000-0000-0000-0000-0000000000c2.png', 'image/png', 10, now()) $$,
  'planner can add a photo to any work order of the org');
select throws_ok(
  $$ insert into public.work_order_photos (work_order_id, storage_path, content_type, size_bytes, taken_at)
     values ('f9000000-0000-0000-0000-00000000000b', 'wrong/prefix.jpg', 'image/jpeg', 10, now()) $$,
  '23514', null, 'storage_path must start with {organization_id}/{work_order_id}/');

-- Engineer 2 (assigned to WO B only).
select pg_temp.act_as('f6444444-4444-4444-4444-444444444444');
select is(
  (select count(*)::int from public.work_order_photos where work_order_id = 'f9000000-0000-0000-0000-00000000000a'), 0,
  'engineer 2 cannot see photos of the other engineer''s work order');
select is(
  (select count(*)::int from public.work_order_photos), 2,
  'engineer 2 sees photos on their own work order');

-- Finance: read-only.
select pg_temp.act_as('f6555555-5555-5555-5555-555555555555');
select is(
  (select count(*)::int from public.work_order_photos), 4,
  'finance sees all photos in the org');
select throws_ok(
  $$ insert into public.work_order_photos (work_order_id, storage_path, content_type, size_bytes, taken_at)
     values ('f9000000-0000-0000-0000-00000000000a',
       'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000a/f.jpg', 'image/jpeg', 10, now()) $$,
  '42501', null, 'finance cannot add photos');

-- Owner B: tenant isolation.
select pg_temp.act_as('f6777777-7777-7777-7777-777777777777');
select is(
  (select count(*)::int from public.work_order_photos), 0,
  'other organization sees no photos');
select throws_ok(
  $$ insert into public.work_order_photos (work_order_id, storage_path, content_type, size_bytes, taken_at)
     values ('f9000000-0000-0000-0000-00000000000a',
       'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000a/x.jpg', 'image/jpeg', 10, now()) $$,
  '42501', null, 'other organization cannot add a photo to this work order');

-- Storage: engineer A.
select pg_temp.act_as('f6333333-3333-3333-3333-333333333333');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('work-order-photos', 'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000a/new.jpg') $$,
  'engineer can upload to an assigned work order path');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('work-order-photos', 'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000b/new.jpg') $$,
  '42501', null, 'engineer cannot upload to an unassigned work order path');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('work-order-photos', 'f7000000-0000-0000-0000-00000000000b/f9000000-0000-0000-0000-00000000000a/new.jpg') $$,
  '42501', null, 'engineer cannot upload under another organization path');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'work-order-photos'), 2,
  'engineer sees only objects of assigned work orders');
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'work_order_photos_bucket_delete'), 1,
  'bucket delete policy exists (direct storage.objects deletes are blocked by the platform; asserted via the policy definition)');

-- Storage: finance.
select pg_temp.act_as('f6555555-5555-5555-5555-555555555555');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'work-order-photos'), 3,
  'finance sees all objects in the org');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('work-order-photos', 'f7000000-0000-0000-0000-00000000000a/f9000000-0000-0000-0000-00000000000a/fin.jpg') $$,
  '42501', null, 'finance cannot upload objects');

-- Storage: owner B isolation.
select pg_temp.act_as('f6777777-7777-7777-7777-777777777777');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'work-order-photos'), 0,
  'other organization sees no objects');

-- Planner deletes.
select pg_temp.act_as('f6222222-2222-2222-2222-222222222222');
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'work_order_photos_bucket_delete' and qual like '%owner%' and qual like '%planner%' and qual not like '%engineer%'), 1,
  'bucket delete policy is restricted to owner/planner');
select is(
  pg_temp.del('public.work_order_photos', 'id = ''fa000000-0000-0000-0000-0000000000c2'''), 1,
  'planner can delete a photo');

reset role;
select is(
  has_function_privilege('anon', 'public.work_order_photo_access(uuid,uuid,boolean)', 'execute'), false,
  'anon cannot execute the access helper');

select * from finish();
rollback;
