-- pgTAP RLS tests for checklist_templates / checklist_template_items /
-- work_order_checklists / work_order_checklist_items
-- (issue #14, 20260823210000_checklists_core.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/reference_lists_rls.test.sql (owner-only write /
-- any-member read, section 1 below) and
-- supabase/tests/database/time_entries_rls.test.sql (Work Order sub-resource
-- with denormalized organization_id/assigned_to, section 2 below): switch to
-- the `authenticated` role and set `request.jwt.claims` to simulate
-- auth.uid() for a given fixture user. All auth.users rows here are test
-- fixtures, rolled back at the end of the transaction.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error — the row is silently excluded (0 rows changed). Only
-- INSERT/UPDATE `WITH CHECK` violations (and column-level privilege
-- revokes) raise error 42501.
--
-- Coverage: tenant isolation on all 4 tables; checklist_templates/
-- checklist_template_items owner-only write + any-member read, INCLUDING
-- DELETE (owner-succeeds / non-owner-silently-excluded, both tables); the
-- template-item-snapshot-copy behavior (functional, not just RLS) AND the
-- "does not retroactively rewrite an already-copied instance" functional
-- half of that same claim; work_order_checklists/work_order_checklist_items
-- per-role shape — BOTH owner and planner tested directly on UPDATE and
-- DELETE; engineer read/update scoped to assigned_to (both own-row success
-- and other-row rejection); engineer has no create/delete on either instance
-- table; the one-checklist-per-work-order unique constraint; checked_by/
-- checked_at auto-stamp/clear; the assigned_to denormalization actually
-- re-syncs when work_orders.assigned_to changes, AND that the re-sync
-- actually flips RLS-visible access (SELECT + UPDATE) for both the
-- old and new assignee, at both header and item level.

begin;
create extension if not exists pgtap with schema extensions;

select plan(78);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with one of each relevant role (two engineers, to prove
-- engineer-vs-engineer scoping), org_b for tenant isolation.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e1111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('e1222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('e1333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('e1444444-4444-4444-4444-444444444444', 'engineer-a2@test.local'),
  ('e1555555-5555-5555-5555-555555555555', 'finance-a@test.local'),
  ('e1666666-6666-6666-6666-666666666666', 'administratie-a@test.local'),
  ('e1777777-7777-7777-7777-777777777777', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('e1111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('e2000000-0000-0000-0000-00000000000a', 'Org A', 'e1111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role) values
  ('e1111111-1111-1111-1111-111111111111', 'e2000000-0000-0000-0000-00000000000a', 'owner'),
  ('e1222222-2222-2222-2222-222222222222', 'e2000000-0000-0000-0000-00000000000a', 'planner'),
  ('e1333333-3333-3333-3333-333333333333', 'e2000000-0000-0000-0000-00000000000a', 'engineer'),
  ('e1444444-4444-4444-4444-444444444444', 'e2000000-0000-0000-0000-00000000000a', 'engineer'),
  ('e1555555-5555-5555-5555-555555555555', 'e2000000-0000-0000-0000-00000000000a', 'finance'),
  ('e1666666-6666-6666-6666-666666666666', 'e2000000-0000-0000-0000-00000000000a', 'administratie');

insert into public.clients (id, organization_id, name) values
  ('e3000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-00000000000a', 'Client A');

insert into public.work_orders (id, client_id, title, assigned_to) values
  ('e4000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a', 'WO A1', 'e1333333-3333-3333-3333-333333333333'),
  ('e4000000-0000-0000-0000-00000000000b', 'e3000000-0000-0000-0000-00000000000a', 'WO A2', 'e1444444-4444-4444-4444-444444444444'),
  ('e4000000-0000-0000-0000-00000000000c', 'e3000000-0000-0000-0000-00000000000a', 'WO A3 (delete fixtures)', 'e1333333-3333-3333-3333-333333333333');

select pg_temp.act_as('e1777777-7777-7777-7777-777777777777');

insert into public.organizations (id, name, created_by)
values ('e2000000-0000-0000-0000-00000000000b', 'Org B', 'e1777777-7777-7777-7777-777777777777');

insert into public.memberships (user_id, organization_id, role)
values ('e1777777-7777-7777-7777-777777777777', 'e2000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name)
values ('e3000000-0000-0000-0000-00000000000c', 'e2000000-0000-0000-0000-00000000000b', 'Client B');

insert into public.work_orders (id, client_id, title)
values ('e4000000-0000-0000-0000-00000000000c', 'e3000000-0000-0000-0000-00000000000c', 'WO B');

-- ---------------------------------------------------------------------------
-- 1. checklist_templates / checklist_template_items: owner-only write,
--    any-member read (mirrors reference_lists_rls.test.sql style).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.checklist_templates (id, organization_id, name)
     values ('e5000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-00000000000a', 'HVAC Inspection') $$,
  'owner_a can insert a checklist_templates row'
); -- 1

select is(
  (select created_by from public.checklist_templates where id = 'e5000000-0000-0000-0000-00000000000a'),
  'e1111111-1111-1111-1111-111111111111'::uuid,
  'checklist_templates.created_by was auto-stamped to the inserting user'
); -- 2

select pg_temp.act_as('e1222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.checklist_templates (organization_id, name)
     values ('e2000000-0000-0000-0000-00000000000a', 'Planner Template') $$,
  '42501',
  null,
  'planner_a cannot insert a checklist_templates row (owner-only write)'
); -- 3

select is(
  (select count(*)::int from public.checklist_templates where organization_id = 'e2000000-0000-0000-0000-00000000000a'),
  1,
  'planner_a (non-owner) CAN select org_a''s checklist_templates (any-member read)'
); -- 4

select pg_temp.act_as('e1333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ insert into public.checklist_templates (organization_id, name)
     values ('e2000000-0000-0000-0000-00000000000a', 'Engineer Template') $$,
  '42501',
  null,
  'engineer_a cannot insert a checklist_templates row (owner-only write)'
); -- 5

select pg_temp.act_as('e1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.checklist_template_items (id, checklist_template_id, label, is_required, sort_order)
     values
       ('e6000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-00000000000a', 'Check refrigerant level', true, 1),
       ('e6000000-0000-0000-0000-00000000000b', 'e5000000-0000-0000-0000-00000000000a', 'Inspect ductwork', false, 2) $$,
  'owner_a can insert checklist_template_items rows'
); -- 6

select is(
  (select organization_id from public.checklist_template_items where id = 'e6000000-0000-0000-0000-00000000000a'),
  'e2000000-0000-0000-0000-00000000000a'::uuid,
  'checklist_template_items.organization_id was auto-derived from checklist_templates via checklist_template_id'
); -- 7

select pg_temp.act_as('e1222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.checklist_template_items (checklist_template_id, label)
     values ('e5000000-0000-0000-0000-00000000000a', 'Planner Item') $$,
  '42501',
  null,
  'planner_a cannot insert a checklist_template_items row (owner-only write)'
); -- 8

update public.checklist_templates set name = 'Planner Hijack' where id = 'e5000000-0000-0000-0000-00000000000a';

select is(
  (select name from public.checklist_templates where id = 'e5000000-0000-0000-0000-00000000000a'),
  'HVAC Inspection',
  'planner_a''s UPDATE on checklist_templates is silently excluded by RLS (owner-only write); name unchanged'
); -- 9

select pg_temp.act_as('e1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ update public.checklist_templates set name = 'HVAC Inspection (v2)' where id = 'e5000000-0000-0000-0000-00000000000a' $$,
  'owner_a can update its own org''s checklist_templates row'
); -- 10

select pg_temp.act_as('e1777777-7777-7777-7777-777777777777');

select is(
  (select count(*)::int from public.checklist_templates where organization_id = 'e2000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s checklist_templates (tenant isolation)'
); -- 11

select is(
  (select count(*)::int from public.checklist_template_items where organization_id = 'e2000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s checklist_template_items (tenant isolation)'
); -- 12

select throws_ok(
  $$ insert into public.checklist_templates (organization_id, name)
     values ('e2000000-0000-0000-0000-00000000000a', 'Hostile Template') $$,
  '42501',
  null,
  'owner_b cannot insert a checklist_templates row into org_a (not org_a''s owner)'
); -- 13

-- ---------------------------------------------------------------------------
-- 2. work_order_checklists / work_order_checklist_items: owner/planner CRUD,
--    engineer read/update-own-only no create/delete, finance/administratie
--    read-only. Plus: unique-per-work-order, snapshot-copy, assigned_to sync,
--    checked_by/checked_at stamping.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.work_order_checklists (id, work_order_id, checklist_template_id)
     values ('e7000000-0000-0000-0000-00000000000a', 'e4000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-00000000000a') $$,
  'owner_a can insert a work_order_checklists row for WO A1, instantiating template_a1'
); -- 14

select is(
  (select organization_id from public.work_order_checklists where id = 'e7000000-0000-0000-0000-00000000000a'),
  'e2000000-0000-0000-0000-00000000000a'::uuid,
  'work_order_checklists.organization_id was auto-derived from work_orders via work_order_id'
); -- 15

select is(
  (select assigned_to from public.work_order_checklists where id = 'e7000000-0000-0000-0000-00000000000a'),
  'e1333333-3333-3333-3333-333333333333'::uuid,
  'work_order_checklists.assigned_to was auto-derived from work_orders.assigned_to (WO A1 -> engineer_a)'
); -- 16

-- --- functional test: template-item-snapshot-copy actually copied items ---
select is(
  (select count(*)::int from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a'),
  2,
  'inserting work_order_checklists with a checklist_template_id auto-copied both of template_a1''s items'
); -- 17

select is(
  (select array_agg(label order by sort_order) from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a'),
  array['Check refrigerant level', 'Inspect ductwork'],
  'the copied items'' labels match the template items'' labels, in sort_order'
); -- 18

select is(
  (select is_required from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Check refrigerant level'),
  true,
  'the copied item''s is_required was copied from the template item (true)'
); -- 19

select is(
  (select template_item_id from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Check refrigerant level'),
  'e6000000-0000-0000-0000-00000000000a'::uuid,
  'the copied item''s template_item_id correctly points back at the source checklist_template_items row'
); -- 20

select is(
  (select organization_id from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' limit 1),
  'e2000000-0000-0000-0000-00000000000a'::uuid,
  'the copied items'' organization_id was auto-derived from work_order_checklists'
); -- 21

select is(
  (select assigned_to from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' limit 1),
  'e1333333-3333-3333-3333-333333333333'::uuid,
  'the copied items'' assigned_to was auto-derived from work_order_checklists (engineer_a)'
); -- 22

-- --- snapshot-not-live-join: editing a template item after it has already
--     been copied into an instance does NOT retroactively rewrite the
--     already-created work_order_checklist_items row (design notes 1 and 4:
--     copy-by-value at creation time, not a live join). Still acting as
--     owner_a from the block above.
update public.checklist_template_items set label = 'Changed label' where id = 'e6000000-0000-0000-0000-00000000000a';

select is(
  (select label from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and template_item_id = 'e6000000-0000-0000-0000-00000000000a'),
  'Check refrigerant level',
  'editing checklist_template_items.label after instance-creation does NOT retroactively rewrite the already-copied work_order_checklist_items row (copy-by-value snapshot, not a live join)'
); -- 23

-- --- unique-one-checklist-per-work-order constraint ---
select throws_ok(
  $$ insert into public.work_order_checklists (work_order_id, checklist_template_id)
     values ('e4000000-0000-0000-0000-00000000000a', 'e5000000-0000-0000-0000-00000000000a') $$,
  '23505',
  null,
  'a second work_order_checklists row for the same work_order_id is rejected (unique constraint)'
); -- 24

-- --- cross-org rejection ---
select throws_ok(
  $$ insert into public.work_order_checklists (work_order_id, checklist_template_id)
     values ('e4000000-0000-0000-0000-00000000000c', 'e5000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_a cannot insert a work_order_checklists row for org_b''s WO B (organization_id derives to org_b, and owner_a has no membership/role there — current_member_role is null, failing the INSERT WITH CHECK)'
); -- 25

-- --- planner: ad-hoc checklist (no template) + directly-inserted item ---
select pg_temp.act_as('e1222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.work_order_checklists (id, work_order_id, checklist_template_id)
     values ('e7000000-0000-0000-0000-00000000000b', 'e4000000-0000-0000-0000-00000000000b', null) $$,
  'planner_a can insert an ad-hoc work_order_checklists row (checklist_template_id = null) for WO A2'
); -- 26

select is(
  (select count(*)::int from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000b'),
  0,
  'an ad-hoc checklist (no template) has zero auto-copied items'
); -- 27

select lives_ok(
  $$ insert into public.work_order_checklist_items (id, work_order_checklist_id, label, is_required, sort_order)
     values ('e8000000-0000-0000-0000-00000000000a', 'e7000000-0000-0000-0000-00000000000b', 'Confirm generator fuel level', true, 1) $$,
  'planner_a can directly insert an ad-hoc item (no template_item_id) into the ad-hoc checklist'
); -- 28

select is(
  (select template_item_id from public.work_order_checklist_items where id = 'e8000000-0000-0000-0000-00000000000a'),
  null,
  'the ad-hoc item has no template_item_id (never client-set, and none was copied)'
); -- 29

select is(
  (select assigned_to from public.work_order_checklist_items where id = 'e8000000-0000-0000-0000-00000000000a'),
  'e1444444-4444-4444-4444-444444444444'::uuid,
  'the ad-hoc item''s assigned_to was auto-derived from work_order_checklists (engineer_a2, WO A2''s assignee)'
); -- 30

-- --- engineer: no create on either instance table ---
select pg_temp.act_as('e1333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ insert into public.work_order_checklists (work_order_id, checklist_template_id)
     values ('e4000000-0000-0000-0000-00000000000c', 'e5000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'engineer_a cannot insert a work_order_checklists row (no create action, matches work_orders'' own create boundary)'
); -- 31

select throws_ok(
  $$ insert into public.work_order_checklist_items (work_order_checklist_id, label)
     values ('e7000000-0000-0000-0000-00000000000a', 'Engineer Ad-hoc Item') $$,
  '42501',
  null,
  'engineer_a cannot insert a work_order_checklist_items row, even on their own assigned checklist (no create)'
); -- 32

-- --- engineer: SELECT/UPDATE scoped to assigned_to = auth.uid() ---
select is(
  (select count(*)::int from public.work_order_checklists where organization_id = 'e2000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a only sees the one work_order_checklists row assigned to them (not engineer_a2''s WO A2 checklist)'
); -- 33

select is(
  (select id from public.work_order_checklists where organization_id = 'e2000000-0000-0000-0000-00000000000a'),
  'e7000000-0000-0000-0000-00000000000a'::uuid,
  'the work_order_checklists row engineer_a can see is specifically their own (WO A1''s)'
); -- 34

select is(
  (select count(*)::int from public.work_order_checklist_items where organization_id = 'e2000000-0000-0000-0000-00000000000a'),
  2,
  'engineer_a only sees the 2 items on their own checklist (not engineer_a2''s ad-hoc item)'
); -- 35

select lives_ok(
  $$ update public.work_order_checklist_items set is_checked = true, notes = 'Refrigerant OK'
     where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Check refrigerant level' $$,
  'engineer_a can update (check off + annotate) their own assigned checklist''s item'
); -- 36

select is(
  (select is_checked from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Check refrigerant level'),
  true,
  'the item is now checked'
); -- 37

select is(
  (select checked_by from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Check refrigerant level'),
  'e1333333-3333-3333-3333-333333333333'::uuid,
  'checked_by was auto-stamped to engineer_a (auth.uid()), not client-suppliable'
); -- 38

select ok(
  (select checked_at from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Check refrigerant level') is not null,
  'checked_at was auto-stamped to now()'
); -- 39

select lives_ok(
  $$ update public.work_order_checklist_items set is_checked = false
     where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Check refrigerant level' $$,
  'engineer_a can uncheck their own item again'
); -- 40

select is(
  (select checked_by from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Check refrigerant level'),
  null,
  'unchecking clears checked_by'
); -- 41

select is(
  (select checked_at from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Check refrigerant level'),
  null,
  'unchecking clears checked_at'
); -- 42

update public.work_order_checklist_items set notes = 'Hijacked' where id = 'e8000000-0000-0000-0000-00000000000a';

select is(
  (select notes from public.work_order_checklist_items where id = 'e8000000-0000-0000-0000-00000000000a'),
  null,
  'engineer_a''s UPDATE on engineer_a2''s item (different assigned_to) is silently excluded by RLS; notes unchanged'
); -- 43

delete from public.work_order_checklist_items where id = 'e8000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.work_order_checklist_items where id = 'e8000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a''s DELETE attempt is silently excluded by RLS (engineer has no delete action); row still exists'
); -- 44

delete from public.work_order_checklists where id = 'e7000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.work_order_checklists where id = 'e7000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a''s DELETE attempt on their own work_order_checklists row is silently excluded by RLS (no delete action); row still exists'
); -- 45

-- --- work_order_checklists UPDATE: policy exists but no column is
--     grant-exposed today (design note 3) — unreachable for EVERY role,
--     tested directly for both owner and planner.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e1111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ update public.work_order_checklists set checklist_template_id = null where id = 'e7000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'owner_a cannot UPDATE work_order_checklists.checklist_template_id (no column grant at all — immutable after creation by design, see design note 3)'
); -- 46

select pg_temp.act_as('e1222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ update public.work_order_checklists set checklist_template_id = null where id = 'e7000000-0000-0000-0000-00000000000b' $$,
  '42501',
  null,
  'planner_a likewise cannot UPDATE work_order_checklists.checklist_template_id (same table-wide grant restriction, not a role difference)'
); -- 47

-- --- owner AND planner: full CRUD on work_order_checklist_items, tested
--     directly on UPDATE and DELETE for BOTH roles (the flagged gap). ---
select pg_temp.act_as('e1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ update public.work_order_checklist_items set notes = 'Owner correction'
     where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Inspect ductwork' $$,
  'owner_a can update any work_order_checklist_items row in org_a, not just an assigned engineer''s'
); -- 48

select is(
  (select notes from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Inspect ductwork'),
  'Owner correction',
  'owner_a''s update took effect'
); -- 49

select lives_ok(
  $$ insert into public.work_order_checklists (id, work_order_id, checklist_template_id)
     values ('e7000000-0000-0000-0000-00000000000c', 'e4000000-0000-0000-0000-00000000000c', null) $$,
  'owner_a can insert a disposable work_order_checklists row (WO A3) for the delete tests below'
); -- 50

select lives_ok(
  $$ insert into public.work_order_checklist_items (id, work_order_checklist_id, label)
     values ('e8000000-0000-0000-0000-00000000000b', 'e7000000-0000-0000-0000-00000000000c', 'Disposable item (owner delete)') $$,
  'owner_a can insert a disposable item for the owner-delete test'
); -- 51

select lives_ok(
  $$ delete from public.work_order_checklist_items where id = 'e8000000-0000-0000-0000-00000000000b' $$,
  'owner_a can delete a work_order_checklist_items row directly'
); -- 52

select is(
  (select count(*)::int from public.work_order_checklist_items where id = 'e8000000-0000-0000-0000-00000000000b'),
  0,
  'the owner-deleted item is actually gone'
); -- 53

select lives_ok(
  $$ delete from public.work_order_checklists where id = 'e7000000-0000-0000-0000-00000000000c' $$,
  'owner_a can delete a work_order_checklists row directly'
); -- 54

select is(
  (select count(*)::int from public.work_order_checklists where id = 'e7000000-0000-0000-0000-00000000000c'),
  0,
  'the owner-deleted work_order_checklists row is actually gone'
); -- 55

select pg_temp.act_as('e1222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ update public.work_order_checklist_items set notes = 'Planner correction'
     where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000b' and label = 'Confirm generator fuel level' $$,
  'planner_a can update any work_order_checklist_items row in org_a, not just their own inserted one'
); -- 56

select is(
  (select notes from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000b' and label = 'Confirm generator fuel level'),
  'Planner correction',
  'planner_a''s update took effect'
); -- 57

select lives_ok(
  $$ delete from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000b' and label = 'Confirm generator fuel level' $$,
  'planner_a can delete a work_order_checklist_items row directly'
); -- 58

select lives_ok(
  $$ delete from public.work_order_checklists where id = 'e7000000-0000-0000-0000-00000000000b' $$,
  'planner_a can delete a work_order_checklists row directly (WO A2''s ad-hoc checklist)'
); -- 59

-- --- finance / administratie: read-only, all rows ---
select pg_temp.act_as('e1555555-5555-5555-5555-555555555555');

select is(
  (select count(*)::int from public.work_order_checklists where organization_id = 'e2000000-0000-0000-0000-00000000000a'),
  1,
  'finance_a can SELECT every remaining work_order_checklists row in org_a (read-only, all rows)'
); -- 60

select throws_ok(
  $$ insert into public.work_order_checklists (work_order_id, checklist_template_id)
     values ('e4000000-0000-0000-0000-00000000000b', null) $$,
  '42501',
  null,
  'finance_a cannot INSERT a work_order_checklists row (read-only)'
); -- 61

select pg_temp.act_as('e1666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.work_order_checklist_items where organization_id = 'e2000000-0000-0000-0000-00000000000a'),
  2,
  'administratie_a can SELECT every remaining work_order_checklist_items row in org_a (read-only, all rows)'
); -- 62

-- --- assigned_to denormalization actually re-syncs on reassignment ---
select pg_temp.act_as('e1111111-1111-1111-1111-111111111111');

update public.work_orders set assigned_to = 'e1444444-4444-4444-4444-444444444444' where id = 'e4000000-0000-0000-0000-00000000000a';

select is(
  (select assigned_to from public.work_order_checklists where id = 'e7000000-0000-0000-0000-00000000000a'),
  'e1444444-4444-4444-4444-444444444444'::uuid,
  'reassigning WO A1 to engineer_a2 re-synced work_order_checklists.assigned_to via work_orders_sync_checklist_assigned_to'
); -- 63

select is(
  (select assigned_to from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' limit 1),
  'e1444444-4444-4444-4444-444444444444'::uuid,
  'the same reassignment cascaded down to work_order_checklist_items.assigned_to too'
); -- 64

-- --- reassignment access-boundary: the sync_work_order_checklist_assigned_to
--     trigger's cascade must actually change RLS-VISIBLE access, at both
--     header and item level, for both the old and the new engineer — not
--     just flip a column value (which #63/#64 above already confirmed).
--     work_order_checklists_select_scoped / work_order_checklist_items_
--     select_scoped both gate engineer visibility on assigned_to = auth.uid(),
--     so after the reassignment above (WO A1 -> engineer_a2), engineer_a
--     (the OLD assignee) must lose access and engineer_a2 (the NEW assignee)
--     must gain it. ---
select pg_temp.act_as('e1333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.work_order_checklists where id = 'e7000000-0000-0000-0000-00000000000a'),
  0,
  'after reassignment away from engineer_a, engineer_a (the OLD assignee) no longer sees WO A1''s work_order_checklists row at all'
); -- 65

select is(
  (select count(*)::int from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a'),
  0,
  'after reassignment, engineer_a likewise no longer sees any of WO A1''s work_order_checklist_items rows'
); -- 66

-- NOTE: a USING-clause visibility failure on UPDATE does not raise an error
-- (see the "Note on RLS semantics" comment at the top of this file, and the
-- precedent at assertion #43 above for this exact table/policy) — it
-- silently matches/updates 0 rows. Verified against
-- work_order_checklist_items_update_scoped, which gates the engineer branch
-- on the identical assigned_to = auth.uid() condition as the SELECT policy
-- above, so this is a silent no-op here too, not a 42501 throw.
update public.work_order_checklist_items set notes = 'Hijacked after reassignment'
  where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Check refrigerant level';

select pg_temp.act_as('e1111111-1111-1111-1111-111111111111');

select is(
  (select notes from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Check refrigerant level'),
  'Refrigerant OK',
  'after reassignment, engineer_a''s (the OLD assignee''s) UPDATE attempt on that item is silently excluded by RLS (USING clause violation, matching the file''s documented UPDATE/DELETE semantics); notes unchanged'
); -- 67

select pg_temp.act_as('e1444444-4444-4444-4444-444444444444');

select ok(
  (select count(*)::int from public.work_order_checklists where id = 'e7000000-0000-0000-0000-00000000000a') > 0,
  'after reassignment, engineer_a2 (the NEW assignee) now sees WO A1''s work_order_checklists row'
); -- 68

select ok(
  (select count(*)::int from public.work_order_checklist_items where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a') > 0,
  'after reassignment, engineer_a2 now sees WO A1''s work_order_checklist_items rows too'
); -- 69

select lives_ok(
  $$ update public.work_order_checklist_items set notes = 'engineer_a2 checked in'
     where work_order_checklist_id = 'e7000000-0000-0000-0000-00000000000a' and label = 'Check refrigerant level' $$,
  'engineer_a2 (the NEW assignee) can now UPDATE a work_order_checklist_items row on WO A1''s checklist'
); -- 70

-- ---------------------------------------------------------------------------
-- 3. checklist_templates / checklist_template_items: DELETE coverage
--    (checklist_templates_delete_owner / checklist_template_items_delete_owner
--    exist but were previously never exercised) — owner-succeeds and
--    non-owner-rejected, for both tables, matching the symmetry already
--    achieved for the instance tables above (#48-59) and the silent-exclusion
--    style already used for this table pair's UPDATE tests (#9). Uses
--    disposable fixtures so the earlier snapshot/instance tests above are
--    unaffected.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.checklist_templates (id, organization_id, name)
     values ('e5000000-0000-0000-0000-00000000000b', 'e2000000-0000-0000-0000-00000000000a', 'Disposable Template (delete tests)') $$,
  'owner_a can insert a disposable checklist_templates row for the delete tests below'
); -- 71

select lives_ok(
  $$ insert into public.checklist_template_items (id, checklist_template_id, label)
     values ('e6000000-0000-0000-0000-00000000000c', 'e5000000-0000-0000-0000-00000000000b', 'Disposable item (delete test)') $$,
  'owner_a can insert a disposable checklist_template_items row for the delete tests below'
); -- 72

select pg_temp.act_as('e1222222-2222-2222-2222-222222222222');

delete from public.checklist_template_items where id = 'e6000000-0000-0000-0000-00000000000c';

select is(
  (select count(*)::int from public.checklist_template_items where id = 'e6000000-0000-0000-0000-00000000000c'),
  1,
  'planner_a''s DELETE attempt on checklist_template_items is silently excluded by RLS (owner-only delete); row still exists'
); -- 73

delete from public.checklist_templates where id = 'e5000000-0000-0000-0000-00000000000b';

select is(
  (select count(*)::int from public.checklist_templates where id = 'e5000000-0000-0000-0000-00000000000b'),
  1,
  'planner_a''s DELETE attempt on checklist_templates is silently excluded by RLS (owner-only delete); row still exists'
); -- 74

select pg_temp.act_as('e1111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ delete from public.checklist_template_items where id = 'e6000000-0000-0000-0000-00000000000c' $$,
  'owner_a can delete a checklist_template_items row directly'
); -- 75

select is(
  (select count(*)::int from public.checklist_template_items where id = 'e6000000-0000-0000-0000-00000000000c'),
  0,
  'the owner-deleted checklist_template_items row is actually gone'
); -- 76

select lives_ok(
  $$ delete from public.checklist_templates where id = 'e5000000-0000-0000-0000-00000000000b' $$,
  'owner_a can delete a checklist_templates row directly'
); -- 77

select is(
  (select count(*)::int from public.checklist_templates where id = 'e5000000-0000-0000-0000-00000000000b'),
  0,
  'the owner-deleted checklist_templates row is actually gone'
); -- 78

select * from finish();
rollback;
