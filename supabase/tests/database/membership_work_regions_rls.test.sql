-- pgTAP RLS tests for public.membership_work_regions (issue #192, "Manage
-- Service Areas via Settings; link engineers to a default + work areas" --
-- 20260918090000_service_area_seed_and_work_regions.sql): the new
-- derive_and_validate_membership_work_region() BEFORE INSERT trigger
-- (SECURITY DEFINER), and the owner-only write / any-member-read RLS
-- boundary on this brand-new join table.
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Mirrors the precedent set by
-- supabase/tests/database/region_reference_list_rls.test.sql
-- (20260915090000_region_reference_list.sql) -- same fixture/structure
-- (org_a with owner/planner/engineer, org_b with just an owner,
-- pg_temp.act_as() helper, a pg_temp.captured_ids table to smuggle an id
-- across an RLS boundary). Switch to the `authenticated` role and set
-- `request.jwt.claims` to simulate auth.uid() for a given fixture user. All
-- auth.users rows here are test fixtures, rolled back at the end of the
-- transaction.
--
-- Does NOT touch sites.region_id / memberships.region_id / list_key='region'
-- -- this table is purely additive, a new join table alongside those
-- pre-existing columns.

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a (owner_a, planner_a, engineer_a) + org_b (owner_b), one
-- membership_work_regions row target: engineer_a's membership. Both
-- organizations' `region` reference list is seeded automatically by the
-- organizations_seed_reference_lists trigger on insert into
-- public.organizations (same as every other RLS test file in this suite --
-- no manual seed_default_reference_lists call needed).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c9111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('c9222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('c9333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('c9444444-4444-4444-4444-444444444444', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create table pg_temp.captured_ids (key text primary key, val uuid not null);

select pg_temp.act_as('c9111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('c9000000-0000-0000-0000-00000000000a', 'Org A', 'c9111111-1111-1111-1111-111111111111');

insert into public.memberships (id, user_id, organization_id, role) values
  ('c9500000-0000-0000-0000-00000000000a', 'c9111111-1111-1111-1111-111111111111', 'c9000000-0000-0000-0000-00000000000a', 'owner'),
  ('c9500000-0000-0000-0000-00000000000b', 'c9222222-2222-2222-2222-222222222222', 'c9000000-0000-0000-0000-00000000000a', 'planner'),
  ('c9500000-0000-0000-0000-00000000000c', 'c9333333-3333-3333-3333-333333333333', 'c9000000-0000-0000-0000-00000000000a', 'engineer');

select pg_temp.act_as('c9444444-4444-4444-4444-444444444444');

insert into public.organizations (id, name, created_by)
values ('c9000000-0000-0000-0000-00000000000b', 'Org B', 'c9444444-4444-4444-4444-444444444444');

insert into public.memberships (id, user_id, organization_id, role)
values ('c9500000-0000-0000-0000-00000000000d', 'c9444444-4444-4444-4444-444444444444', 'c9000000-0000-0000-0000-00000000000b', 'owner');

-- Capture org_b's seeded "regio_noord" region item id, needed later (while
-- acting as owner_a) for the cross-org region_id hostile-insert test. Must be
-- captured while acting as owner_b -- RLS on reference_list_items would
-- otherwise hide org_b's row from owner_a.
insert into pg_temp.captured_ids (key, val)
select 'org_b_region_noord_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'c9000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'region' and rli.value = 'regio_noord';

select pg_temp.act_as('c9111111-1111-1111-1111-111111111111');

-- Capture org_a's own region item ids, needed for the tests below.
insert into pg_temp.captured_ids (key, val)
select 'org_a_region_midden_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'c9000000-0000-0000-0000-00000000000a'
  and rl.list_key = 'region' and rli.value = 'regio_midden';

insert into pg_temp.captured_ids (key, val)
select 'org_a_region_zuid_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'c9000000-0000-0000-0000-00000000000a'
  and rl.list_key = 'region' and rli.value = 'regio_zuid';

insert into pg_temp.captured_ids (key, val)
select 'org_a_asset_type_default_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'c9000000-0000-0000-0000-00000000000a'
  and rl.list_key = 'asset_type' and rli.is_default;

-- ---------------------------------------------------------------------------
-- 0. Seed verification: the 4th default region item, 'intern_werkplaats',
--    exists for a fresh org (20260918090000_service_area_seed_and_work_
--    regions.sql).
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(rli.value order by rli.sort_order)
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'c9000000-0000-0000-0000-00000000000a' and rl.list_key = 'region'),
  array['regio_noord', 'regio_midden', 'regio_zuid', 'intern_werkplaats'],
  'org_a''s region list was auto-seeded with all 4 default items, in sort_order (regio_noord, regio_midden, regio_zuid, intern_werkplaats)'
); -- 1

-- ---------------------------------------------------------------------------
-- 1. Trigger validation: dangling membership_id, dangling region_id, wrong
--    list_key, cross-org region_id, and a valid same-org insert.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.membership_work_regions (membership_id, region_id)
     select gen_random_uuid(), val from pg_temp.captured_ids where key = 'org_a_region_midden_id' $$,
  '23503',
  null,
  'membership_work_regions.membership_id pointing at a nonexistent membership is rejected as dangling'
); -- 2

select throws_ok(
  $$ insert into public.membership_work_regions (membership_id, region_id)
     values ('c9500000-0000-0000-0000-00000000000c', gen_random_uuid()) $$,
  '23503',
  null,
  'membership_work_regions.region_id pointing at a nonexistent reference_list_items row is rejected as dangling'
); -- 3

select throws_ok(
  $$ insert into public.membership_work_regions (membership_id, region_id)
     select 'c9500000-0000-0000-0000-00000000000c', val
     from pg_temp.captured_ids where key = 'org_a_asset_type_default_id' $$,
  '23514',
  null,
  'membership_work_regions.region_id must be from the region list, not asset_type'
); -- 4

select throws_ok(
  $$ insert into public.membership_work_regions (membership_id, region_id)
     select 'c9500000-0000-0000-0000-00000000000c', val
     from pg_temp.captured_ids where key = 'org_b_region_noord_id' $$,
  '23514',
  null,
  'membership_work_regions.region_id from a different organization''s region list (org_b''s) is rejected'
); -- 5

select lives_ok(
  $$ insert into public.membership_work_regions (membership_id, region_id)
     select 'c9500000-0000-0000-0000-00000000000c', val
     from pg_temp.captured_ids where key = 'org_a_region_midden_id' $$,
  'owner_a can assign engineer_a''s membership a valid same-org work region (Regio Midden)'
); -- 6

select is(
  (select rli.value from public.membership_work_regions mwr
     join public.reference_list_items rli on rli.id = mwr.region_id
     where mwr.membership_id = 'c9500000-0000-0000-0000-00000000000c'),
  'regio_midden',
  'engineer_a''s work region assignment actually points at Regio Midden, proving the write took effect'
); -- 7

select is(
  (select organization_id from public.membership_work_regions
     where membership_id = 'c9500000-0000-0000-0000-00000000000c' and region_id = (select val from pg_temp.captured_ids where key = 'org_a_region_midden_id')),
  'c9000000-0000-0000-0000-00000000000a'::uuid,
  'the new row''s organization_id was correctly derived from the membership, not client-supplied'
); -- 8

-- ---------------------------------------------------------------------------
-- 2. Unique constraint: duplicate (membership_id, region_id) insert fails.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.membership_work_regions (membership_id, region_id)
     select 'c9500000-0000-0000-0000-00000000000c', val
     from pg_temp.captured_ids where key = 'org_a_region_midden_id' $$,
  '23505',
  null,
  'duplicate (membership_id, region_id) insert is rejected by the unique constraint'
); -- 9

-- ---------------------------------------------------------------------------
-- 3. Non-owner (planner_a) INSERT is rejected by RLS (not the trigger) --
--    same owner-only write boundary as memberships_update_owner.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c9222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.membership_work_regions (membership_id, region_id)
     select 'c9500000-0000-0000-0000-00000000000c', val
     from pg_temp.captured_ids where key = 'org_a_region_zuid_id' $$,
  '42501',
  null,
  'planner_a (non-owner) cannot INSERT a work region assignment -- rejected by RLS with check (is_org_owner)'
); -- 10

select pg_temp.act_as('c9111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.membership_work_regions
     where membership_id = 'c9500000-0000-0000-0000-00000000000c'),
  1,
  'planner_a''s rejected INSERT left engineer_a with exactly the one Regio Midden assignment from test 6'
); -- 11

-- ---------------------------------------------------------------------------
-- 4. Tenant isolation: owner_b (org_b) cannot see org_a's assignment row, and
--    cannot insert one against org_a's membership either.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c9444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from public.membership_work_regions
     where membership_id = 'c9500000-0000-0000-0000-00000000000c'),
  0,
  'owner_b cannot SELECT engineer_a''s work region assignment (different org) -- unreachable, not just hidden'
); -- 12

select throws_ok(
  $$ insert into public.membership_work_regions (membership_id, region_id)
     select 'c9500000-0000-0000-0000-00000000000c', val
     from pg_temp.captured_ids where key = 'org_a_region_zuid_id' $$,
  '42501',
  null,
  'owner_b cannot insert a work region row against engineer_a''s (org_a) membership, even using a valid same-org (org_a) region_id -- organization_id is derived as org_a by the trigger, and owner_b is not an owner of org_a, so the membership_work_regions_insert_owner WITH CHECK (is_org_owner(organization_id)) policy rejects it'
); -- 13

select pg_temp.act_as('c9111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 5. Cascade delete: removing the membership removes its work region rows.
-- ---------------------------------------------------------------------------
delete from public.memberships where id = 'c9500000-0000-0000-0000-00000000000c';

select is(
  (select count(*)::int from public.membership_work_regions
     where membership_id = 'c9500000-0000-0000-0000-00000000000c'),
  0,
  'deleting engineer_a''s membership cascade-deletes its membership_work_regions row(s)'
); -- 14

select * from finish();
rollback;
