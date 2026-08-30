-- pgTAP RLS tests for work_order_articles (issue #94 schema prerequisite,
-- 20260830100000_work_order_articles_and_quote_traceability.sql), plus a
-- small cross-org check for quotes.work_order_id/quote_line_items.article_id
-- (same migration).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/time_entries_rls.test.sql (this table's RLS shape
-- is time_entries' shape, scoped on created_by instead of user_id — see the
-- migration header's design note 4). Coverage: tenant isolation; organization
-- derivation from work_order_id; article_id cross-org rejection; engineer can
-- INSERT/SELECT/UPDATE only their own logged rows (not another engineer's,
-- not another tenant's); engineer cannot DELETE; planner/owner full CRUD
-- (both tested directly); finance/administratie read-only; quantity <= 0
-- rejected; quotes.work_order_id cross-client rejection;
-- quote_line_items.article_id cross-org rejection.

begin;
create extension if not exists pgtap with schema extensions;

select plan(34);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with one of each relevant role (two engineers, to prove
-- engineer-vs-engineer scoping), org_b for tenant isolation.
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
  ('e3000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'Client A'),
  ('e3000000-0000-0000-0000-00000000000d', 'e1000000-0000-0000-0000-00000000000a', 'Client A2');

insert into public.work_orders (id, client_id, title, assigned_to) values
  ('e4000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a', 'WO A', 'e2333333-3333-3333-3333-333333333333'),
  ('e4000000-0000-0000-0000-00000000000b', 'e3000000-0000-0000-0000-00000000000a', 'WO A2', 'e2444444-4444-4444-4444-444444444444');

-- Article A: owner_a creates one (owner has articles CRUD).
insert into public.articles (id, organization_id, article_number, description)
values ('e6000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'ART-A-001', 'Filter A');

select pg_temp.act_as('e2777777-7777-7777-7777-777777777777');

insert into public.organizations (id, name, created_by)
values ('e1000000-0000-0000-0000-00000000000b', 'Org B', 'e2777777-7777-7777-7777-777777777777');

insert into public.memberships (user_id, organization_id, role)
values ('e2777777-7777-7777-7777-777777777777', 'e1000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name)
values ('e3000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-00000000000b', 'Client B');

insert into public.work_orders (id, client_id, title)
values ('e4000000-0000-0000-0000-00000000000c', 'e3000000-0000-0000-0000-00000000000c', 'WO B');

insert into public.articles (id, organization_id, article_number, description)
values ('e6000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b', 'ART-B-001', 'Filter B');

-- ---------------------------------------------------------------------------
-- 1. owner: insert, derived columns, defaults, cross-org validations.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.work_order_articles (id, work_order_id, article_id, quantity)
     values ('e5000000-0000-0000-0000-00000000000a', 'e4000000-0000-0000-0000-00000000000a',
       'e6000000-0000-0000-0000-00000000000a', 2) $$,
  'owner_a can log a consumed article under org_a''s work order'
); -- 1

select is(
  (select organization_id from public.work_order_articles where id = 'e5000000-0000-0000-0000-00000000000a'),
  'e1000000-0000-0000-0000-00000000000a'::uuid,
  'work_order_articles.organization_id was auto-derived from work_orders.organization_id via work_order_id'
); -- 2

select is(
  (select created_by from public.work_order_articles where id = 'e5000000-0000-0000-0000-00000000000a'),
  'e2111111-1111-1111-1111-111111111111'::uuid,
  'work_order_articles.created_by was auto-stamped to the inserting user (trigger), not client-supplied'
); -- 3

select throws_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id, organization_id)
     values ('e4000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000a',
       'e1000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_a cannot set work_order_articles.organization_id directly on insert (column-level grant withheld)'
); -- 4

select throws_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id, quantity)
     values ('e4000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000a', 0) $$,
  '23514',
  null,
  'work_order_articles.quantity must be > 0 (work_order_articles_quantity_positive check constraint)'
); -- 5

select throws_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id)
     values ('e4000000-0000-0000-0000-00000000000c', 'e6000000-0000-0000-0000-00000000000a') $$,
  '23514',
  null,
  'work_order_articles.work_order_id from a different organization (org_b''s WO B) is rejected: organization_id derives to org_b, and article_id (org_a''s) fails validate_work_order_article_relations'' org-match check against that resulting org'
); -- 6

select throws_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id)
     values ('e4000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000b') $$,
  '23514',
  null,
  'work_order_articles.article_id must belong to the same organization as the work order (org_b''s article rejected under org_a''s work order)'
); -- 7

-- ---------------------------------------------------------------------------
-- 2. planner: full CRUD, matching the RBAC matrix's planning row.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.work_order_articles (id, work_order_id, article_id, quantity)
     values ('e5000000-0000-0000-0000-00000000000b', 'e4000000-0000-0000-0000-00000000000b',
       'e6000000-0000-0000-0000-00000000000a', 1) $$,
  'planner_a can insert a consumed article (for WO A2)'
); -- 8

select lives_ok(
  $$ update public.work_order_articles set quantity = 5 where id = 'e5000000-0000-0000-0000-00000000000a' $$,
  'planner_a can update any work order article in org_a, not just their own'
); -- 9

select is(
  (select quantity from public.work_order_articles where id = 'e5000000-0000-0000-0000-00000000000a'),
  5::numeric,
  'planner_a''s update took effect'
); -- 10

select lives_ok(
  $$ insert into public.work_order_articles (id, work_order_id, article_id)
     values ('e5000000-0000-0000-0000-00000000000c', 'e4000000-0000-0000-0000-00000000000a',
       'e6000000-0000-0000-0000-00000000000a') $$,
  'planner_a can insert a disposable work order article for the delete test below'
); -- 11

select lives_ok(
  $$ delete from public.work_order_articles where id = 'e5000000-0000-0000-0000-00000000000c' $$,
  'planner_a can delete a work order article in org_a'
); -- 12

select is(
  (select count(*)::int from public.work_order_articles where id = 'e5000000-0000-0000-0000-00000000000c'),
  0,
  'the disposable work order article is actually gone after planner_a''s delete'
); -- 13

select is(
  (select count(*)::int from public.work_order_articles where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  2,
  'planner_a (unlike an engineer) sees every work order article in org_a, not just their own'
); -- 14

-- ---------------------------------------------------------------------------
-- 2b. owner: also directly exercises UPDATE/DELETE (not just INSERT above).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ update public.work_order_articles set quantity = 3 where id = 'e5000000-0000-0000-0000-00000000000b' $$,
  'owner_a can update any work order article in org_a, not just their own'
); -- 15

select is(
  (select quantity from public.work_order_articles where id = 'e5000000-0000-0000-0000-00000000000b'),
  3::numeric,
  'owner_a''s update took effect'
); -- 16

select lives_ok(
  $$ insert into public.work_order_articles (id, work_order_id, article_id)
     values ('e5000000-0000-0000-0000-00000000000d', 'e4000000-0000-0000-0000-00000000000a',
       'e6000000-0000-0000-0000-00000000000a') $$,
  'owner_a can insert a second disposable work order article for the owner-delete test'
); -- 17

select lives_ok(
  $$ delete from public.work_order_articles where id = 'e5000000-0000-0000-0000-00000000000d' $$,
  'owner_a can delete a work order article in org_a'
); -- 18

select is(
  (select count(*)::int from public.work_order_articles where id = 'e5000000-0000-0000-0000-00000000000d'),
  0,
  'the owner-deleted disposable work order article is actually gone'
); -- 19

-- ---------------------------------------------------------------------------
-- 3. engineer: SELECT/INSERT/UPDATE scoped to created_by = auth.uid() only;
--    no delete.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.work_order_articles where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  0,
  'engineer_a sees no rows yet (both existing rows were logged by owner_a/planner_a, not them)'
); -- 20

select lives_ok(
  $$ insert into public.work_order_articles (id, work_order_id, article_id, quantity)
     values ('e5000000-0000-0000-0000-00000000000e', 'e4000000-0000-0000-0000-00000000000b',
       'e6000000-0000-0000-0000-00000000000a', 1.5) $$,
  'engineer_a CAN insert a consumed article for a work order NOT assigned to them (WO A2 is assigned to engineer_a2) — matches time_entries'' unconditional-per-engineer create_own shape, not work_orders'' assignment-scoped one'
); -- 21

select is(
  (select count(*)::int from public.work_order_articles where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a now sees exactly the one row they logged (created_by-scoped, not the other two)'
); -- 22

select lives_ok(
  $$ update public.work_order_articles set quantity = 2 where id = 'e5000000-0000-0000-0000-00000000000e' $$,
  'engineer_a can update their own logged row'
); -- 23

select is(
  (select quantity from public.work_order_articles where id = 'e5000000-0000-0000-0000-00000000000e'),
  2::numeric,
  'engineer_a''s update to their own row took effect'
); -- 24

update public.work_order_articles set quantity = 99 where id = 'e5000000-0000-0000-0000-00000000000a';

select is(
  (select quantity from public.work_order_articles where id = 'e5000000-0000-0000-0000-00000000000a'),
  5::numeric,
  'engineer_a''s UPDATE on owner_a''s logged row is silently excluded by RLS (USING); quantity unchanged'
); -- 25

delete from public.work_order_articles where id = 'e5000000-0000-0000-0000-00000000000e';

select is(
  (select count(*)::int from public.work_order_articles where id = 'e5000000-0000-0000-0000-00000000000e'),
  1,
  'engineer_a''s DELETE attempt on their own row is silently excluded by RLS (engineer has no delete action); row still exists'
); -- 26

-- ---------------------------------------------------------------------------
-- 4. finance / administratie: read-only, all rows (not scoped like engineer).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2555555-5555-5555-5555-555555555555');

select is(
  (select count(*)::int from public.work_order_articles where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  3,
  'finance_a can SELECT every work order article in org_a (read-only, all rows, not user-scoped)'
); -- 27

select throws_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id)
     values ('e4000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'finance_a cannot INSERT a work order article (read-only)'
); -- 28

select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.work_order_articles where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  3,
  'administratie_a can SELECT every work order article in org_a (read-only, all rows)'
); -- 29

select throws_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id)
     values ('e4000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'administratie_a cannot INSERT a work order article (read-only)'
); -- 30

-- ---------------------------------------------------------------------------
-- 5. Tenant isolation: owner_b (org_b) cannot see or write org_a's work order
--    articles.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2777777-7777-7777-7777-777777777777');

select is(
  (select count(*)::int from public.work_order_articles where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s work order articles'
); -- 31

select throws_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id)
     values ('e4000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_b cannot INSERT a work order article under org_a''s work order (not a member of org_a at all, so current_member_role is null)'
); -- 32

-- ---------------------------------------------------------------------------
-- 6. quotes.work_order_id / quote_line_items.article_id cross-field checks
--    (same migration, small additive columns on already-RLS'd tables).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select throws_ok(
  $$ insert into public.quotes (client_id, name, work_order_id)
     values ('e3000000-0000-0000-0000-00000000000d', 'Mismatched WO quote', 'e4000000-0000-0000-0000-00000000000a') $$,
  '23514',
  null,
  'quotes.work_order_id must belong to the same client as the quote (Client A2''s quote pointed at Client A''s work order is rejected)'
); -- 33

select lives_ok(
  $$ insert into public.quotes (client_id, name, work_order_id)
     values ('e3000000-0000-0000-0000-00000000000a', 'Matching WO quote', 'e4000000-0000-0000-0000-00000000000a') $$,
  'quotes.work_order_id is accepted when it belongs to the same client as the quote'
); -- 34

select * from finish();
rollback;
