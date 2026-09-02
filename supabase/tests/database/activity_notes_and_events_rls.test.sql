-- pgTAP RLS tests for activity_notes / activity_events
-- (20260902090000_activity_notes_and_events.sql, Melding detail redesign).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the exact conventions established in
-- supabase/tests/database/activities_rls.test.sql: switch to the
-- `authenticated` role and set `request.jwt.claims` to simulate auth.uid()
-- for a given fixture user. All auth.users rows here are test fixtures,
-- rolled back at the end of the transaction.
--
-- Coverage: activity_notes' organization_id/action_holder_id derivation
-- (from the parent activity); the non-writable organization_id/
-- action_holder_id/created_by columns; owner/planner create+read+delete any
-- row; engineer create_own/read_own scoped to action_holder_id = auth.uid()
-- (no update, no delete); finance/administratie read-only; tenant isolation.
-- activity_events' three trigger-populated event kinds (created,
-- action_holder_changed, work_order_linked); that action_holder_id stays in
-- sync (activities_sync_dependents_action_holder) on both tables after the
-- parent activity is reassigned, including retroactively changing which
-- engineer can see a PRE-EXISTING note/event; that activity_events has no
-- client-facing INSERT/UPDATE/DELETE privilege at all, for any role.

begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with one of each relevant role, org_b for tenant
-- isolation. One client, one activity in org_a, actioned by engineer_a.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('e2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('e2333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('e2444444-4444-4444-4444-444444444444', 'engineer-a2@test.local'),
  ('e2555555-5555-5555-5555-555555555555', 'finance-a@test.local'),
  ('e2666666-6666-6666-6666-666666666666', 'administratie-a@test.local'),
  ('e2777777-7777-7777-7777-777777777777', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('e1000000-0000-0000-0000-00000000000a', 'Org A', 'e2111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role) values
  ('e2111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'owner'),
  ('e2222222-2222-2222-2222-222222222222', 'e1000000-0000-0000-0000-00000000000a', 'planner'),
  ('e2333333-3333-3333-3333-333333333333', 'e1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('e2444444-4444-4444-4444-444444444444', 'e1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('e2555555-5555-5555-5555-555555555555', 'e1000000-0000-0000-0000-00000000000a', 'finance'),
  ('e2666666-6666-6666-6666-666666666666', 'e1000000-0000-0000-0000-00000000000a', 'administratie');

insert into public.clients (id, organization_id, name) values
  ('e3000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'Client A');

insert into public.activities (id, client_id, type_id, description, action_holder_id)
select 'e7000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a',
  rli.id, 'Klant wil een afspraak inplannen', 'e2333333-3333-3333-3333-333333333333'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'e1000000-0000-0000-0000-00000000000a'
  and rl.list_key = 'activity_type' and rli.value = 'afspraak';

select pg_temp.act_as('e2777777-7777-7777-7777-777777777777');

insert into public.organizations (id, name, created_by)
values ('e1000000-0000-0000-0000-00000000000b', 'Org B', 'e2777777-7777-7777-7777-777777777777');

insert into public.memberships (user_id, organization_id, role)
values ('e2777777-7777-7777-7777-777777777777', 'e1000000-0000-0000-0000-00000000000b', 'owner');

-- ---------------------------------------------------------------------------
-- 0. activities_create_created_event: inserting the activity above already
--    logged a 'created' activity_events row (fires unconditionally on every
--    activities INSERT, including the fixture insert above, while still
--    acting as owner_a).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.activity_events
     where activity_id = 'e7000000-0000-0000-0000-00000000000a' and event_type = 'created'),
  1,
  'inserting the activity auto-logged exactly one created activity_events row (create_activity_created_event)'
); -- 1

select is(
  (select action_holder_id from public.activity_events
     where activity_id = 'e7000000-0000-0000-0000-00000000000a' and event_type = 'created'),
  'e2333333-3333-3333-3333-333333333333'::uuid,
  'the created event''s action_holder_id was denormalized from the new activity''s own action_holder_id'
); -- 2

-- ---------------------------------------------------------------------------
-- 1. activity_notes: owner insert, derivation, non-writable columns.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.activity_notes (id, activity_id, body)
     values ('e8000000-0000-0000-0000-00000000000a', 'e7000000-0000-0000-0000-00000000000a', 'Klant gebeld, terugbelverzoek genoteerd') $$,
  'owner_a can insert a note on activity A (org_a)'
); -- 3

select is(
  (select organization_id from public.activity_notes where id = 'e8000000-0000-0000-0000-00000000000a'),
  'e1000000-0000-0000-0000-00000000000a'::uuid,
  'activity_notes.organization_id was auto-derived from the parent activity (derive_activity_note_fields)'
); -- 4

select is(
  (select action_holder_id from public.activity_notes where id = 'e8000000-0000-0000-0000-00000000000a'),
  'e2333333-3333-3333-3333-333333333333'::uuid,
  'activity_notes.action_holder_id was auto-derived from the parent activity''s action_holder_id'
); -- 5

select is(
  (select created_by from public.activity_notes where id = 'e8000000-0000-0000-0000-00000000000a'),
  'e2111111-1111-1111-1111-111111111111'::uuid,
  'activity_notes.created_by was auto-stamped to the inserting user (set_created_by), not client-supplied'
); -- 6

select throws_ok(
  $$ insert into public.activity_notes (activity_id, body, organization_id)
     values ('e7000000-0000-0000-0000-00000000000a', 'Spoofed', 'e1000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_a cannot set activity_notes.organization_id directly on insert (column-level grant withheld)'
); -- 7

select throws_ok(
  $$ insert into public.activity_notes (activity_id, body, created_by)
     values ('e7000000-0000-0000-0000-00000000000a', 'Spoofed', '00000000-0000-0000-0000-000000000000') $$,
  '42501',
  null,
  'owner_a cannot set activity_notes.created_by directly on insert (column-level grant withheld)'
); -- 8

select throws_ok(
  $$ insert into public.activity_notes (activity_id, body)
     values ('e7000000-0000-0000-0000-00000000000a', '   ') $$,
  '23514',
  null,
  'a blank/whitespace-only body is rejected (activity_notes_body_not_blank)'
); -- 9

select throws_ok(
  $$ update public.activity_notes set body = 'Edited' where id = 'e8000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'owner_a cannot UPDATE a note at all (no UPDATE grant/policy — notes are never edited once posted)'
); -- 10

-- ---------------------------------------------------------------------------
-- 2. planner: create + delete any row.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.activity_notes (id, activity_id, body)
     values ('e8000000-0000-0000-0000-00000000000b', 'e7000000-0000-0000-0000-00000000000a', 'Planner note') $$,
  'planner_a can insert a note on activity A even though engineer_a (not planner_a) is the action holder'
); -- 11

select lives_ok(
  $$ delete from public.activity_notes where id = 'e8000000-0000-0000-0000-00000000000b' $$,
  'planner_a can delete a note in org_a'
); -- 12

-- ---------------------------------------------------------------------------
-- 3. engineer: create_own/read_own, keyed on the denormalized
--    action_holder_id; no delete.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.activity_notes where activity_id = 'e7000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a (the action holder) can see the note owner_a posted on their own activity'
); -- 13

select lives_ok(
  $$ insert into public.activity_notes (id, activity_id, body)
     values ('e8000000-0000-0000-0000-00000000000c', 'e7000000-0000-0000-0000-00000000000a', 'Engineer note on own activity') $$,
  'engineer_a can insert a note on their own (action_holder_id) activity'
); -- 14

delete from public.activity_notes where id = 'e8000000-0000-0000-0000-00000000000c';

select is(
  (select count(*)::int from public.activity_notes where id = 'e8000000-0000-0000-0000-00000000000c'),
  1,
  'engineer_a''s DELETE attempt on their own note is silently excluded by RLS (USING); no delete action, row still exists'
); -- 15

-- ---------------------------------------------------------------------------
-- 4. finance/administratie: read-only, no insert.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2555555-5555-5555-5555-555555555555');

select is(
  (select count(*)::int from public.activity_notes where activity_id = 'e7000000-0000-0000-0000-00000000000a'),
  2,
  'finance_a can SELECT every note on activity A (read-only, not action-holder-scoped)'
); -- 16

select throws_ok(
  $$ insert into public.activity_notes (activity_id, body)
     values ('e7000000-0000-0000-0000-00000000000a', 'Finance attempt') $$,
  '42501',
  null,
  'finance_a cannot INSERT a note (read-only)'
); -- 17

-- ---------------------------------------------------------------------------
-- 5. Tenant isolation: owner_b (org_b) cannot see or write org_a's notes.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2777777-7777-7777-7777-777777777777');

select is(
  (select count(*)::int from public.activity_notes where activity_id = 'e7000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s notes'
); -- 18

select throws_ok(
  $$ insert into public.activity_notes (activity_id, body)
     values ('e7000000-0000-0000-0000-00000000000a', 'Hostile cross-org insert') $$,
  '42501',
  null,
  'owner_b cannot INSERT a note on org_a''s activity (not a member of org_a at all)'
); -- 19

-- ---------------------------------------------------------------------------
-- 6. activity_events: no client-facing write privilege at all, for any role
--    (including owner) — the table grant itself is withheld.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ insert into public.activity_events (activity_id, event_type) values ('e7000000-0000-0000-0000-00000000000a', 'created') $$,
  '42501',
  null,
  'owner_a (even owner) cannot INSERT into activity_events directly — no table-level grant exists for any role but the trigger-owning function'
); -- 20

select throws_ok(
  $$ update public.activity_events set event_type = 'created' where activity_id = 'e7000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'owner_a cannot UPDATE activity_events directly'
); -- 21

select throws_ok(
  $$ delete from public.activity_events where activity_id = 'e7000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'owner_a cannot DELETE from activity_events directly'
); -- 22

-- ---------------------------------------------------------------------------
-- 7. activity_events: action_holder_changed event, and reassignment sync.
--    Reassign activity A from engineer_a to engineer_a2.
-- ---------------------------------------------------------------------------
update public.activities
  set action_holder_id = 'e2444444-4444-4444-4444-444444444444'
  where id = 'e7000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.activity_events
     where activity_id = 'e7000000-0000-0000-0000-00000000000a' and event_type = 'action_holder_changed'),
  1,
  'reassigning the activity auto-logged exactly one action_holder_changed activity_events row'
); -- 23

select is(
  (select action_holder_id from public.activity_events
     where activity_id = 'e7000000-0000-0000-0000-00000000000a' and event_type = 'action_holder_changed'),
  'e2444444-4444-4444-4444-444444444444'::uuid,
  'the action_holder_changed event''s action_holder_id reflects the NEW action holder'
); -- 24

select is(
  (select action_holder_id from public.activity_events
     where activity_id = 'e7000000-0000-0000-0000-00000000000a' and event_type = 'created'),
  'e2444444-4444-4444-4444-444444444444'::uuid,
  'the PRE-EXISTING created event''s action_holder_id was actively re-synced to the new action holder (activities_sync_dependents_action_holder), not left stale'
); -- 25

select is(
  (select action_holder_id from public.activity_notes where id = 'e8000000-0000-0000-0000-00000000000a'),
  'e2444444-4444-4444-4444-444444444444'::uuid,
  'the PRE-EXISTING note''s action_holder_id was also actively re-synced to the new action holder'
); -- 26

select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.activity_notes where activity_id = 'e7000000-0000-0000-0000-00000000000a'),
  0,
  'engineer_a (the OLD action holder) can no longer see any note on activity A after reassignment'
); -- 27

select pg_temp.act_as('e2444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from public.activity_notes where activity_id = 'e7000000-0000-0000-0000-00000000000a'),
  2,
  'engineer_a2 (the NEW action holder) can now see both pre-existing notes on activity A'
); -- 28

select is(
  (select count(*)::int from public.activity_events where activity_id = 'e7000000-0000-0000-0000-00000000000a'),
  2,
  'engineer_a2 (the NEW action holder) can now see both events (created + action_holder_changed) on activity A'
); -- 29

-- ---------------------------------------------------------------------------
-- 8. activity_events: work_order_linked event, created via a work_orders
--    insert with source_activity_id set.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.work_orders (id, client_id, title, source_activity_id)
     values ('e9000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a',
       'Werkbon vanuit melding', 'e7000000-0000-0000-0000-00000000000a') $$,
  'owner_a can insert a work order with source_activity_id pointing at activity A'
); -- 30

select is(
  (select count(*)::int from public.activity_events
     where activity_id = 'e7000000-0000-0000-0000-00000000000a' and event_type = 'work_order_linked'),
  1,
  'creating the work order auto-logged exactly one work_order_linked activity_events row on the source activity'
); -- 31

select is(
  (select related_work_order_id from public.activity_events
     where activity_id = 'e7000000-0000-0000-0000-00000000000a' and event_type = 'work_order_linked'),
  'e9000000-0000-0000-0000-00000000000a'::uuid,
  'the work_order_linked event''s related_work_order_id points at the newly created work order'
); -- 32

select is(
  (select action_holder_id from public.activity_events
     where activity_id = 'e7000000-0000-0000-0000-00000000000a' and event_type = 'work_order_linked'),
  'e2444444-4444-4444-4444-444444444444'::uuid,
  'the work_order_linked event''s action_holder_id was denormalized from the activity''s CURRENT action holder (post-reassignment)'
); -- 33

select * from finish();
rollback;
