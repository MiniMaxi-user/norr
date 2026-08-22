-- pgTAP RLS tests for reference_lists / reference_list_items
-- (20260822200000_reference_lists.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/clients_sites_assets_rls.test.sql: switch to the
-- `authenticated` role and set `request.jwt.claims` to simulate auth.uid()
-- for a given fixture user. All auth.users rows here are test fixtures,
-- rolled back at the end of the transaction.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error — the row is silently excluded (0 rows changed). Only
-- INSERT/UPDATE `WITH CHECK` violations (and column-level privilege
-- revokes) raise error 42501.

begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- ---------------------------------------------------------------------------
-- Fixtures: two orgs, each with an owner + a non-owner member (planner).
-- Creating each organization automatically seeds its default reference
-- lists/items via organizations_seed_reference_lists — that's exactly the
-- behavior under test in section 1 below.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c1111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('c2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('c3333333-3333-3333-3333-333333333333', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('c1111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('d1000000-0000-0000-0000-00000000000a', 'Org A', 'c1111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role)
values ('c1111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-00000000000a', 'owner');

insert into public.memberships (user_id, organization_id, role)
values ('c2222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-00000000000a', 'planner');

select pg_temp.act_as('c3333333-3333-3333-3333-333333333333');

insert into public.organizations (id, name, created_by)
values ('d1000000-0000-0000-0000-00000000000b', 'Org B', 'c3333333-3333-3333-3333-333333333333');

insert into public.memberships (user_id, organization_id, role)
values ('c3333333-3333-3333-3333-333333333333', 'd1000000-0000-0000-0000-00000000000b', 'owner');

-- ---------------------------------------------------------------------------
-- 1. Seed-on-org-creation: org_a got both default lists, with the expected
--    item counts and default flags, purely from inserting into organizations
--    (no application-layer step).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c1111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.reference_lists where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  2,
  'org_a automatically got 2 reference_lists (asset_type, asset_status) on organization insert'
); -- 1

select is(
  (select count(*)::int from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type'),
  5,
  'org_a''s seeded asset_type list has the 5 default items'
); -- 2

select is(
  (select rli.value from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'asset_status' and rli.is_default),
  'active',
  'org_a''s seeded asset_status list has exactly one default item, value=active'
); -- 3

-- Capture org_a's asset_type reference_list_id (server-generated, no
-- client-supplied id available) into a plain temp table while owner_a can
-- still see it, so section 5 below (acting as owner_b, who by design
-- cannot SELECT org_a's rows at all) can still reference it by value in a
-- hostile cross-tenant INSERT attempt.
create table pg_temp.captured_ids (key text primary key, val uuid not null);

insert into pg_temp.captured_ids (key, val)
select 'org_a_asset_type_list_id', id
from public.reference_lists
where organization_id = 'd1000000-0000-0000-0000-00000000000a' and list_key = 'asset_type';

-- ---------------------------------------------------------------------------
-- 2. Read: any org member (including non-owner) can SELECT.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.reference_list_items where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  8,
  'planner_a (non-owner member) can SELECT all of org_a''s reference_list_items (5 asset_type + 3 asset_status)'
); -- 4

-- ---------------------------------------------------------------------------
-- 3. Write: owner-only. Non-owner INSERT is rejected (42501); non-owner
--    UPDATE/DELETE are silently excluded by RLS USING (0 rows affected).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.reference_list_items (reference_list_id, value, label)
     select id, 'custom', 'Custom' from public.reference_lists
     where organization_id = 'd1000000-0000-0000-0000-00000000000a' and list_key = 'asset_type' $$,
  '42501',
  null,
  'planner_a (non-owner) cannot INSERT a reference_list_item (RLS owner-only backstop)'
); -- 5

update public.reference_list_items
set label = 'Hijacked'
where reference_list_id = (
  select id from public.reference_lists
  where organization_id = 'd1000000-0000-0000-0000-00000000000a' and list_key = 'asset_type'
) and value = 'hvac';

select is(
  (select label from public.reference_list_items where value = 'hvac' and organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  'HVAC',
  'planner_a''s UPDATE on a reference_list_item is silently excluded by RLS (USING); label unchanged'
); -- 6

delete from public.reference_list_items
where organization_id = 'd1000000-0000-0000-0000-00000000000a' and value = 'hvac';

select is(
  (select count(*)::int from public.reference_list_items where organization_id = 'd1000000-0000-0000-0000-00000000000a' and value = 'hvac'),
  1,
  'planner_a''s DELETE on a reference_list_item is silently excluded by RLS (USING); row still present'
); -- 7

select throws_ok(
  $$ insert into public.reference_lists (organization_id, list_key, name)
     values ('d1000000-0000-0000-0000-00000000000a', 'custom_list', 'Custom List') $$,
  '42501',
  null,
  'planner_a (non-owner) cannot INSERT a reference_lists row (RLS owner-only backstop)'
); -- 8

-- ---------------------------------------------------------------------------
-- 4. Owner CRUD happy path on reference_list_items, plus
--    enforce_single_default_reference_item behavior.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.reference_list_items (id, reference_list_id, value, label, sort_order)
     select 'e1000000-0000-0000-0000-00000000000a', id, 'security', 'Security System', 6
     from public.reference_lists
     where organization_id = 'd1000000-0000-0000-0000-00000000000a' and list_key = 'asset_type' $$,
  'owner_a can insert a new custom asset_type item ("Security System")'
); -- 9

select is(
  (select organization_id from public.reference_list_items where id = 'e1000000-0000-0000-0000-00000000000a'),
  'd1000000-0000-0000-0000-00000000000a'::uuid,
  'the new item''s organization_id was auto-derived from reference_list_id, not client-supplied'
); -- 10

select throws_ok(
  $$ insert into public.reference_list_items (reference_list_id, value, label, organization_id)
     select id, 'spoofed', 'Spoofed', 'd1000000-0000-0000-0000-00000000000a'
     from public.reference_lists
     where organization_id = 'd1000000-0000-0000-0000-00000000000a' and list_key = 'asset_type' $$,
  '42501',
  null,
  'owner_a cannot set reference_list_items.organization_id directly on insert (column-level grant withheld)'
); -- 11

select lives_ok(
  $$ update public.reference_list_items set label = 'Security', is_default = true where id = 'e1000000-0000-0000-0000-00000000000a' $$,
  'owner_a can update a reference_list_item, including marking it the new default'
); -- 12

select is(
  (select count(*)::int from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'asset_type' and rli.is_default),
  1,
  'enforce_single_default_reference_item unset the previous default ("Other") when "Security" became the new default — still exactly one default'
); -- 13

select is(
  (select rli.value from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'asset_type' and rli.is_default),
  'security',
  'the new default item is "security" (the one just updated)'
); -- 14

select throws_ok(
  $$ update public.reference_list_items set reference_list_id = (
       select id from public.reference_lists
       where organization_id = 'd1000000-0000-0000-0000-00000000000a' and list_key = 'asset_status'
     ) where id = 'e1000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'owner_a cannot move an item to a different list via UPDATE (reference_list_id excluded from the UPDATE column grant entirely)'
); -- 15

select lives_ok(
  $$ delete from public.reference_list_items where id = 'e1000000-0000-0000-0000-00000000000a' $$,
  'owner_a can delete a reference_list_item they own'
); -- 16

-- ---------------------------------------------------------------------------
-- 5. Cross-tenant isolation.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c3333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.reference_lists where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s reference_lists'
); -- 17

select is(
  (select count(*)::int from public.reference_list_items where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s reference_list_items'
); -- 18

select throws_ok(
  $$ insert into public.reference_list_items (reference_list_id, value, label)
     select val, 'hostile', 'Hostile' from pg_temp.captured_ids where key = 'org_a_asset_type_list_id' $$,
  '42501',
  null,
  'owner_b cannot insert into org_a''s asset_type list (not is_org_owner of org_a) — note owner_b cannot even SELECT org_a''s reference_lists row directly (see test 17), so the target reference_list_id is supplied via a captured id rather than a live subquery'
); -- 19

select is(
  (select count(*)::int from public.reference_lists where organization_id = 'd1000000-0000-0000-0000-00000000000b'),
  2,
  'owner_b''s own org_b independently got its own 2 seeded reference_lists (isolation, not shared rows)'
); -- 20

select * from finish();
rollback;
