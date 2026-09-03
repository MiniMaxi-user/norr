-- pgTAP tests for issue #120 schema prerequisites
-- (20260903090000_clients_logo_and_organization_own_client.sql):
--   - clients.logo_path / logo_updated_at (trigger-stamped, owner-writable,
--     withheld from the INSERT grant).
--   - organizations.own_client_id (owner-writable, same-org validated via
--     validate_organization_own_client).
--   - The "client-logos" Storage bucket: public SELECT, org-owner-only
--     INSERT/UPDATE/DELETE keyed on the path's organization_id segment.
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/clients_sites_assets_rls.test.sql /
-- work_order_auto_draft_quotes_rls.test.sql: switch to the `authenticated`
-- role and set `request.jwt.claims` to simulate auth.uid() for a given
-- fixture user. Note on RLS semantics (same as those files): a `USING`
-- clause violation on UPDATE does NOT raise an error -- the row is silently
-- excluded (0 rows changed); only INSERT/UPDATE `WITH CHECK` violations (and
-- column-level privilege revokes) raise 42501. Cross-organization
-- reference-validation-trigger rejections raise 23514 (dangling id: 23503).

begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- ---------------------------------------------------------------------------
-- Fixtures: two orgs, each with an owner; org_a additionally has a
-- non-owner (planner) member. One client per org.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c9111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('c9222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('c9333333-3333-3333-3333-333333333333', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create table pg_temp.captured (key text primary key, val text);
grant all on pg_temp.captured to authenticated;

select pg_temp.act_as('c9111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('c8000000-0000-0000-0000-00000000000a', 'Org A', 'c9111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role) values
  ('c9111111-1111-1111-1111-111111111111', 'c8000000-0000-0000-0000-00000000000a', 'owner'),
  ('c9222222-2222-2222-2222-222222222222', 'c8000000-0000-0000-0000-00000000000a', 'planner');

insert into public.clients (id, organization_id, name)
values ('c7000000-0000-0000-0000-00000000000a', 'c8000000-0000-0000-0000-00000000000a', 'Client A');

select pg_temp.act_as('c9333333-3333-3333-3333-333333333333');

insert into public.organizations (id, name, created_by)
values ('c8000000-0000-0000-0000-00000000000b', 'Org B', 'c9333333-3333-3333-3333-333333333333');

insert into public.memberships (user_id, organization_id, role)
values ('c9333333-3333-3333-3333-333333333333', 'c8000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name)
values ('c7000000-0000-0000-0000-00000000000b', 'c8000000-0000-0000-0000-00000000000b', 'Client B');

-- ---------------------------------------------------------------------------
-- clients.logo_path / logo_updated_at
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c9111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ insert into public.clients (organization_id, name, logo_path)
     values ('c8000000-0000-0000-0000-00000000000a', 'Insert Logo Client', 'c8000000-0000-0000-0000-00000000000a/x/logo.webp') $$,
  '42501',
  null,
  'owner_a cannot set logo_path on INSERT (column-level grant withheld -- upload only happens after the client already exists)'
); -- 1

select lives_ok(
  $$ update public.clients
     set logo_path = 'c8000000-0000-0000-0000-00000000000a/c7000000-0000-0000-0000-00000000000a/logo.webp'
     where id = 'c7000000-0000-0000-0000-00000000000a' $$,
  'owner_a can set logo_path on Client A via UPDATE'
); -- 2

select isnt(
  (select logo_updated_at from public.clients where id = 'c7000000-0000-0000-0000-00000000000a'),
  null::timestamptz,
  'logo_updated_at was auto-stamped (trigger) when logo_path was first set'
); -- 3

insert into pg_temp.captured (key, val)
select 'logo_updated_at_v1', logo_updated_at::text from public.clients where id = 'c7000000-0000-0000-0000-00000000000a';

select lives_ok(
  $$ update public.clients set name = 'Client A Renamed' where id = 'c7000000-0000-0000-0000-00000000000a' $$,
  'owner_a can update an unrelated column (name) on Client A'
); -- 4

select is(
  (select logo_updated_at::text from public.clients where id = 'c7000000-0000-0000-0000-00000000000a'),
  (select val from pg_temp.captured where key = 'logo_updated_at_v1'),
  'logo_updated_at is unchanged when a column other than logo_path is updated (trigger only fires ON UPDATE OF logo_path)'
); -- 5

select lives_ok(
  $$ update public.clients
     set logo_path = 'c8000000-0000-0000-0000-00000000000a/c7000000-0000-0000-0000-00000000000a/logo.webp?v=2'
     where id = 'c7000000-0000-0000-0000-00000000000a' $$,
  'owner_a can re-upload (change) logo_path on Client A'
); -- 6

select isnt(
  (select logo_updated_at::text from public.clients where id = 'c7000000-0000-0000-0000-00000000000a'),
  (select val from pg_temp.captured where key = 'logo_updated_at_v1'),
  'logo_updated_at was re-stamped when logo_path actually changed (re-upload)'
); -- 7

select pg_temp.act_as('c9222222-2222-2222-2222-222222222222');

update public.clients set logo_path = 'hijacked/hijacked/logo.webp' where id = 'c7000000-0000-0000-0000-00000000000a';

select is(
  (select logo_path from public.clients where id = 'c7000000-0000-0000-0000-00000000000a'),
  'c8000000-0000-0000-0000-00000000000a/c7000000-0000-0000-0000-00000000000a/logo.webp?v=2',
  'planner_a (non-owner) cannot change logo_path -- silently excluded by RLS (clients_update_owner is owner-only); value unchanged'
); -- 8

-- ---------------------------------------------------------------------------
-- organizations.own_client_id
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c9111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ update public.organizations set own_client_id = 'c7000000-0000-0000-0000-00000000000a'
     where id = 'c8000000-0000-0000-0000-00000000000a' $$,
  'owner_a can set own_client_id to Client A (their own org''s own client)'
); -- 9

select is(
  (select own_client_id from public.organizations where id = 'c8000000-0000-0000-0000-00000000000a'),
  'c7000000-0000-0000-0000-00000000000a'::uuid,
  'own_client_id was persisted'
); -- 10

select throws_ok(
  $$ update public.organizations set own_client_id = 'c7000000-0000-0000-0000-00000000000b'
     where id = 'c8000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'org_a cannot set own_client_id to Client B (org_b''s client -- validate_organization_own_client cross-org rejection)'
); -- 11

select throws_ok(
  $$ update public.organizations set own_client_id = '00000000-0000-0000-0000-000000000000'
     where id = 'c8000000-0000-0000-0000-00000000000a' $$,
  '23503',
  null,
  'org_a cannot set own_client_id to a nonexistent client id (validate_organization_own_client dangling-id rejection)'
); -- 12

select pg_temp.act_as('c9222222-2222-2222-2222-222222222222');

update public.organizations set own_client_id = null where id = 'c8000000-0000-0000-0000-00000000000a';

select is(
  (select own_client_id from public.organizations where id = 'c8000000-0000-0000-0000-00000000000a'),
  'c7000000-0000-0000-0000-00000000000a'::uuid,
  'planner_a (non-owner) cannot change own_client_id -- silently excluded by RLS (organizations_update_owner is owner-only); value unchanged'
); -- 13

-- ---------------------------------------------------------------------------
-- Storage: "client-logos" bucket. Public SELECT; INSERT/UPDATE/DELETE
-- restricted to is_org_owner((storage.foldername(name))[1]::uuid).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c9111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('client-logos', 'c8000000-0000-0000-0000-00000000000a/c7000000-0000-0000-0000-00000000000a/logo.webp') $$,
  'owner_a can INSERT a client-logos object under org_a''s own folder'
); -- 14

select lives_ok(
  $$ update storage.objects set metadata = '{"size": 1234}'::jsonb
     where bucket_id = 'client-logos'
       and name = 'c8000000-0000-0000-0000-00000000000a/c7000000-0000-0000-0000-00000000000a/logo.webp' $$,
  'owner_a can UPDATE (re-upload metadata for) that same object'
); -- 15

select pg_temp.act_as('c9222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'client-logos'),
  1,
  'planner_a (any authenticated caller) can SELECT the client-logos object -- public-read bucket policy'
); -- 16

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('client-logos', 'c8000000-0000-0000-0000-00000000000a/c7000000-0000-0000-0000-00000000000a/second.webp') $$,
  '42501',
  null,
  'planner_a (non-owner, same org) cannot INSERT into client-logos under org_a''s folder (is_org_owner check fails)'
); -- 17

select pg_temp.act_as('c9333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('client-logos', 'c8000000-0000-0000-0000-00000000000a/hostile/logo.webp') $$,
  '42501',
  null,
  'owner_b (different organization) cannot INSERT into client-logos under org_a''s folder'
); -- 18

update storage.objects set metadata = '{"size": 999}'::jsonb
where bucket_id = 'client-logos'
  and name = 'c8000000-0000-0000-0000-00000000000a/c7000000-0000-0000-0000-00000000000a/logo.webp';

select is(
  (select metadata from storage.objects
     where bucket_id = 'client-logos'
       and name = 'c8000000-0000-0000-0000-00000000000a/c7000000-0000-0000-0000-00000000000a/logo.webp'),
  '{"size": 1234}'::jsonb,
  'owner_b''s UPDATE attempt on org_a''s logo object is silently excluded by RLS (USING clause fails); metadata unchanged'
); -- 19

select lives_ok(
  $$ delete from storage.objects
     where bucket_id = 'client-logos'
       and name = 'c8000000-0000-0000-0000-00000000000a/c7000000-0000-0000-0000-00000000000a/logo.webp' $$,
  'owner_b''s DELETE runs without error but silently excludes org_a''s object (USING clause fails, matching the delete-is-a-silent-no-op RLS semantics documented at the top of this file); real assertion is the row-still-exists check below'
); -- 20

select pg_temp.act_as('c9111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from storage.objects
     where bucket_id = 'client-logos'
       and name = 'c8000000-0000-0000-0000-00000000000a/c7000000-0000-0000-0000-00000000000a/logo.webp'),
  1,
  'org_a''s logo object still exists after owner_b''s delete attempt (DELETE USING clause silently excluded it)'
); -- 21

select lives_ok(
  $$ delete from storage.objects
     where bucket_id = 'client-logos'
       and name = 'c8000000-0000-0000-0000-00000000000a/c7000000-0000-0000-0000-00000000000a/logo.webp' $$,
  'owner_a can delete their own org''s logo object'
); -- 22

select * from finish();
rollback;
