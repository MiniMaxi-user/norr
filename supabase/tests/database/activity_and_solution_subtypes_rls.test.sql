-- pgTAP RLS tests for Activity Sub-type / Solution Sub-type (issues #134/
-- #138, 20260912090000_activity_and_solution_subtypes.sql):
-- activity_subtypes, solution_subtypes (both self-referential, unlimited-
-- depth trees), and the two new activities.activity_subtype_id/
-- solution_subtype_id cross-field validations added to
-- validate_activity_relations.
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/articles_rls.test.sql (tree cycle/RLS coverage
-- pattern) and supabase/tests/database/activities_rls.test.sql
-- (cross-field-validation coverage pattern): switch to the `authenticated`
-- role and set `request.jwt.claims` to simulate auth.uid() for a given
-- fixture user. All auth.users rows here are test fixtures, rolled back at
-- the end of the transaction.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error — the row is silently excluded (0 rows changed). Only
-- INSERT/UPDATE `WITH CHECK` violations (and column-level privilege
-- revokes) raise error 42501.
--
-- UNLIKE article_groups (owner OR administratie write), both new tables here
-- are OWNER-ONLY write (see migration design note 5) — coverage below proves
-- administratie_a specifically (a non-owner member who DOES get full CRUD on
-- article_groups/articles) is rejected here, not just some generic
-- non-member.

begin;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a (owner + administratie + a client, for the activities
-- integration section), org_b (its own owner, its own activity_subtypes/
-- solution_subtypes root, for cross-org hostile-reference tests).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('e2222222-2222-2222-2222-222222222222', 'administratie-a@test.local'),
  ('e2333333-3333-3333-3333-333333333333', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

-- Created AFTER the first act_as call, so it's owned by role `authenticated`
-- (see articles_rls.test.sql's own comment on this exact gotcha) — every
-- fixture "user" from here on can freely read/write it regardless of which
-- one is currently simulated.
create table pg_temp.captured_ids (key text primary key, val uuid not null);

insert into public.organizations (id, name, created_by)
values ('e1000000-0000-0000-0000-00000000000a', 'Org A', 'e2111111-1111-1111-1111-111111111111');

-- Bootstrap owner row and administratie's row must be separate INSERT
-- statements (see articles_rls.test.sql's own comment: is_org_owner's
-- SECURITY DEFINER re-query can't see a row inserted earlier in the same
-- statement).
insert into public.memberships (user_id, organization_id, role)
values ('e2111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'owner');

insert into public.memberships (user_id, organization_id, role)
values ('e2222222-2222-2222-2222-222222222222', 'e1000000-0000-0000-0000-00000000000a', 'administratie');

insert into public.clients (id, organization_id, name)
values ('e3000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'Client A');

select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

insert into public.organizations (id, name, created_by)
values ('e1000000-0000-0000-0000-00000000000b', 'Org B', 'e2333333-3333-3333-3333-333333333333');

insert into public.memberships (user_id, organization_id, role)
values ('e2333333-3333-3333-3333-333333333333', 'e1000000-0000-0000-0000-00000000000b', 'owner');

-- org_b's own activity_subtypes root (type_id = org_b's own seeded
-- "afspraak" item) and solution_subtypes root — used below purely as
-- hostile cross-organization references from org_a.
--
-- Deliberately using 'afspraak'/'email_opvolging' (not 'storing'/
-- 'onderhoud') as the two activity_type values throughout this file:
-- validate_activity_relations independently requires asset_id whenever
-- type_id resolves to storing/onderhoud (20260828090000_activities_core.sql)
-- — an orthogonal rule this file has no reason to also satisfy just to
-- exercise the NEW activity_subtype_id/solution_subtype_id checks.
insert into public.activity_subtypes (id, organization_id, type_id, name)
select 'e8000000-0000-0000-0000-00000000000e', 'e1000000-0000-0000-0000-00000000000b', rli.id, 'Org B Afspraak Root'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'e1000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'activity_type' and rli.value = 'afspraak';

insert into public.solution_subtypes (id, organization_id, name)
values ('e9000000-0000-0000-0000-00000000000d', 'e1000000-0000-0000-0000-00000000000b', 'Org B Solution Root');

-- Capture org_a's activity_type ('afspraak'/'email_opvolging') and
-- asset_type ('hvac') item ids, and org_b's activity_type 'afspraak' item
-- id — needed below for the type-link/wrong-list-key/cross-org
-- hostile-reference tests.
insert into pg_temp.captured_ids (key, val)
select 'org_a_afspraak_type_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'e1000000-0000-0000-0000-00000000000a'
  and rl.list_key = 'activity_type' and rli.value = 'afspraak';

insert into pg_temp.captured_ids (key, val)
select 'org_a_email_opvolging_type_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'e1000000-0000-0000-0000-00000000000a'
  and rl.list_key = 'activity_type' and rli.value = 'email_opvolging';

insert into pg_temp.captured_ids (key, val)
select 'org_a_hvac_type_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'e1000000-0000-0000-0000-00000000000a'
  and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into pg_temp.captured_ids (key, val)
select 'org_b_afspraak_type_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'e1000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'activity_type' and rli.value = 'afspraak';

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 1. activity_subtypes: unlimited-depth tree with the root-type-link
--    wrinkle, cycle/self/cross-org/dangling rejection, wrong-list-key/
--    cross-org type_id rejection, owner-only write boundary.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.activity_subtypes (id, organization_id, type_id, name)
     select 'e8000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', val, 'Afspraak Root'
     from pg_temp.captured_ids where key = 'org_a_afspraak_type_id' $$,
  'owner_a can create a root activity_subtype linked to the activity_type "afspraak" item'
); -- 1

select lives_ok(
  $$ insert into public.activity_subtypes (id, organization_id, parent_subtype_id, name)
     values ('e8000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a', 'e8000000-0000-0000-0000-00000000000a', 'Afspraak Child') $$,
  'owner_a can create a non-root Subtype under the root (parent set, type_id null)'
); -- 2

select lives_ok(
  $$ insert into public.activity_subtypes (id, organization_id, parent_subtype_id, name)
     values ('e8000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-00000000000a', 'e8000000-0000-0000-0000-00000000000b', 'Afspraak Grandchild') $$,
  'owner_a can create a Sub-subtype under the child — unlimited depth works'
); -- 3

select throws_ok(
  $$ insert into public.activity_subtypes (organization_id, parent_subtype_id, type_id, name)
     select 'e1000000-0000-0000-0000-00000000000a', 'e8000000-0000-0000-0000-00000000000a', val, 'Both set'
     from pg_temp.captured_ids where key = 'org_a_afspraak_type_id' $$,
  '23514',
  null,
  'a row with BOTH parent_subtype_id and type_id set is rejected (activity_subtypes_root_xor_parent)'
); -- 4

select throws_ok(
  $$ insert into public.activity_subtypes (organization_id, name)
     values ('e1000000-0000-0000-0000-00000000000a', 'Neither set') $$,
  '23514',
  null,
  'a row with NEITHER parent_subtype_id nor type_id set is rejected (activity_subtypes_root_xor_parent)'
); -- 5

select throws_ok(
  $$ update public.activity_subtypes set parent_subtype_id = 'e8000000-0000-0000-0000-00000000000c'
     where id = 'e8000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'the root cannot be re-parented under its own grandchild (would create a cycle)'
); -- 6

select throws_ok(
  $$ update public.activity_subtypes set parent_subtype_id = id
     where id = 'e8000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'a subtype cannot reference itself as its own parent'
); -- 7

select throws_ok(
  $$ update public.activity_subtypes set parent_subtype_id = 'e8000000-0000-0000-0000-00000000000e'
     where id = 'e8000000-0000-0000-0000-00000000000b' $$,
  '23514',
  null,
  'the child cannot be re-parented under org_b''s activity_subtype (cross-organization rejected)'
); -- 8

select throws_ok(
  $$ update public.activity_subtypes set parent_subtype_id = gen_random_uuid()
     where id = 'e8000000-0000-0000-0000-00000000000b' $$,
  '23503',
  null,
  'a parent_subtype_id pointing at a nonexistent activity_subtypes row is rejected as dangling'
); -- 9

select throws_ok(
  $$ insert into public.activity_subtypes (organization_id, type_id, name)
     select 'e1000000-0000-0000-0000-00000000000a', val, 'Wrong list type'
     from pg_temp.captured_ids where key = 'org_a_hvac_type_id' $$,
  '23514',
  null,
  'activity_subtypes.type_id must reference an item from the activity_type list, not asset_type'
); -- 10

select throws_ok(
  $$ insert into public.activity_subtypes (organization_id, type_id, name)
     select 'e1000000-0000-0000-0000-00000000000a', val, 'Cross org type'
     from pg_temp.captured_ids where key = 'org_b_afspraak_type_id' $$,
  '23514',
  null,
  'activity_subtypes.type_id from a different organization''s activity_type list is rejected even though it is a same-shape "afspraak" item'
); -- 11

select is(
  (select count(*)::int from public.activity_subtypes where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  3,
  'org_a has exactly 3 activity_subtypes after the tree + rejected attempts above'
); -- 12

select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.activity_subtypes (organization_id, type_id, name)
     select 'e1000000-0000-0000-0000-00000000000a', val, 'Administratie Attempt'
     from pg_temp.captured_ids where key = 'org_a_email_opvolging_type_id' $$,
  '42501',
  null,
  'administratie_a (owner-only write boundary — NOT the article_groups owner-or-administratie shape) cannot INSERT an activity_subtype'
); -- 13

select is(
  (select count(*)::int from public.activity_subtypes where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  3,
  'administratie_a (read-only member here) can still SELECT all 3 of org_a''s activity_subtypes'
); -- 14

select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.activity_subtypes where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s activity_subtypes'
); -- 15

select throws_ok(
  $$ insert into public.activity_subtypes (organization_id, name)
     values ('e1000000-0000-0000-0000-00000000000a', 'Hostile') $$,
  '42501',
  null,
  'owner_b cannot INSERT an activity_subtype into org_a (not is_org_owner of org_a)'
); -- 16

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 2. solution_subtypes: unlimited-depth tree, structurally identical to
--    article_groups (no type-link concept at all) — cycle/self/cross-org/
--    dangling rejection, owner-only write boundary.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.solution_subtypes (id, organization_id, name)
     values ('e9000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'Solution Root') $$,
  'owner_a can create a top-level solution_subtype'
); -- 17

select lives_ok(
  $$ insert into public.solution_subtypes (id, organization_id, parent_subtype_id, name)
     values ('e9000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a', 'e9000000-0000-0000-0000-00000000000a', 'Solution Child') $$,
  'owner_a can create a Solution sub-subtype under the root'
); -- 18

select lives_ok(
  $$ insert into public.solution_subtypes (id, organization_id, parent_subtype_id, name)
     values ('e9000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-00000000000a', 'e9000000-0000-0000-0000-00000000000b', 'Solution Grandchild') $$,
  'owner_a can create a Solution sub-sub-subtype under the child — unlimited depth works'
); -- 19

select throws_ok(
  $$ update public.solution_subtypes set parent_subtype_id = 'e9000000-0000-0000-0000-00000000000c'
     where id = 'e9000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'the root cannot be re-parented under its own grandchild (would create a cycle)'
); -- 20

select throws_ok(
  $$ update public.solution_subtypes set parent_subtype_id = id
     where id = 'e9000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'a solution_subtype cannot reference itself as its own parent'
); -- 21

select throws_ok(
  $$ update public.solution_subtypes set parent_subtype_id = 'e9000000-0000-0000-0000-00000000000d'
     where id = 'e9000000-0000-0000-0000-00000000000b' $$,
  '23514',
  null,
  'the child cannot be re-parented under org_b''s solution_subtype (cross-organization rejected)'
); -- 22

select throws_ok(
  $$ update public.solution_subtypes set parent_subtype_id = gen_random_uuid()
     where id = 'e9000000-0000-0000-0000-00000000000b' $$,
  '23503',
  null,
  'a parent_subtype_id pointing at a nonexistent solution_subtypes row is rejected as dangling'
); -- 23

select is(
  (select count(*)::int from public.solution_subtypes where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  3,
  'org_a has exactly 3 solution_subtypes after the tree + rejected attempts above'
); -- 24

select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.solution_subtypes (organization_id, name)
     values ('e1000000-0000-0000-0000-00000000000a', 'Administratie Attempt') $$,
  '42501',
  null,
  'administratie_a cannot INSERT a solution_subtype (owner-only write boundary)'
); -- 25

select is(
  (select count(*)::int from public.solution_subtypes where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  3,
  'administratie_a (read-only member here) can still SELECT all 3 of org_a''s solution_subtypes'
); -- 26

select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.solution_subtypes where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s solution_subtypes'
); -- 27

select throws_ok(
  $$ insert into public.solution_subtypes (organization_id, name)
     values ('e1000000-0000-0000-0000-00000000000a', 'Hostile') $$,
  '42501',
  null,
  'owner_b cannot INSERT a solution_subtype into org_a (not is_org_owner of org_a)'
); -- 28

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 3. activities.activity_subtype_id / solution_subtype_id: cross-org
--    rejection (both), dangling rejection (both), and the root-type-match
--    walk (activity_subtype_id only — solution_subtype_id has no equivalent
--    check, per design note 2/4).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.activities (id, client_id, type_id, description, activity_subtype_id)
     select 'e7000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a', val,
       'Klant wil een afspraak inplannen', 'e8000000-0000-0000-0000-00000000000c'
     from pg_temp.captured_ids where key = 'org_a_afspraak_type_id' $$,
  'owner_a can create an Afspraak activity with activity_subtype_id set to a leaf whose root type_id matches type_id=afspraak'
); -- 29

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, activity_subtype_id)
     select 'e3000000-0000-0000-0000-00000000000a', val,
       'Mismatched subtype branch', 'e8000000-0000-0000-0000-00000000000e'
     from pg_temp.captured_ids where key = 'org_a_afspraak_type_id' $$,
  '23514',
  null,
  'activities.activity_subtype_id from a different organization''s tree is rejected (cross-org check fires before the root-type-match walk)'
); -- 30

select lives_ok(
  $$ insert into public.activity_subtypes (id, organization_id, type_id, name)
     select 'e8000000-0000-0000-0000-00000000000d', 'e1000000-0000-0000-0000-00000000000a', val, 'Email Opvolging Root'
     from pg_temp.captured_ids where key = 'org_a_email_opvolging_type_id' $$,
  'owner_a can create a second, separate root activity_subtype (Email opvolging) in the same organization, for the type-mismatch test below'
); -- 31

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, activity_subtype_id)
     select 'e3000000-0000-0000-0000-00000000000a', val,
       'Afspraak activity with Email opvolging subtype', 'e8000000-0000-0000-0000-00000000000d'
     from pg_temp.captured_ids where key = 'org_a_afspraak_type_id' $$,
  '23514',
  null,
  'an activity with type_id=afspraak cannot use an activity_subtype_id whose root type_id resolves to email_opvolging (root-type-match walk)'
); -- 32

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, activity_subtype_id)
     select 'e3000000-0000-0000-0000-00000000000a', val,
       'Dangling activity_subtype_id', gen_random_uuid()
     from pg_temp.captured_ids where key = 'org_a_afspraak_type_id' $$,
  '23503',
  null,
  'a dangling (nonexistent) activities.activity_subtype_id is rejected'
); -- 33

select throws_ok(
  $$ insert into public.activities (client_id, type_id, description, solution_subtype_id)
     select 'e3000000-0000-0000-0000-00000000000a', val,
       'Cross org solution subtype', 'e9000000-0000-0000-0000-00000000000d'
     from pg_temp.captured_ids where key = 'org_a_afspraak_type_id' $$,
  '23514',
  null,
  'activities.solution_subtype_id from a different organization''s tree is rejected'
); -- 34

select lives_ok(
  $$ insert into public.activities (client_id, type_id, description, solution_subtype_id)
     select 'e3000000-0000-0000-0000-00000000000a', val,
       'Solution subtype set, no type-match check applies', 'e9000000-0000-0000-0000-00000000000c'
     from pg_temp.captured_ids where key = 'org_a_afspraak_type_id' $$,
  'owner_a can set activities.solution_subtype_id to any same-organization leaf regardless of activities.type_id (no type-match check for solution_subtype_id)'
); -- 35

select * from finish();
rollback;
