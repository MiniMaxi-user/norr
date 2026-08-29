-- pgTAP RLS tests for work_orders (issue #13,
-- 20260823120000_work_orders_core.sql), extended with
-- work_orders.source_activity_id coverage (issue #87,
-- 20260829090000_work_orders_source_activity_id.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/contacts_dependent_reference_lists_rls.test.sql:
-- switch to the `authenticated` role and set `request.jwt.claims` to
-- simulate auth.uid() for a given fixture user. All auth.users rows here are
-- test fixtures, rolled back at the end of the transaction.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error — the row is silently excluded (0 rows changed). Only
-- INSERT/UPDATE `WITH CHECK` violations (and column-level privilege
-- revokes) raise error 42501.
--
-- This is the first table where the RBAC matrix's Planner/Engineer split
-- (lib/rbac/permissions.ts's `planning` entry) is enforced in RLS itself —
-- see current_member_role() and the work_orders_* policies in the migration.
-- Coverage: tenant isolation, engineer sees/updates only their own assigned
-- work order (not others'), engineer cannot create/delete, planner has full
-- CRUD, finance/administratie are read-only (all rows), and the
-- site/asset-must-belong-to-client(-and-site) cross-field checks.

begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with one of each relevant role, org_b for tenant
-- isolation. Two clients in org_a (client_a, client_a2) with their own
-- sites/assets, to exercise the site/asset-must-belong-to-client(-and-site)
-- cross-field checks.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('c2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('c2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('c2333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('c2444444-4444-4444-4444-444444444444', 'engineer-a2@test.local'),
  ('c2555555-5555-5555-5555-555555555555', 'finance-a@test.local'),
  ('c2666666-6666-6666-6666-666666666666', 'administratie-a@test.local'),
  ('c2777777-7777-7777-7777-777777777777', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create table pg_temp.captured_ids (key text primary key, val uuid not null);

select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('c1000000-0000-0000-0000-00000000000a', 'Org A', 'c2111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role) values
  ('c2111111-1111-1111-1111-111111111111', 'c1000000-0000-0000-0000-00000000000a', 'owner'),
  ('c2222222-2222-2222-2222-222222222222', 'c1000000-0000-0000-0000-00000000000a', 'planner'),
  ('c2333333-3333-3333-3333-333333333333', 'c1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('c2444444-4444-4444-4444-444444444444', 'c1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('c2555555-5555-5555-5555-555555555555', 'c1000000-0000-0000-0000-00000000000a', 'finance'),
  ('c2666666-6666-6666-6666-666666666666', 'c1000000-0000-0000-0000-00000000000a', 'administratie');

insert into public.clients (id, organization_id, name) values
  ('c3000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-00000000000a', 'Client A'),
  ('c3000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-00000000000a', 'Client A2');

insert into public.sites (id, client_id) values
  ('c4000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-00000000000a'),
  ('c4000000-0000-0000-0000-00000000000b', 'c3000000-0000-0000-0000-00000000000b'),
  ('c4000000-0000-0000-0000-00000000000c', 'c3000000-0000-0000-0000-00000000000a');

insert into public.assets (id, site_id, name, type_id, serial_number)
select 'c5000000-0000-0000-0000-00000000000a', 'c4000000-0000-0000-0000-00000000000a', 'Asset A', rli.id, 'SN-A'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'c1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into public.assets (id, site_id, name, type_id, serial_number)
select 'c5000000-0000-0000-0000-00000000000b', 'c4000000-0000-0000-0000-00000000000b', 'Asset A2', rli.id, 'SN-A2'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'c1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'electrical';

insert into public.assets (id, site_id, name, type_id, serial_number)
select 'c5000000-0000-0000-0000-00000000000c', 'c4000000-0000-0000-0000-00000000000c', 'Asset A3', rli.id, 'SN-A3'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'c1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'plumbing';

select pg_temp.act_as('c2777777-7777-7777-7777-777777777777');

insert into public.organizations (id, name, created_by)
values ('c1000000-0000-0000-0000-00000000000b', 'Org B', 'c2777777-7777-7777-7777-777777777777');

insert into public.memberships (user_id, organization_id, role)
values ('c2777777-7777-7777-7777-777777777777', 'c1000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name)
values ('c3000000-0000-0000-0000-00000000000c', 'c1000000-0000-0000-0000-00000000000b', 'Client B');

-- Capture org_b's seeded work_order_status "new" item id, needed later (while
-- acting as owner_a) for the cross-org status_id hostile-insert test.
insert into pg_temp.captured_ids (key, val)
select 'org_b_work_order_status_new_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'c1000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'work_order_status' and rli.value = 'new';

-- ---------------------------------------------------------------------------
-- 1. owner: insert, derived columns, defaults, and every cross-field/
--    reference-list validation this migration adds.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.work_orders (id, client_id, site_id, asset_id, assigned_to, title)
     values ('c6000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-00000000000a',
       'c4000000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-00000000000a',
       'c2333333-3333-3333-3333-333333333333', 'Fix AC') $$,
  'owner_a can insert a work order under client A (org_a), assigned to engineer_a'
); -- 1

select is(
  (select organization_id from public.work_orders where id = 'c6000000-0000-0000-0000-00000000000a'),
  'c1000000-0000-0000-0000-00000000000a'::uuid,
  'work_orders.organization_id was auto-derived from clients.organization_id via client_id'
); -- 2

select is(
  (select created_by from public.work_orders where id = 'c6000000-0000-0000-0000-00000000000a'),
  'c2111111-1111-1111-1111-111111111111'::uuid,
  'work_orders.created_by was auto-stamped to the inserting user (trigger), not client-supplied'
); -- 3

select is(
  (select rli.value from public.work_orders wo
     join public.reference_list_items rli on rli.id = wo.status_id
     where wo.id = 'c6000000-0000-0000-0000-00000000000a'),
  'new',
  'work_orders.status_id defaulted to the org''s default work_order_status item ("new") when omitted on insert'
); -- 4

select throws_ok(
  $$ insert into public.work_orders (client_id, title, organization_id)
     values ('c3000000-0000-0000-0000-00000000000a', 'Spoofed', 'c1000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_a cannot set work_orders.organization_id directly on insert (column-level grant withheld)'
); -- 5

select throws_ok(
  $$ insert into public.work_orders (client_id, title, created_by)
     values ('c3000000-0000-0000-0000-00000000000a', 'Spoofed', '00000000-0000-0000-0000-000000000000') $$,
  '42501',
  null,
  'owner_a cannot set work_orders.created_by directly on insert (column-level grant withheld)'
); -- 6

select throws_ok(
  $$ insert into public.work_orders (client_id, site_id, title)
     values ('c3000000-0000-0000-0000-00000000000a', 'c4000000-0000-0000-0000-00000000000b', 'Wrong Site Client') $$,
  '23514',
  null,
  'work_orders.site_id from a different client (Site A2 under Client A2) is rejected when client_id=Client A'
); -- 7

select throws_ok(
  $$ insert into public.work_orders (client_id, asset_id, title)
     values ('c3000000-0000-0000-0000-00000000000a', 'c5000000-0000-0000-0000-00000000000b', 'Wrong Asset Client') $$,
  '23514',
  null,
  'work_orders.asset_id from a different client (Asset A2 under Client A2) is rejected when client_id=Client A'
); -- 8

select throws_ok(
  $$ insert into public.work_orders (client_id, site_id, asset_id, title)
     values ('c3000000-0000-0000-0000-00000000000a', 'c4000000-0000-0000-0000-00000000000a',
       'c5000000-0000-0000-0000-00000000000c', 'Wrong Asset Site') $$,
  '23514',
  null,
  'work_orders.asset_id from a different site (Asset A3 under Site A3) is rejected when site_id=Site A, even though both are under Client A'
); -- 9

select throws_ok(
  $$ insert into public.work_orders (client_id, assigned_to, title)
     values ('c3000000-0000-0000-0000-00000000000a', 'c2777777-7777-7777-7777-777777777777', 'Cross Org Assignee') $$,
  '23514',
  null,
  'work_orders.assigned_to must be a member of the work order''s own organization (owner_b is not a member of org_a)'
); -- 10

select throws_ok(
  $$ insert into public.work_orders (client_id, title, status_id)
     select 'c3000000-0000-0000-0000-00000000000a', 'Wrong Status List',
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'c1000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'asset_status' and rli.is_default) $$,
  '23514',
  null,
  'work_orders.status_id must be from the work_order_status list, not asset_status (validate_work_order_reference_items)'
); -- 11

select throws_ok(
  $$ insert into public.work_orders (client_id, title, priority_id)
     select 'c3000000-0000-0000-0000-00000000000a', 'Wrong Priority List',
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'c1000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'asset_type' and rli.value = 'hvac') $$,
  '23514',
  null,
  'work_orders.priority_id must be from the work_order_priority list, not asset_type (validate_work_order_reference_items)'
); -- 12

select throws_ok(
  $$ insert into public.work_orders (client_id, title, status_id)
     select 'c3000000-0000-0000-0000-00000000000a', 'Cross Org Status', val
     from pg_temp.captured_ids where key = 'org_b_work_order_status_new_id' $$,
  '23514',
  null,
  'work_orders.status_id from a different organization''s work_order_status list (org_b''s) is rejected'
); -- 13

-- ---------------------------------------------------------------------------
-- 2. planner: full CRUD, matching the RBAC matrix's planning row.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.work_orders (id, client_id, title, assigned_to)
     values ('c6000000-0000-0000-0000-00000000000b', 'c3000000-0000-0000-0000-00000000000a', 'Replace Filter',
       'c2444444-4444-4444-4444-444444444444') $$,
  'planner_a can insert a work order (assigned to engineer_a2)'
); -- 14

select lives_ok(
  $$ update public.work_orders set title = 'Fix AC Unit' where id = 'c6000000-0000-0000-0000-00000000000a' $$,
  'planner_a can update any work order in org_a, not just their own'
); -- 15

select is(
  (select title from public.work_orders where id = 'c6000000-0000-0000-0000-00000000000a'),
  'Fix AC Unit',
  'planner_a''s update took effect'
); -- 16

select lives_ok(
  $$ insert into public.work_orders (id, client_id, title)
     values ('c6000000-0000-0000-0000-00000000000c', 'c3000000-0000-0000-0000-00000000000a', 'Disposable') $$,
  'planner_a can insert a disposable work order for the delete test below'
); -- 17

select lives_ok(
  $$ delete from public.work_orders where id = 'c6000000-0000-0000-0000-00000000000c' $$,
  'planner_a can delete a work order in org_a'
); -- 18

select is(
  (select count(*)::int from public.work_orders where id = 'c6000000-0000-0000-0000-00000000000c'),
  0,
  'the disposable work order is actually gone after planner_a''s delete'
); -- 19

select is(
  (select count(*)::int from public.work_orders where organization_id = 'c1000000-0000-0000-0000-00000000000a'),
  2,
  'planner_a (unlike an engineer) sees every work order in org_a, not just ones assigned to them'
); -- 20

-- ---------------------------------------------------------------------------
-- 3. engineer: SELECT/UPDATE scoped to assigned_to = auth.uid() only; no
--    create, no delete.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.work_orders where organization_id = 'c1000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a only sees the one work order assigned to them (not the one assigned to engineer_a2)'
); -- 21

select is(
  (select id from public.work_orders where organization_id = 'c1000000-0000-0000-0000-00000000000a'),
  'c6000000-0000-0000-0000-00000000000a'::uuid,
  'the work order engineer_a can see is specifically the one assigned to them'
); -- 22

select throws_ok(
  $$ insert into public.work_orders (client_id, title, assigned_to)
     values ('c3000000-0000-0000-0000-00000000000a', 'Engineer Self Assign', 'c2333333-3333-3333-3333-333333333333') $$,
  '42501',
  null,
  'engineer_a cannot INSERT a work order, even assigned to themselves (RBAC matrix: engineer has no create action on planning)'
); -- 23

select lives_ok(
  $$ update public.work_orders set notes = 'Replaced capacitor' where id = 'c6000000-0000-0000-0000-00000000000a' $$,
  'engineer_a can update their own assigned work order'
); -- 24

select is(
  (select notes from public.work_orders where id = 'c6000000-0000-0000-0000-00000000000a'),
  'Replaced capacitor',
  'engineer_a''s update to their own work order took effect'
); -- 25

update public.work_orders set title = 'Hijacked' where id = 'c6000000-0000-0000-0000-00000000000b';

select is(
  (select title from public.work_orders where id = 'c6000000-0000-0000-0000-00000000000b'),
  'Replace Filter',
  'engineer_a''s UPDATE on engineer_a2''s work order is silently excluded by RLS (USING); title unchanged'
); -- 26

delete from public.work_orders where id = 'c6000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.work_orders where id = 'c6000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a''s DELETE attempt on their own assigned work order is silently excluded by RLS (engineer has no delete action); row still exists'
); -- 27

select throws_ok(
  $$ update public.work_orders set assigned_to = 'c2444444-4444-4444-4444-444444444444'
     where id = 'c6000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'engineer_a cannot reassign their own work order away from themselves (assigned_to := engineer_a2); USING passes (currently assigned to them) but WITH CHECK fails on the new row since assigned_to <> auth.uid() and they are not owner/planner'
); -- 28

-- ---------------------------------------------------------------------------
-- 4. finance / administratie: read-only, all rows (not scoped like engineer).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2555555-5555-5555-5555-555555555555');

select is(
  (select count(*)::int from public.work_orders where organization_id = 'c1000000-0000-0000-0000-00000000000a'),
  2,
  'finance_a can SELECT every work order in org_a (read-only, all rows, not assignment-scoped)'
); -- 29

select throws_ok(
  $$ insert into public.work_orders (client_id, title)
     values ('c3000000-0000-0000-0000-00000000000a', 'Finance Attempt') $$,
  '42501',
  null,
  'finance_a cannot INSERT a work order (read-only)'
); -- 30

update public.work_orders set title = 'Finance Hijack' where id = 'c6000000-0000-0000-0000-00000000000a';

select is(
  (select title from public.work_orders where id = 'c6000000-0000-0000-0000-00000000000a'),
  'Fix AC Unit',
  'finance_a''s UPDATE is silently excluded by RLS (read-only); title unchanged'
); -- 31

select pg_temp.act_as('c2666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.work_orders where organization_id = 'c1000000-0000-0000-0000-00000000000a'),
  2,
  'administratie_a can SELECT every work order in org_a (read-only, all rows)'
); -- 32

select throws_ok(
  $$ insert into public.work_orders (client_id, title)
     values ('c3000000-0000-0000-0000-00000000000a', 'Administratie Attempt') $$,
  '42501',
  null,
  'administratie_a cannot INSERT a work order (read-only)'
); -- 33

-- ---------------------------------------------------------------------------
-- 5. Tenant isolation: owner_b (org_b) cannot see or write org_a's work orders.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2777777-7777-7777-7777-777777777777');

select is(
  (select count(*)::int from public.work_orders where organization_id = 'c1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s work orders'
); -- 34

select throws_ok(
  $$ insert into public.work_orders (client_id, title)
     values ('c3000000-0000-0000-0000-00000000000a', 'Hostile Cross Org Insert') $$,
  '42501',
  null,
  'owner_b cannot INSERT a work order under org_a''s client (not a member of org_a at all, so current_member_role is null)'
); -- 35

-- ---------------------------------------------------------------------------
-- 6. work_orders.source_activity_id: must belong to the same client_id as
--    the work order (validate_work_order_relations, extended by
--    20260829090000_work_orders_source_activity_id.sql, issue #87). Mirrors
--    supabase/tests/database/quotes_rls.test.sql's source_quote_id coverage
--    (section 9 there) exactly, one column swapped for the other.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('c2111111-1111-1111-1111-111111111111');

insert into public.activities (id, client_id, type_id, description, action_holder_id)
select 'c7000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-00000000000a',
  rli.id, 'Klant meldt storing aan airco', 'c2111111-1111-1111-1111-111111111111'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'c1000000-0000-0000-0000-00000000000a'
  and rl.list_key = 'activity_type' and rli.value = 'afspraak';

insert into public.activities (id, client_id, type_id, description, action_holder_id)
select 'c7000000-0000-0000-0000-00000000000b', 'c3000000-0000-0000-0000-00000000000b',
  rli.id, 'Klant A2 meldt storing', 'c2111111-1111-1111-1111-111111111111'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'c1000000-0000-0000-0000-00000000000a'
  and rl.list_key = 'activity_type' and rli.value = 'afspraak';

select lives_ok(
  $$ insert into public.work_orders (client_id, title, source_activity_id)
     values ('c3000000-0000-0000-0000-00000000000a', 'Werkbon Vanuit Melding', 'c7000000-0000-0000-0000-00000000000a') $$,
  'owner_a can insert a work order under client A with source_activity_id set to the Client A activity (same client)'
); -- 36

select throws_ok(
  $$ insert into public.work_orders (client_id, title, source_activity_id)
     values ('c3000000-0000-0000-0000-00000000000a', 'Wrong Activity Client', 'c7000000-0000-0000-0000-00000000000b') $$,
  '23514',
  null,
  'work_orders.source_activity_id from a different client (the Client A2 activity) is rejected when client_id=Client A'
); -- 37

select throws_ok(
  $$ insert into public.work_orders (client_id, title, source_activity_id)
     values ('c3000000-0000-0000-0000-00000000000a', 'Nonexistent Activity', '00000000-0000-0000-0000-000000000000') $$,
  '23503',
  null,
  'work_orders.source_activity_id pointing at a nonexistent activity is rejected (dangling reference)'
); -- 38

select * from finish();
rollback;
