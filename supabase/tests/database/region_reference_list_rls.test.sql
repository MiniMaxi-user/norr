-- pgTAP RLS tests for the region reference list and its two consuming
-- columns, sites.region_id / memberships.region_id (issue #164, Planning
-- module -- 20260915090000_region_reference_list.sql): the shared
-- validate_region_reference_item() trigger (SECURITY DEFINER) attached
-- separately to public.sites and public.memberships.
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Mirrors the precedent set by
-- supabase/tests/database/engineer_client_rate_overrides_rls.test.sql
-- (20260830090000_engineer_client_rate_overrides.sql) -- the same migration
-- shape: plain nullable columns plus one new shared cross-table validation
-- trigger on already-RLS'd tables, no new table. Switch to the
-- `authenticated` role and set `request.jwt.claims` to simulate auth.uid()
-- for a given fixture user. All auth.users rows here are test fixtures,
-- rolled back at the end of the transaction.
--
-- This migration added NO new RLS policies (both tables reuse their existing
-- owner-only write policies unchanged -- see the migration's design note 7:
-- sites_insert_owner/sites_update_owner and memberships_update_owner all key
-- entirely on is_org_owner(organization_id), no column-specific predicate).
-- What is new and needs coverage here is: the seeded `region` reference list
-- itself (plus the new `inspectie` activity_type item, seeded by the same
-- migration), and the shared validate_region_reference_item trigger's
-- dangling/wrong-list-key/cross-org rejection on BOTH tables, plus
-- confirming the pre-existing owner-only write boundary and tenant isolation
-- still apply to the new column.
--
-- Note on RLS semantics: a USING clause violation on UPDATE does NOT raise
-- an error -- the row is silently excluded (0 rows changed). Only INSERT/
-- UPDATE WITH CHECK violations (and CHECK constraint / trigger violations)
-- raise an error.

begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a (owner_a, planner_a, engineer_a) + org_b (owner_b), one
-- client in org_a. Both organizations' `region`/`activity_type` reference
-- lists are seeded automatically by the organizations_seed_reference_lists
-- trigger on insert into public.organizations (same as every other RLS test
-- file in this suite -- no manual seed_default_reference_lists call needed).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('b9111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('b9222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('b9333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('b9444444-4444-4444-4444-444444444444', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create table pg_temp.captured_ids (key text primary key, val uuid not null);

select pg_temp.act_as('b9111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('b9000000-0000-0000-0000-00000000000a', 'Org A', 'b9111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role) values
  ('b9111111-1111-1111-1111-111111111111', 'b9000000-0000-0000-0000-00000000000a', 'owner'),
  ('b9222222-2222-2222-2222-222222222222', 'b9000000-0000-0000-0000-00000000000a', 'planner'),
  ('b9333333-3333-3333-3333-333333333333', 'b9000000-0000-0000-0000-00000000000a', 'engineer');

insert into public.clients (id, organization_id, name)
values ('b9600000-0000-0000-0000-00000000000a', 'b9000000-0000-0000-0000-00000000000a', 'Client A');

select pg_temp.act_as('b9444444-4444-4444-4444-444444444444');

insert into public.organizations (id, name, created_by)
values ('b9000000-0000-0000-0000-00000000000b', 'Org B', 'b9444444-4444-4444-4444-444444444444');

insert into public.memberships (user_id, organization_id, role)
values ('b9444444-4444-4444-4444-444444444444', 'b9000000-0000-0000-0000-00000000000b', 'owner');

-- Capture org_b's seeded region "regio_noord" item id, needed later (while
-- acting as owner_a) for the cross-org region_id hostile-insert/update
-- tests. Must be captured while acting as owner_b -- RLS on
-- reference_list_items would otherwise hide org_b's row from owner_a.
insert into pg_temp.captured_ids (key, val)
select 'org_b_region_noord_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'b9000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'region' and rli.value = 'regio_noord';

select pg_temp.act_as('b9111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 0. Seed verification: the 3 default region items and the new `inspectie`
--    activity_type item both actually exist for a fresh org, seeded by
--    seed_default_reference_lists (20260915090000_region_reference_list.sql).
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(rli.value order by rli.sort_order)
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'b9000000-0000-0000-0000-00000000000a' and rl.list_key = 'region'),
  array['regio_noord', 'regio_midden', 'regio_zuid'],
  'org_a''s region list was auto-seeded with exactly the 3 default items, in sort_order (regio_noord, regio_midden, regio_zuid)'
); -- 1

select is(
  (select count(*)::int from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'b9000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'inspectie'),
  1,
  'org_a''s activity_type list was auto-seeded with the new "inspectie" item'
); -- 2

-- ---------------------------------------------------------------------------
-- 1. sites.region_id: dangling reference, wrong list_key, cross-org, and a
--    valid same-org case. All exercised via INSERT (sites has no
--    pre-existing row to UPDATE in this fixture), which also proves the
--    trigger fires on INSERT, not just UPDATE.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.sites (client_id, region_id)
     values ('b9600000-0000-0000-0000-00000000000a', gen_random_uuid()) $$,
  '23503',
  null,
  'sites.region_id pointing at a nonexistent reference_list_items row is rejected as dangling (validate_region_reference_item)'
); -- 3

select throws_ok(
  $$ insert into public.sites (client_id, region_id)
     select 'b9600000-0000-0000-0000-00000000000a', rli.id
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'b9000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'asset_type' and rli.is_default $$,
  '23514',
  null,
  'sites.region_id must be from the region list, not asset_type (validate_region_reference_item)'
); -- 4

select throws_ok(
  $$ insert into public.sites (client_id, region_id)
     select 'b9600000-0000-0000-0000-00000000000a', val
     from pg_temp.captured_ids where key = 'org_b_region_noord_id' $$,
  '23514',
  null,
  'sites.region_id from a different organization''s region list (org_b''s) is rejected'
); -- 5

select lives_ok(
  $$ insert into public.sites (id, client_id, region_id)
     select 'b9700000-0000-0000-0000-00000000000a', 'b9600000-0000-0000-0000-00000000000a', rli.id
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'b9000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'region' and rli.value = 'regio_midden' $$,
  'owner_a can insert Site A under Client A with region_id set to a valid same-org region item (Regio Midden)'
); -- 6

select is(
  (select rli.value from public.sites s
     join public.reference_list_items rli on rli.id = s.region_id
     where s.id = 'b9700000-0000-0000-0000-00000000000a'),
  'regio_midden',
  'Site A''s region_id actually points at Regio Midden, proving the write took effect'
); -- 7

-- ---------------------------------------------------------------------------
-- 2. memberships.region_id: same 4 cases as sites, exercised via UPDATE on
--    engineer_a's existing membership row (mirrors
--    engineer_client_rate_overrides_rls.test.sql's UPDATE-based style for
--    this table), plus one fresh INSERT to independently prove the trigger
--    is attached to memberships too, not just re-using sites' attachment.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.memberships set region_id = gen_random_uuid()
     where user_id = 'b9333333-3333-3333-3333-333333333333'
       and organization_id = 'b9000000-0000-0000-0000-00000000000a' $$,
  '23503',
  null,
  'memberships.region_id pointing at a nonexistent reference_list_items row is rejected as dangling (validate_region_reference_item)'
); -- 8

select throws_ok(
  $$ update public.memberships
       set region_id = (select rli.id from public.reference_list_items rli
                           join public.reference_lists rl on rl.id = rli.reference_list_id
                           where rl.organization_id = 'b9000000-0000-0000-0000-00000000000a'
                             and rl.list_key = 'asset_type' and rli.is_default)
     where user_id = 'b9333333-3333-3333-3333-333333333333'
       and organization_id = 'b9000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'memberships.region_id must be from the region list, not asset_type (validate_region_reference_item)'
); -- 9

select throws_ok(
  $$ update public.memberships
       set region_id = (select val from pg_temp.captured_ids where key = 'org_b_region_noord_id')
     where user_id = 'b9333333-3333-3333-3333-333333333333'
       and organization_id = 'b9000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'memberships.region_id from a different organization''s region list (org_b''s) is rejected'
); -- 10

select lives_ok(
  $$ update public.memberships
       set region_id = (select rli.id from public.reference_list_items rli
                           join public.reference_lists rl on rl.id = rli.reference_list_id
                           where rl.organization_id = 'b9000000-0000-0000-0000-00000000000a'
                             and rl.list_key = 'region' and rli.value = 'regio_zuid')
     where user_id = 'b9333333-3333-3333-3333-333333333333'
       and organization_id = 'b9000000-0000-0000-0000-00000000000a' $$,
  'owner_a can set engineer_a''s membership region_id to a valid same-org region item (Regio Zuid)'
); -- 11

select is(
  (select rli.value from public.memberships m
     join public.reference_list_items rli on rli.id = m.region_id
     where m.user_id = 'b9333333-3333-3333-3333-333333333333'
       and m.organization_id = 'b9000000-0000-0000-0000-00000000000a'),
  'regio_zuid',
  'engineer_a''s membership region_id actually points at Regio Zuid, proving the write took effect'
); -- 12

select throws_ok(
  $$ insert into public.memberships (user_id, organization_id, role, region_id)
     select 'b9444444-4444-4444-4444-444444444444', 'b9000000-0000-0000-0000-00000000000a', 'engineer', val
     from pg_temp.captured_ids where key = 'org_b_region_noord_id' $$,
  '23514',
  null,
  'memberships: INSERT of a new member (owner_b, as an engineer of org_a) with a cross-org region_id (org_b''s) is rejected -- proves the trigger fires on INSERT, not just UPDATE'
); -- 13

-- ---------------------------------------------------------------------------
-- 3. Non-owner (planner_a) cannot write region_id on either table: silently
--    excluded by the pre-existing owner-only USING clauses
--    (sites_update_owner / memberships_update_owner), same semantics as
--    every other write on these tables.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('b9222222-2222-2222-2222-222222222222');

update public.sites
   set region_id = (select rli.id from public.reference_list_items rli
                       join public.reference_lists rl on rl.id = rli.reference_list_id
                       where rl.organization_id = 'b9000000-0000-0000-0000-00000000000a'
                         and rl.list_key = 'region' and rli.value = 'regio_noord')
 where id = 'b9700000-0000-0000-0000-00000000000a';

update public.memberships
   set region_id = null
 where user_id = 'b9333333-3333-3333-3333-333333333333'
   and organization_id = 'b9000000-0000-0000-0000-00000000000a';

select pg_temp.act_as('b9111111-1111-1111-1111-111111111111');

select is(
  (select rli.value from public.sites s
     join public.reference_list_items rli on rli.id = s.region_id
     where s.id = 'b9700000-0000-0000-0000-00000000000a'),
  'regio_midden',
  'planner_a''s UPDATE on Site A''s region_id was silently excluded by RLS (sites_update_owner); still Regio Midden from test 6/7'
); -- 14

select is(
  (select rli.value from public.memberships m
     join public.reference_list_items rli on rli.id = m.region_id
     where m.user_id = 'b9333333-3333-3333-3333-333333333333'
       and m.organization_id = 'b9000000-0000-0000-0000-00000000000a'),
  'regio_zuid',
  'planner_a''s UPDATE on engineer_a''s membership region_id was silently excluded by RLS (memberships_update_owner); still Regio Zuid from test 11/12'
); -- 15

-- ---------------------------------------------------------------------------
-- 4. Tenant isolation: owner_b (org_b) cannot see or write org_a's
--    sites/memberships region_id at all.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('b9444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from public.sites where id = 'b9700000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT Site A (different org); its region_id is unreachable, not just hidden'
); -- 16

update public.sites set region_id = null where id = 'b9700000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.memberships
     where user_id = 'b9333333-3333-3333-3333-333333333333'
       and organization_id = 'b9000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT engineer_a''s membership row (different org); its region_id is unreachable, not just hidden'
); -- 17

update public.memberships
   set region_id = null
 where user_id = 'b9333333-3333-3333-3333-333333333333'
   and organization_id = 'b9000000-0000-0000-0000-00000000000a';

select pg_temp.act_as('b9111111-1111-1111-1111-111111111111');

select is(
  (select rli.value from public.sites s
     join public.reference_list_items rli on rli.id = s.region_id
     where s.id = 'b9700000-0000-0000-0000-00000000000a'),
  'regio_midden',
  'owner_b''s cross-org UPDATE attempt on Site A''s region_id was silently excluded by RLS; still Regio Midden from owner_a''s perspective'
); -- 18

select is(
  (select rli.value from public.memberships m
     join public.reference_list_items rli on rli.id = m.region_id
     where m.user_id = 'b9333333-3333-3333-3333-333333333333'
       and m.organization_id = 'b9000000-0000-0000-0000-00000000000a'),
  'regio_zuid',
  'owner_b''s cross-org UPDATE attempt on engineer_a''s membership region_id was silently excluded by RLS; still Regio Zuid from owner_a''s perspective'
); -- 19

select * from finish();
rollback;
