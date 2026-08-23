-- pgTAP RLS tests for time_entries (issue #15,
-- 20260823180000_time_entries_core.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/work_orders_rls.test.sql: switch to the
-- `authenticated` role and set `request.jwt.claims` to simulate auth.uid()
-- for a given fixture user. All auth.users rows here are test fixtures,
-- rolled back at the end of the transaction.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error — the row is silently excluded (0 rows changed). Only
-- INSERT/UPDATE `WITH CHECK` violations (and column-level privilege
-- revokes) raise error 42501.
--
-- This is the THIRD table (after work_orders, contracts) enforcing a
-- per-role RBAC matrix row as real RLS via current_member_role — see the
-- time_entries_* policies in the migration. Coverage: tenant isolation;
-- engineer can INSERT/SELECT/UPDATE only their own entries (not another
-- engineer's, not another tenant's); engineer cannot reassign user_id away
-- from themselves on UPDATE; engineer INSERT with someone else's user_id is
-- rejected; engineer cannot DELETE (even their own); planner/owner full CRUD
-- (BOTH roles tested directly performing UPDATE/DELETE); finance/
-- administratie read-only; ended_at < started_at rejected; work_order_id
-- cross-org rejected; user_id not-an-org-member rejected.

begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with one of each relevant role (two engineers, to prove
-- engineer-vs-engineer scoping), org_b for tenant isolation.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('d2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('d2333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('d2444444-4444-4444-4444-444444444444', 'engineer-a2@test.local'),
  ('d2555555-5555-5555-5555-555555555555', 'finance-a@test.local'),
  ('d2666666-6666-6666-6666-666666666666', 'administratie-a@test.local'),
  ('d2777777-7777-7777-7777-777777777777', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create table pg_temp.captured_ids (key text primary key, val uuid not null);

select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('d1000000-0000-0000-0000-00000000000a', 'Org A', 'd2111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role) values
  ('d2111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-00000000000a', 'owner'),
  ('d2222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-00000000000a', 'planner'),
  ('d2333333-3333-3333-3333-333333333333', 'd1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('d2444444-4444-4444-4444-444444444444', 'd1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('d2555555-5555-5555-5555-555555555555', 'd1000000-0000-0000-0000-00000000000a', 'finance'),
  ('d2666666-6666-6666-6666-666666666666', 'd1000000-0000-0000-0000-00000000000a', 'administratie');

insert into public.clients (id, organization_id, name) values
  ('d3000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'Client A');

insert into public.work_orders (id, client_id, title, assigned_to) values
  ('d4000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-00000000000a', 'WO A', 'd2333333-3333-3333-3333-333333333333'),
  ('d4000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-00000000000a', 'WO A2', 'd2444444-4444-4444-4444-444444444444');

select pg_temp.act_as('d2777777-7777-7777-7777-777777777777');

insert into public.organizations (id, name, created_by)
values ('d1000000-0000-0000-0000-00000000000b', 'Org B', 'd2777777-7777-7777-7777-777777777777');

insert into public.memberships (user_id, organization_id, role)
values ('d2777777-7777-7777-7777-777777777777', 'd1000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name)
values ('d3000000-0000-0000-0000-00000000000c', 'd1000000-0000-0000-0000-00000000000b', 'Client B');

insert into public.work_orders (id, client_id, title)
values ('d4000000-0000-0000-0000-00000000000c', 'd3000000-0000-0000-0000-00000000000c', 'WO B');

-- Capture org_b's seeded time_entry_type "labor" item id, needed later (while
-- acting as owner_a) for the cross-org entry_type_id hostile-insert-style
-- check (used indirectly via the cross-org work_order_id test below).

-- ---------------------------------------------------------------------------
-- 1. owner: insert, derived columns, defaults, and cross-field validations.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.time_entries (id, work_order_id, user_id, started_at)
     values ('d5000000-0000-0000-0000-00000000000a', 'd4000000-0000-0000-0000-00000000000a',
       'd2333333-3333-3333-3333-333333333333', now() - interval '1 hour') $$,
  'owner_a can insert a time entry under org_a''s work order, for engineer_a'
); -- 1

select is(
  (select organization_id from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000a'),
  'd1000000-0000-0000-0000-00000000000a'::uuid,
  'time_entries.organization_id was auto-derived from work_orders.organization_id via work_order_id'
); -- 2

select is(
  (select created_by from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000a'),
  'd2111111-1111-1111-1111-111111111111'::uuid,
  'time_entries.created_by was auto-stamped to the inserting user (trigger), not client-supplied'
); -- 3

select is(
  (select rli.value from public.time_entries te
     join public.reference_list_items rli on rli.id = te.entry_type_id
     where te.id = 'd5000000-0000-0000-0000-00000000000a'),
  'labor',
  'time_entries.entry_type_id defaulted to the org''s default time_entry_type item ("labor") when omitted on insert'
); -- 4

select throws_ok(
  $$ insert into public.time_entries (work_order_id, user_id, organization_id)
     values ('d4000000-0000-0000-0000-00000000000a', 'd2333333-3333-3333-3333-333333333333',
       'd1000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_a cannot set time_entries.organization_id directly on insert (column-level grant withheld)'
); -- 5

select throws_ok(
  $$ insert into public.time_entries (work_order_id, user_id, created_by)
     values ('d4000000-0000-0000-0000-00000000000a', 'd2333333-3333-3333-3333-333333333333',
       '00000000-0000-0000-0000-000000000000') $$,
  '42501',
  null,
  'owner_a cannot set time_entries.created_by directly on insert (column-level grant withheld)'
); -- 6

select throws_ok(
  $$ insert into public.time_entries (work_order_id, user_id, started_at, ended_at)
     values ('d4000000-0000-0000-0000-00000000000a', 'd2333333-3333-3333-3333-333333333333',
       now(), now() - interval '1 hour') $$,
  '23514',
  null,
  'time_entries.ended_at must be >= started_at (time_entries_ended_at_after_started_at check constraint)'
); -- 7

select throws_ok(
  $$ insert into public.time_entries (work_order_id, user_id)
     values ('d4000000-0000-0000-0000-00000000000c', 'd2333333-3333-3333-3333-333333333333') $$,
  '23514',
  null,
  'time_entries.work_order_id from a different organization (org_b''s WO B) is rejected: organization_id derives to org_b, and engineer_a (org_a) fails validate_time_entry_relations''s membership check against that resulting org (SECURITY DEFINER derive trigger resolves the work order regardless of owner_a''s own RLS visibility into org_b)'
); -- 8

select throws_ok(
  $$ insert into public.time_entries (work_order_id, user_id)
     values ('d4000000-0000-0000-0000-00000000000a', 'd2777777-7777-7777-7777-777777777777') $$,
  '23514',
  null,
  'time_entries.user_id must be a member of the time entry''s own organization (owner_b is not a member of org_a)'
); -- 9

-- ---------------------------------------------------------------------------
-- 2. planner: full CRUD, matching the RBAC matrix's planning row.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.time_entries (id, work_order_id, user_id)
     values ('d5000000-0000-0000-0000-00000000000b', 'd4000000-0000-0000-0000-00000000000b',
       'd2444444-4444-4444-4444-444444444444') $$,
  'planner_a can insert a time entry (for engineer_a2)'
); -- 10

select lives_ok(
  $$ update public.time_entries set notes = 'Planner correction' where id = 'd5000000-0000-0000-0000-00000000000a' $$,
  'planner_a can update any time entry in org_a, not just their own'
); -- 11

select is(
  (select notes from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000a'),
  'Planner correction',
  'planner_a''s update took effect'
); -- 12

select lives_ok(
  $$ insert into public.time_entries (id, work_order_id, user_id)
     values ('d5000000-0000-0000-0000-00000000000c', 'd4000000-0000-0000-0000-00000000000a',
       'd2333333-3333-3333-3333-333333333333') $$,
  'planner_a can insert a disposable time entry for the delete test below'
); -- 13

select lives_ok(
  $$ delete from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000c' $$,
  'planner_a can delete a time entry in org_a'
); -- 14

select is(
  (select count(*)::int from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000c'),
  0,
  'the disposable time entry is actually gone after planner_a''s delete'
); -- 15

select is(
  (select count(*)::int from public.time_entries where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  2,
  'planner_a (unlike an engineer) sees every time entry in org_a, not just their own'
); -- 16

-- ---------------------------------------------------------------------------
-- 2b. owner: also directly exercises UPDATE/DELETE (not just INSERT above),
--     per qa-reviewer's flagged gap on the Contracts PR (test BOTH
--     owner/planner directly, not just one).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ update public.time_entries set notes = 'Owner correction' where id = 'd5000000-0000-0000-0000-00000000000b' $$,
  'owner_a can update any time entry in org_a, not just their own'
); -- 17

select is(
  (select notes from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000b'),
  'Owner correction',
  'owner_a''s update took effect'
); -- 18

select lives_ok(
  $$ insert into public.time_entries (id, work_order_id, user_id)
     values ('d5000000-0000-0000-0000-00000000000d', 'd4000000-0000-0000-0000-00000000000a',
       'd2333333-3333-3333-3333-333333333333') $$,
  'owner_a can insert a second disposable time entry for the owner-delete test'
); -- 19

select lives_ok(
  $$ delete from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000d' $$,
  'owner_a can delete a time entry in org_a'
); -- 20

select is(
  (select count(*)::int from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000d'),
  0,
  'the owner-deleted disposable time entry is actually gone'
); -- 21

-- ---------------------------------------------------------------------------
-- 3. engineer: SELECT/INSERT/UPDATE scoped to user_id = auth.uid() only; no
--    delete.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.time_entries where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a only sees the one time entry logged for them (not engineer_a2''s)'
); -- 22

select is(
  (select id from public.time_entries where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  'd5000000-0000-0000-0000-00000000000a'::uuid,
  'the time entry engineer_a can see is specifically their own'
); -- 23

select lives_ok(
  $$ insert into public.time_entries (id, work_order_id, user_id)
     values ('d5000000-0000-0000-0000-00000000000e', 'd4000000-0000-0000-0000-00000000000a',
       'd2333333-3333-3333-3333-333333333333') $$,
  'engineer_a CAN insert a time entry for themselves (create_own, unlike work_orders'' engineer row)'
); -- 24

select throws_ok(
  $$ insert into public.time_entries (work_order_id, user_id)
     values ('d4000000-0000-0000-0000-00000000000b', 'd2444444-4444-4444-4444-444444444444') $$,
  '42501',
  null,
  'engineer_a cannot INSERT a time entry for engineer_a2 (user_id must equal auth.uid() for an engineer)'
); -- 25

select lives_ok(
  $$ update public.time_entries set notes = 'Clocked out' where id = 'd5000000-0000-0000-0000-00000000000a' $$,
  'engineer_a can update their own time entry'
); -- 26

select is(
  (select notes from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000a'),
  'Clocked out',
  'engineer_a''s update to their own time entry took effect'
); -- 27

update public.time_entries set notes = 'Hijacked' where id = 'd5000000-0000-0000-0000-00000000000b';

select is(
  (select notes from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000b'),
  'Owner correction',
  'engineer_a''s UPDATE on engineer_a2''s time entry is silently excluded by RLS (USING); notes unchanged'
); -- 28

delete from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a''s DELETE attempt on their own time entry is silently excluded by RLS (engineer has no delete action); row still exists'
); -- 29

select throws_ok(
  $$ update public.time_entries set user_id = 'd2444444-4444-4444-4444-444444444444'
     where id = 'd5000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'engineer_a cannot reassign their own time entry away from themselves (user_id := engineer_a2); USING passes (currently theirs) but WITH CHECK fails on the new row since user_id <> auth.uid() and they are not owner/planner'
); -- 30

-- ---------------------------------------------------------------------------
-- 4. finance / administratie: read-only, all rows (not scoped like engineer).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d2555555-5555-5555-5555-555555555555');

select is(
  (select count(*)::int from public.time_entries where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  3,
  'finance_a can SELECT every time entry in org_a (read-only, all rows, not user-scoped)'
); -- 31

select throws_ok(
  $$ insert into public.time_entries (work_order_id, user_id)
     values ('d4000000-0000-0000-0000-00000000000a', 'd2333333-3333-3333-3333-333333333333') $$,
  '42501',
  null,
  'finance_a cannot INSERT a time entry (read-only)'
); -- 32

update public.time_entries set notes = 'Finance Hijack' where id = 'd5000000-0000-0000-0000-00000000000a';

select is(
  (select notes from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000a'),
  'Clocked out',
  'finance_a''s UPDATE is silently excluded by RLS (read-only); notes unchanged'
); -- 33

select pg_temp.act_as('d2666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.time_entries where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  3,
  'administratie_a can SELECT every time entry in org_a (read-only, all rows)'
); -- 34

select throws_ok(
  $$ insert into public.time_entries (work_order_id, user_id)
     values ('d4000000-0000-0000-0000-00000000000a', 'd2333333-3333-3333-3333-333333333333') $$,
  '42501',
  null,
  'administratie_a cannot INSERT a time entry (read-only)'
); -- 35

-- ---------------------------------------------------------------------------
-- 5. Tenant isolation: owner_b (org_b) cannot see or write org_a's time
--    entries.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d2777777-7777-7777-7777-777777777777');

select is(
  (select count(*)::int from public.time_entries where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s time entries'
); -- 36

select throws_ok(
  $$ insert into public.time_entries (work_order_id, user_id)
     values ('d4000000-0000-0000-0000-00000000000a', 'd2333333-3333-3333-3333-333333333333') $$,
  '42501',
  null,
  'owner_b cannot INSERT a time entry under org_a''s work order (not a member of org_a at all, so current_member_role is null)'
); -- 37

update public.time_entries set notes = 'Owner B Hijack' where id = 'd5000000-0000-0000-0000-00000000000a';

select is(
  (select notes from public.time_entries where id = 'd5000000-0000-0000-0000-00000000000a'),
  'Clocked out',
  'owner_b''s UPDATE on org_a''s time entry is silently excluded by RLS (USING; owner_b is not a member of org_a at all); notes unchanged'
); -- 38

select * from finish();
rollback;
