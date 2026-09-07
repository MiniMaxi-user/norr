-- pgTAP RLS tests for activities (issue #59,
-- 20260828090000_activities_core.sql).
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
-- Coverage: tenant isolation; organization_id/reported_by/status_id
-- derivation and defaulting; the non-writable reported_at/reported_by/
-- organization_id columns; every cross-field/reference-list validation
-- validate_activity_relations/validate_activity_reference_items add
-- (asset_id-must-belong-to-client, contact_person_id-must-belong-to-client,
-- action_holder_id-must-be-org-member, asset_id required for
-- storing/onderhoud, contact info required for bel_activiteit, wrong
-- list_key, cross-org reference item); owner/planner full CRUD; engineer
-- create_own/read_own/update_own scoped to action_holder_id = auth.uid()
-- (no delete, cannot reassign away from self); finance/administratie
-- read-only, all rows.

begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with one of each relevant role, org_b for tenant
-- isolation. Two clients in org_a (client_a, client_a2), each with a site
-- and an asset, plus a contact, to exercise the
-- asset/contact-must-belong-to-client cross-field checks.
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
  ('d3000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'Client A'),
  ('d3000000-0000-0000-0000-00000000000b', 'd1000000-0000-0000-0000-00000000000a', 'Client A2');

insert into public.sites (id, client_id) values
  ('d4000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-00000000000a'),
  ('d4000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-00000000000b');

insert into public.assets (id, site_id, name, type_id, serial_number)
select 'd5000000-0000-0000-0000-00000000000a', 'd4000000-0000-0000-0000-00000000000a', 'Asset A', rli.id, 'SN-A'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into public.assets (id, site_id, name, type_id, serial_number)
select 'd5000000-0000-0000-0000-00000000000b', 'd4000000-0000-0000-0000-00000000000b', 'Asset A2', rli.id, 'SN-A2'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'electrical';

insert into public.contacts (id, client_id, name) values
  ('d6000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-00000000000a', 'Contact A'),
  ('d6000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-00000000000b', 'Contact A2');

select pg_temp.act_as('d2777777-7777-7777-7777-777777777777');

insert into public.organizations (id, name, created_by)
values ('d1000000-0000-0000-0000-00000000000b', 'Org B', 'd2777777-7777-7777-7777-777777777777');

insert into public.memberships (user_id, organization_id, role)
values ('d2777777-7777-7777-7777-777777777777', 'd1000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name)
values ('d3000000-0000-0000-0000-00000000000c', 'd1000000-0000-0000-0000-00000000000b', 'Client B');

-- Capture org_b's seeded activity_type "afspraak" item id, needed later
-- (while acting as owner_a) for the cross-org type_id hostile-insert test.
insert into pg_temp.captured_ids (key, val)
select 'org_b_activity_type_afspraak_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'd1000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'activity_type' and rli.value = 'afspraak';

-- ---------------------------------------------------------------------------
-- 1. owner: insert, derived columns, defaults, non-writable columns, and
--    every cross-field/reference-list validation this migration adds.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.activities (id, client_id, type_id, description, action_holder_id)
     select 'd7000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-00000000000a',
       rli.id, 'Klant wil een afspraak inplannen', 'd2333333-3333-3333-3333-333333333333'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'afspraak' $$,
  'owner_a can insert an Afspraak activity under client A (org_a), actioned by engineer_a'
); -- 1

select is(
  (select organization_id from public.activities where id = 'd7000000-0000-0000-0000-00000000000a'),
  'd1000000-0000-0000-0000-00000000000a'::uuid,
  'activities.organization_id was auto-derived from clients.organization_id via client_id'
); -- 2

select is(
  (select reported_by from public.activities where id = 'd7000000-0000-0000-0000-00000000000a'),
  'd2111111-1111-1111-1111-111111111111'::uuid,
  'activities.reported_by was auto-stamped to the inserting user (trigger), not client-supplied'
); -- 3

select is(
  (select rli.value from public.activities a
     join public.reference_list_items rli on rli.id = a.status_id
     where a.id = 'd7000000-0000-0000-0000-00000000000a'),
  'open',
  'activities.status_id defaulted to the org''s default activity_status item ("open") when omitted on insert'
); -- 4

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id, organization_id)
     select 'd3000000-0000-0000-0000-00000000000a', rli.id, 'Spoofed',
       'd2333333-3333-3333-3333-333333333333', 'd1000000-0000-0000-0000-00000000000a'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'afspraak' $$,
  '42501',
  null,
  'owner_a cannot set activities.organization_id directly on insert (column-level grant withheld)'
); -- 5

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id, reported_by)
     select 'd3000000-0000-0000-0000-00000000000a', rli.id, 'Spoofed',
       'd2333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'afspraak' $$,
  '42501',
  null,
  'owner_a cannot set activities.reported_by directly on insert (column-level grant withheld)'
); -- 6

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id, reported_at)
     select 'd3000000-0000-0000-0000-00000000000a', rli.id, 'Spoofed',
       'd2333333-3333-3333-3333-333333333333', now()
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'afspraak' $$,
  '42501',
  null,
  'owner_a cannot set activities.reported_at directly on insert (column-level grant withheld — relies purely on its default)'
); -- 7

select throws_ok(
  $$ insert into public.activities (client_id, asset_id, type_id, description, action_holder_id)
     select 'd3000000-0000-0000-0000-00000000000a', 'd5000000-0000-0000-0000-00000000000b', rli.id,
       'Wrong Asset Client', 'd2333333-3333-3333-3333-333333333333'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'afspraak' $$,
  '23514',
  null,
  'activities.asset_id from a different client (Asset A2 under Client A2) is rejected when client_id=Client A'
); -- 8

select throws_ok(
  $$ insert into public.activities (client_id, contact_person_id, type_id, description, action_holder_id)
     select 'd3000000-0000-0000-0000-00000000000a', 'd6000000-0000-0000-0000-00000000000b', rli.id,
       'Wrong Contact Client', 'd2333333-3333-3333-3333-333333333333'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'afspraak' $$,
  '23514',
  null,
  'activities.contact_person_id from a different client (Contact A2 under Client A2) is rejected when client_id=Client A'
); -- 9

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id)
     select 'd3000000-0000-0000-0000-00000000000a', rli.id, 'Cross Org Action Holder',
       'd2777777-7777-7777-7777-777777777777'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'afspraak' $$,
  '23514',
  null,
  'activities.action_holder_id must be a member of the activity''s own organization (owner_b is not a member of org_a)'
); -- 10

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id)
     select 'd3000000-0000-0000-0000-00000000000a', rli.id, 'Wrong Type List',
       'd2333333-3333-3333-3333-333333333333'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'asset_type' and rli.value = 'hvac' $$,
  '23514',
  null,
  'activities.type_id must be from the activity_type list, not asset_type (validate_activity_reference_items)'
); -- 11

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id, status_id)
     select 'd3000000-0000-0000-0000-00000000000a',
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'activity_type' and rli.value = 'afspraak'),
       'Wrong Status List',
       'd2333333-3333-3333-3333-333333333333',
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'asset_type' and rli.value = 'hvac') $$,
  '23514',
  null,
  'activities.status_id must be from the activity_status list, not asset_type (validate_activity_reference_items)'
); -- 12

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id)
     select 'd3000000-0000-0000-0000-00000000000a', val, 'Cross Org Type',
       'd2333333-3333-3333-3333-333333333333'
     from pg_temp.captured_ids where key = 'org_b_activity_type_afspraak_id' $$,
  '23514',
  null,
  'activities.type_id from a different organization''s activity_type list (org_b''s) is rejected'
); -- 13

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id)
     select 'd3000000-0000-0000-0000-00000000000a', rli.id, 'Storing zonder asset',
       'd2333333-3333-3333-3333-333333333333'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'storing' $$,
  '23514',
  null,
  'activities.asset_id is required when type=storing (validate_activity_relations)'
); -- 14

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id)
     select 'd3000000-0000-0000-0000-00000000000a', rli.id, 'Onderhoud zonder asset',
       'd2333333-3333-3333-3333-333333333333'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'onderhoud' $$,
  '23514',
  null,
  'activities.asset_id is required when type=onderhoud (validate_activity_relations)'
); -- 15

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id)
     select 'd3000000-0000-0000-0000-00000000000a', rli.id, 'Bel activiteit zonder contact',
       'd2333333-3333-3333-3333-333333333333'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'bel_activiteit' $$,
  '23514',
  null,
  'activities.contact_person_id (or contact_name+contact_phone) is required when type=bel_activiteit (validate_activity_relations)'
); -- 16

select lives_ok(
  $$ insert into public.activities (id, client_id, asset_id, type_id, description, action_holder_id)
     select 'd7000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-00000000000a',
       'd5000000-0000-0000-0000-00000000000a', rli.id, 'Compressor maakt lawaai',
       'd2333333-3333-3333-3333-333333333333'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'storing' $$,
  'owner_a can insert a Storing activity for client A with asset_id set'
); -- 17

select lives_ok(
  $$ insert into public.activities (id, client_id, type_id, description, action_holder_id, contact_name, contact_phone)
     select 'd7000000-0000-0000-0000-00000000000c', 'd3000000-0000-0000-0000-00000000000a',
       rli.id, 'Klant belt over factuur', 'd2444444-4444-4444-4444-444444444444',
       'Jan de Vries', '0612345678'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'bel_activiteit' $$,
  'owner_a can insert a Bel activiteit with a manually-entered contact_name+contact_phone override (no contact_person_id)'
); -- 18

select is(
  (select contact_name from public.activities where id = 'd7000000-0000-0000-0000-00000000000c'),
  'Jan de Vries',
  'the manually-entered contact_name override was stored as-is (not synced onto/from a contacts row)'
); -- 19

-- ---------------------------------------------------------------------------
-- 2. planner: full CRUD, matching the confirmed permission model.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.activities (id, client_id, type_id, description, action_holder_id)
     select 'd7000000-0000-0000-0000-00000000000d', 'd3000000-0000-0000-0000-00000000000a',
       rli.id, 'E-mail opvolgen na offerte', 'd2444444-4444-4444-4444-444444444444'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'email_opvolging' $$,
  'planner_a can insert an activity (actioned by engineer_a2)'
); -- 20

select lives_ok(
  $$ update public.activities set description = 'Afspraak ingepland voor dinsdag'
     where id = 'd7000000-0000-0000-0000-00000000000a' $$,
  'planner_a can update any activity in org_a, not just their own'
); -- 21

select is(
  (select description from public.activities where id = 'd7000000-0000-0000-0000-00000000000a'),
  'Afspraak ingepland voor dinsdag',
  'planner_a''s update took effect'
); -- 22

select lives_ok(
  $$ insert into public.activities (id, client_id, type_id, description, action_holder_id)
     select 'd7000000-0000-0000-0000-00000000000e', 'd3000000-0000-0000-0000-00000000000a',
       rli.id, 'Disposable', 'd2333333-3333-3333-3333-333333333333'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'afspraak' $$,
  'planner_a can insert a disposable activity for the delete test below'
); -- 23

select lives_ok(
  $$ delete from public.activities where id = 'd7000000-0000-0000-0000-00000000000e' $$,
  'planner_a can delete an activity in org_a'
); -- 24

select is(
  (select count(*)::int from public.activities where id = 'd7000000-0000-0000-0000-00000000000e'),
  0,
  'the disposable activity is actually gone after planner_a''s delete'
); -- 25

select is(
  (select count(*)::int from public.activities where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  4,
  'planner_a (unlike an engineer) sees every activity in org_a, not just ones where they are the action holder'
); -- 26

-- ---------------------------------------------------------------------------
-- 3. engineer: create_own/read_own/update_own, scoped to
--    action_holder_id = auth.uid(); no delete.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.activities where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  2,
  'engineer_a only sees activities where they are the action holder (Afspraak + Storing), not engineer_a2''s'
); -- 27

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id)
     select 'd3000000-0000-0000-0000-00000000000a', rli.id, 'Engineer assigns to someone else',
       'd2444444-4444-4444-4444-444444444444'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'afspraak' $$,
  '42501',
  null,
  'engineer_a cannot INSERT an activity with someone else as action_holder_id (create_own is scoped to themselves)'
); -- 28

select lives_ok(
  $$ insert into public.activities (id, client_id, type_id, description, action_holder_id)
     select 'd7000000-0000-0000-0000-00000000000f', 'd3000000-0000-0000-0000-00000000000a',
       rli.id, 'Engineer legt eigen melding vast', 'd2333333-3333-3333-3333-333333333333'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'afspraak' $$,
  'engineer_a CAN insert an activity with themselves as action_holder_id (create_own)'
); -- 29

select lives_ok(
  $$ update public.activities set description = 'Compressor vervangen'
     where id = 'd7000000-0000-0000-0000-00000000000b' $$,
  'engineer_a can update their own (action_holder_id) activity'
); -- 30

select is(
  (select description from public.activities where id = 'd7000000-0000-0000-0000-00000000000b'),
  'Compressor vervangen',
  'engineer_a''s update to their own activity took effect'
); -- 31

update public.activities set description = 'Hijacked' where id = 'd7000000-0000-0000-0000-00000000000d';

select is(
  (select description from public.activities where id = 'd7000000-0000-0000-0000-00000000000d'),
  'E-mail opvolgen na offerte',
  'engineer_a''s UPDATE on engineer_a2''s activity is silently excluded by RLS (USING); description unchanged'
); -- 32

delete from public.activities where id = 'd7000000-0000-0000-0000-00000000000b';

select is(
  (select count(*)::int from public.activities where id = 'd7000000-0000-0000-0000-00000000000b'),
  1,
  'engineer_a''s DELETE attempt on their own activity is silently excluded by RLS (engineer has no delete action); row still exists'
); -- 33

select throws_ok(
  $$ update public.activities set action_holder_id = 'd2444444-4444-4444-4444-444444444444'
     where id = 'd7000000-0000-0000-0000-00000000000b' $$,
  '42501',
  null,
  'engineer_a cannot reassign their own activity away from themselves; USING passes (currently theirs) but WITH CHECK fails on the new row since action_holder_id <> auth.uid() and they are not owner/planner'
); -- 34

-- ---------------------------------------------------------------------------
-- 4. finance / administratie: read-only, all rows (not scoped like engineer).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d2555555-5555-5555-5555-555555555555');

select is(
  (select count(*)::int from public.activities where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  5,
  'finance_a can SELECT every activity in org_a (read-only, all rows, not action-holder-scoped)'
); -- 35

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id)
     select 'd3000000-0000-0000-0000-00000000000a', rli.id, 'Finance Attempt',
       'd2333333-3333-3333-3333-333333333333'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'afspraak' $$,
  '42501',
  null,
  'finance_a cannot INSERT an activity (read-only)'
); -- 36

update public.activities set description = 'Finance Hijack' where id = 'd7000000-0000-0000-0000-00000000000b';

select is(
  (select description from public.activities where id = 'd7000000-0000-0000-0000-00000000000b'),
  'Compressor vervangen',
  'finance_a''s UPDATE is silently excluded by RLS (read-only); description unchanged'
); -- 37

select pg_temp.act_as('d2666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.activities where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  5,
  'administratie_a can SELECT every activity in org_a (read-only, all rows)'
); -- 38

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id)
     select 'd3000000-0000-0000-0000-00000000000a', rli.id, 'Administratie Attempt',
       'd2333333-3333-3333-3333-333333333333'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'afspraak' $$,
  '42501',
  null,
  'administratie_a cannot INSERT an activity (read-only)'
); -- 39

-- ---------------------------------------------------------------------------
-- 5. Tenant isolation: owner_b (org_b) cannot see or write org_a's activities.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('d2777777-7777-7777-7777-777777777777');

select is(
  (select count(*)::int from public.activities where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s activities'
); -- 40

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, action_holder_id)
     select 'd3000000-0000-0000-0000-00000000000a', rli.id, 'Hostile Cross Org Insert',
       'd2777777-7777-7777-7777-777777777777'
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'activity_type' and rli.value = 'afspraak' $$,
  '42501',
  null,
  'owner_b cannot INSERT an activity under org_a''s client (not a member of org_a at all, so current_member_role is null)'
); -- 41

select * from finish();
rollback;
