-- pgTAP RLS tests for warehouses / warehouse_stock (issue #181,
-- 20260916090000_warehouses_and_stock.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/work_order_articles_rls.test.sql /
-- activity_notes_and_events_rls.test.sql: switch to the `authenticated` role
-- and set `request.jwt.claims` to simulate auth.uid() for a given fixture
-- user. All auth.users rows here are test fixtures, rolled back at the end
-- of the transaction.
--
-- Coverage: `ensure_engineer_warehouse` auto-creates a warehouse on a plain
-- INSERT of an engineer membership AND on an UPDATE OF role that promotes an
-- existing member to engineer; idempotency across a role flip away and back;
-- `derive_warehouse_default_name` (full_name, then email fallback);
-- `warehouses`/`warehouse_stock` RLS (owner/planner/administratie CRUD, all
-- rows — including round-tripped INSERT/DELETE proof for planner and
-- administratie, not just their pre-existing UPDATE access; engineer
-- read-own only; finance read-only); `warehouse_stock`'s organization_id/
-- user_id denormalization from warehouse_id; article_id/warehouse_id
-- cross-org rejection; quantity/min_threshold check constraints; the
-- (warehouse_id, article_id) unique constraint; `total_consumed` being
-- excluded from every client-facing write; the quantity-only vs.
-- quantity+last_counted_at write-path split; tenant isolation throughout.

begin;
create extension if not exists pgtap with schema extensions;

select plan(74);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with one of each relevant role, plus a member who starts
-- as planner and is later promoted to engineer, plus a spare member with no
-- warehouse yet. org_b for tenant isolation.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('e2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('e2333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('e2444444-4444-4444-4444-444444444444', 'engineer-a2@test.local'),
  ('e2555555-5555-5555-5555-555555555555', 'finance-a@test.local'),
  ('e2666666-6666-6666-6666-666666666666', 'administratie-a@test.local'),
  ('e2777777-7777-7777-7777-777777777777', 'owner-b@test.local'),
  ('e2888888-8888-8888-8888-888888888888', 'promo-a@test.local'),
  ('e2999999-9999-9999-9999-999999999999', 'extra-a@test.local'),
  ('e2aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'engineer-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- engineer_a has a full_name on file; every other user relies on the
-- users.email fallback in derive_warehouse_default_name.
select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ update public.users set full_name = 'Erik Engineer' where id = 'e2333333-3333-3333-3333-333333333333' $$,
  'engineer_a can set their own full_name (users_update_self)'
); -- 1

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('e1000000-0000-0000-0000-00000000000a', 'Org A', 'e2111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role) values
  ('e2111111-1111-1111-1111-111111111111', 'e1000000-0000-0000-0000-00000000000a', 'owner'),
  ('e2222222-2222-2222-2222-222222222222', 'e1000000-0000-0000-0000-00000000000a', 'planner'),
  ('e2333333-3333-3333-3333-333333333333', 'e1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('e2444444-4444-4444-4444-444444444444', 'e1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('e2555555-5555-5555-5555-555555555555', 'e1000000-0000-0000-0000-00000000000a', 'finance'),
  ('e2666666-6666-6666-6666-666666666666', 'e1000000-0000-0000-0000-00000000000a', 'administratie'),
  ('e2888888-8888-8888-8888-888888888888', 'e1000000-0000-0000-0000-00000000000a', 'planner');

insert into public.articles (id, organization_id, article_number, description)
values ('e6000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'ART-A-001', 'Filter A');

-- Second org_a article, used only by the planner/administratie
-- insert-then-delete round-trips in section 10 (widened warehouse_stock CRUD)
-- so they don't collide with article_a's already-stocked rows.
insert into public.articles (id, organization_id, article_number, description)
values ('e6000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-00000000000a', 'ART-A-002', 'Filter A2');

-- ---------------------------------------------------------------------------
-- 1. ensure_engineer_warehouse fires on a plain INSERT of an engineer
--    membership. promo_a (inserted as planner) has no warehouse yet.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  2,
  'exactly engineer_a and engineer_a2 got an auto-created warehouse on membership INSERT; promo_a (planner) did not'
); -- 2

select is(
  (select name from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2333333-3333-3333-3333-333333333333'),
  'Erik Engineer',
  'engineer_a''s warehouse defaulted its name from users.full_name'
); -- 3

select is(
  (select name from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2444444-4444-4444-4444-444444444444'),
  'engineer-a2@test.local',
  'engineer_a2''s warehouse defaulted its name from users.email (no full_name on file)'
); -- 4

select is(
  (select organization_id from public.warehouses where user_id = 'e2333333-3333-3333-3333-333333333333'),
  'e1000000-0000-0000-0000-00000000000a'::uuid,
  'engineer_a''s auto-created warehouse belongs to org_a'
); -- 5

select is(
  (select created_by from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2333333-3333-3333-3333-333333333333'),
  'e2111111-1111-1111-1111-111111111111'::uuid,
  'the auto-created warehouse''s created_by is stamped from the acting session (owner_a performed the membership insert), not the engineer'
); -- 6

select is(
  (select count(*)::int from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2888888-8888-8888-8888-888888888888'),
  0,
  'promo_a (still a planner) has no warehouse yet'
); -- 7

-- ---------------------------------------------------------------------------
-- 2. ensure_engineer_warehouse fires on an UPDATE OF role that promotes an
--    existing member to engineer, and is idempotent across a role flip away
--    and back.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update public.memberships set role = 'engineer'
     where user_id = 'e2888888-8888-8888-8888-888888888888'
       and organization_id = 'e1000000-0000-0000-0000-00000000000a' $$,
  'owner_a promotes promo_a to engineer'
); -- 8

select is(
  (select count(*)::int from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2888888-8888-8888-8888-888888888888'),
  1,
  'promo_a got a warehouse the moment their role became engineer (AFTER UPDATE OF role trigger)'
); -- 9

select is(
  (select name from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2888888-8888-8888-8888-888888888888'),
  'promo-a@test.local',
  'promo_a''s warehouse also defaulted its name from users.email'
); -- 10

select lives_ok(
  $$ update public.memberships set role = 'planner'
     where user_id = 'e2888888-8888-8888-8888-888888888888'
       and organization_id = 'e1000000-0000-0000-0000-00000000000a' $$,
  'owner_a flips promo_a back to planner (warehouse is not deleted/deactivated)'
); -- 11

select lives_ok(
  $$ update public.memberships set role = 'engineer'
     where user_id = 'e2888888-8888-8888-8888-888888888888'
       and organization_id = 'e1000000-0000-0000-0000-00000000000a' $$,
  'owner_a promotes promo_a back to engineer a second time'
); -- 12

select is(
  (select count(*)::int from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2888888-8888-8888-8888-888888888888'),
  1,
  'still exactly one warehouse for promo_a after the role flipped away and back (idempotent, no duplicate)'
); -- 13

-- ---------------------------------------------------------------------------
-- 3. Owner CRUD on warehouses: manual insert is possible (matching "Owner
--    CRUD"), a manual duplicate hits the unique constraint, the default-name
--    trigger applies uniformly, and non-owner roles cannot INSERT/DELETE.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.warehouses (organization_id, user_id)
     values ('e1000000-0000-0000-0000-00000000000a', 'e2333333-3333-3333-3333-333333333333') $$,
  '23505',
  null,
  'owner_a cannot manually create a second warehouse for engineer_a (unique (organization_id, user_id))'
); -- 14

select lives_ok(
  $$ insert into public.warehouses (id, organization_id, user_id)
     values ('e7000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'e2999999-9999-9999-9999-999999999999') $$,
  'owner_a can manually create a warehouse for extra_a, who has no membership at all (no membership-role validation at the DB layer)'
); -- 15

select is(
  (select name from public.warehouses where id = 'e7000000-0000-0000-0000-00000000000a'),
  'extra-a@test.local',
  'the manual insert also went through derive_warehouse_default_name (name omitted, defaulted from email)'
); -- 16

select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.warehouses (id, organization_id, user_id)
     values ('e7000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a', 'e2666666-6666-6666-6666-666666666666') $$,
  'planner_a can INSERT a warehouse (widened matrix: planner CRUD, not owner-only)'
); -- 17

select is(
  (select organization_id from public.warehouses where id = 'e7000000-0000-0000-0000-00000000000b'),
  'e1000000-0000-0000-0000-00000000000a'::uuid,
  'the planner-created warehouse (for administratie_a) belongs to org_a'
); -- 18

select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');

select lives_ok(
  $$ insert into public.warehouses (id, organization_id, user_id)
     values ('e7000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-00000000000a', 'e2555555-5555-5555-5555-555555555555') $$,
  'administratie_a can INSERT a warehouse too (widened matrix: administratie CRUD, not owner-only)'
); -- 19

-- ---------------------------------------------------------------------------
-- 4. warehouses UPDATE: owner/planner/administratie can rename any row;
--    engineer/finance cannot (silently excluded by RLS, not an error).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ update public.warehouses set name = 'Van der Berg magazijn' where user_id = 'e2333333-3333-3333-3333-333333333333' $$,
  'owner_a can rename engineer_a''s warehouse'
); -- 20

select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ update public.warehouses set name = 'Magazijn 2' where user_id = 'e2444444-4444-4444-4444-444444444444' $$,
  'planner_a can rename engineer_a2''s warehouse'
); -- 21

select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');

select lives_ok(
  $$ update public.warehouses set name = 'Magazijn Promo' where user_id = 'e2888888-8888-8888-8888-888888888888' $$,
  'administratie_a can rename promo_a''s warehouse'
); -- 22

select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

update public.warehouses set name = 'Hacked name' where user_id = 'e2333333-3333-3333-3333-333333333333';

select is(
  (select name from public.warehouses where user_id = 'e2333333-3333-3333-3333-333333333333'),
  'Van der Berg magazijn',
  'engineer_a''s UPDATE on their own warehouse is silently excluded by RLS (engineer has no write action, read-only)'
); -- 23

select pg_temp.act_as('e2555555-5555-5555-5555-555555555555');

update public.warehouses set name = 'Hacked name' where user_id = 'e2444444-4444-4444-4444-444444444444';

select is(
  (select name from public.warehouses where user_id = 'e2444444-4444-4444-4444-444444444444'),
  'Magazijn 2',
  'finance_a''s UPDATE attempt is silently excluded by RLS (read-only)'
); -- 24

-- ---------------------------------------------------------------------------
-- 5. warehouses SELECT scoping: owner/planner/administratie/finance see
--    every row in org_a; engineer sees only their own. Six rows at this
--    point: engineer_a, engineer_a2, promo_a (auto-created) + extra_a
--    (owner-created), administratie_a (planner-created), finance_a
--    (administratie-created) — the last two proving section 3's widened
--    INSERT actually landed real rows, not just avoided an error.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  6,
  'owner_a sees every warehouse in org_a (engineer_a, engineer_a2, promo_a, extra_a, administratie_a, finance_a)'
); -- 25

select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  6,
  'planner_a sees every warehouse in org_a too'
); -- 26

select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  6,
  'administratie_a sees every warehouse in org_a too'
); -- 27

select pg_temp.act_as('e2555555-5555-5555-5555-555555555555');

select is(
  (select count(*)::int from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  6,
  'finance_a sees every warehouse in org_a (read-only, all rows)'
); -- 28

select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a sees exactly their own warehouse, not the other five'
); -- 29

select is(
  (select count(*)::int from public.warehouses where id = (select id from public.warehouses where user_id = 'e2444444-4444-4444-4444-444444444444')),
  0,
  'engineer_a cannot see engineer_a2''s warehouse specifically'
); -- 30

select pg_temp.act_as('e2444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a2 sees exactly their own warehouse (proves per-engineer scoping, not just "the first one")'
); -- 31

-- ---------------------------------------------------------------------------
-- 6. warehouses DELETE: widened to owner/planner/administratie (see design
--    note 5). Each of the three deletes a row it has access to (planner and
--    administratie each clean up the row THEY created in section 3, proving
--    DELETE is really granted and not just a no-op RLS pass-through); engineer
--    still cannot delete even their own warehouse (read-only role, unaffected
--    by the widened matrix).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ delete from public.warehouses where id = 'e7000000-0000-0000-0000-00000000000b' $$,
  'planner_a can DELETE a warehouse (widened matrix: planner CRUD, not owner-only) — deletes the one it created for administratie_a'
); -- 32

select is(
  (select count(*)::int from public.warehouses where id = 'e7000000-0000-0000-0000-00000000000b'),
  0,
  'the planner-deleted warehouse is actually gone'
); -- 33

select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');

select lives_ok(
  $$ delete from public.warehouses where id = 'e7000000-0000-0000-0000-00000000000c' $$,
  'administratie_a can DELETE a warehouse too (widened matrix) — deletes the one it created for finance_a'
); -- 34

select is(
  (select count(*)::int from public.warehouses where id = 'e7000000-0000-0000-0000-00000000000c'),
  0,
  'the administratie-deleted warehouse is actually gone'
); -- 35

select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

delete from public.warehouses where user_id = 'e2333333-3333-3333-3333-333333333333';

select is(
  (select count(*)::int from public.warehouses where user_id = 'e2333333-3333-3333-3333-333333333333'),
  1,
  'engineer_a''s DELETE attempt on their OWN warehouse is silently excluded by RLS (engineer has no delete action at all, unaffected by the widened matrix); row still exists'
); -- 36

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ delete from public.warehouses where id = 'e7000000-0000-0000-0000-00000000000a' $$,
  'owner_a can delete extra_a''s warehouse'
); -- 37

select is(
  (select count(*)::int from public.warehouses where id = 'e7000000-0000-0000-0000-00000000000a'),
  0,
  'the owner-deleted warehouse is actually gone'
); -- 38

-- ---------------------------------------------------------------------------
-- 7. Tenant isolation: org_b, with its own auto-created engineer warehouse.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2777777-7777-7777-7777-777777777777');

insert into public.organizations (id, name, created_by)
values ('e1000000-0000-0000-0000-00000000000b', 'Org B', 'e2777777-7777-7777-7777-777777777777');

insert into public.memberships (user_id, organization_id, role) values
  ('e2777777-7777-7777-7777-777777777777', 'e1000000-0000-0000-0000-00000000000b', 'owner'),
  ('e2aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1000000-0000-0000-0000-00000000000b', 'engineer');

insert into public.articles (id, organization_id, article_number, description)
values ('e6000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b', 'ART-B-001', 'Filter B');

select is(
  (select count(*)::int from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000b'),
  1,
  'engineer_b also got an auto-created warehouse, scoped to org_b'
); -- 39

select is(
  (select count(*)::int from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT any of org_a''s warehouses'
); -- 40

select throws_ok(
  $$ insert into public.warehouses (organization_id, user_id)
     values ('e1000000-0000-0000-0000-00000000000a', 'e2777777-7777-7777-7777-777777777777') $$,
  '42501',
  null,
  'owner_b cannot INSERT a warehouse under org_a (not a member of org_a at all, so current_member_role is null)'
); -- 41

-- ---------------------------------------------------------------------------
-- 8. warehouse_stock: insert, denormalization, cross-org rejections, checks.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.warehouse_stock (id, warehouse_id, article_id, quantity, min_threshold)
     values ('e8000000-0000-0000-0000-00000000000a',
       (select id from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2333333-3333-3333-3333-333333333333'),
       'e6000000-0000-0000-0000-00000000000a', 10, 2) $$,
  'owner_a adds article_a to engineer_a''s warehouse'
); -- 42

select is(
  (select organization_id from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  'e1000000-0000-0000-0000-00000000000a'::uuid,
  'warehouse_stock.organization_id was auto-derived from the warehouse'
); -- 43

select is(
  (select user_id from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  'e2333333-3333-3333-3333-333333333333'::uuid,
  'warehouse_stock.user_id was auto-derived (denormalized) from the warehouse''s own engineer'
); -- 44

select is(
  (select created_by from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  'e2111111-1111-1111-1111-111111111111'::uuid,
  'warehouse_stock.created_by was auto-stamped to the inserting owner'
); -- 45

select is(
  (select total_consumed from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  0::numeric,
  'total_consumed defaults to 0'
); -- 46

select throws_ok(
  $$ insert into public.warehouse_stock (warehouse_id, article_id)
     values (
       (select id from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2333333-3333-3333-3333-333333333333'),
       'e6000000-0000-0000-0000-00000000000b') $$,
  '23514',
  null,
  'warehouse_stock.article_id from a different organization (org_b''s article) is rejected under org_a''s warehouse'
); -- 47

select throws_ok(
  $$ insert into public.warehouse_stock (warehouse_id, article_id)
     values (
       (select id from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000b' and user_id = 'e2aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       'e6000000-0000-0000-0000-00000000000a') $$,
  '23514',
  null,
  'warehouse_stock.warehouse_id from a different organization (org_b''s warehouse) is rejected: organization_id derives to org_b, and org_a''s article_id fails the resulting org-match check'
); -- 48

select throws_ok(
  $$ insert into public.warehouse_stock (warehouse_id, article_id, quantity)
     values (
       (select id from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2444444-4444-4444-4444-444444444444'),
       'e6000000-0000-0000-0000-00000000000a', -1) $$,
  '23514',
  null,
  'warehouse_stock.quantity must be >= 0 (warehouse_stock_quantity_non_negative check constraint) — targets engineer_a2''s (still-empty) warehouse to avoid colliding with engineer_a''s already-inserted article_a row'
); -- 49

select throws_ok(
  $$ insert into public.warehouse_stock (warehouse_id, article_id, min_threshold)
     values (
       (select id from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2444444-4444-4444-4444-444444444444'),
       'e6000000-0000-0000-0000-00000000000a', -1) $$,
  '23514',
  null,
  'warehouse_stock.min_threshold must be >= 0 when set (warehouse_stock_min_threshold_non_negative check constraint)'
); -- 50

select throws_ok(
  $$ insert into public.warehouse_stock (warehouse_id, article_id)
     values (
       (select id from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2333333-3333-3333-3333-333333333333'),
       'e6000000-0000-0000-0000-00000000000a') $$,
  '23505',
  null,
  'duplicate (warehouse_id, article_id) is rejected (unique constraint) — article_a is already stocked in engineer_a''s warehouse'
); -- 51

select throws_ok(
  $$ update public.warehouse_stock set total_consumed = 5 where id = 'e8000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'owner_a cannot UPDATE total_consumed directly (column-level grant withheld — read-only from every client-facing path today)'
); -- 52

-- ---------------------------------------------------------------------------
-- 9. The quantity-only vs. quantity+last_counted_at write-path split: the
--    schema lets an UPDATE touch quantity alone (the future automatic
--    deduction shape) OR quantity plus last_counted_at together (a human
--    manual count) — which path is used is an application-layer choice, not
--    something this schema infers.
-- ---------------------------------------------------------------------------
select is(
  (select last_counted_at from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  null::timestamptz,
  'last_counted_at starts out null (never set at insert time in this fixture)'
); -- 53

select lives_ok(
  $$ update public.warehouse_stock set quantity = 8 where id = 'e8000000-0000-0000-0000-00000000000a' $$,
  'owner_a updates quantity alone (the shape a future automatic deduction would use)'
); -- 54

select is(
  (select last_counted_at from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  null::timestamptz,
  'last_counted_at is untouched by a quantity-only UPDATE'
); -- 55

select lives_ok(
  $$ update public.warehouse_stock set quantity = 9, last_counted_at = now() where id = 'e8000000-0000-0000-0000-00000000000a' $$,
  'owner_a updates quantity AND last_counted_at together (the shape a human manual count would use)'
); -- 56

select isnt(
  (select last_counted_at from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  null::timestamptz,
  'last_counted_at is now stamped, since this UPDATE''s own column list explicitly included it'
); -- 57

-- ---------------------------------------------------------------------------
-- 10. warehouse_stock RLS: widened to owner/planner/administratie CRUD (see
--     design note 5) — planner and administratie each round-trip an
--     insert-then-delete on a throwaway row (article_c, engineer_a2's
--     warehouse) to prove INSERT/DELETE are really granted, not just a no-op
--     RLS pass-through, alongside their pre-existing UPDATE access; finance
--     stays read-only; engineer stays read-own with no write at all.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ update public.warehouse_stock set min_threshold = 3 where id = 'e8000000-0000-0000-0000-00000000000a' $$,
  'planner_a can UPDATE an existing warehouse_stock row'
); -- 58

select lives_ok(
  $$ insert into public.warehouse_stock (id, warehouse_id, article_id)
     values ('e8000000-0000-0000-0000-00000000000c',
       (select id from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2444444-4444-4444-4444-444444444444'),
       'e6000000-0000-0000-0000-00000000000c') $$,
  'planner_a can INSERT a new warehouse_stock row (widened matrix: planner CRUD, not owner-only)'
); -- 59

select lives_ok(
  $$ delete from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000c' $$,
  'planner_a can DELETE the row it just inserted (widened matrix)'
); -- 60

select is(
  (select count(*)::int from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000c'),
  0,
  'the planner insert-then-delete round-trip actually left no row behind'
); -- 61

select pg_temp.act_as('e2666666-6666-6666-6666-666666666666');

select lives_ok(
  $$ update public.warehouse_stock set min_threshold = 4 where id = 'e8000000-0000-0000-0000-00000000000a' $$,
  'administratie_a can UPDATE an existing warehouse_stock row too'
); -- 62

select lives_ok(
  $$ insert into public.warehouse_stock (id, warehouse_id, article_id)
     values ('e8000000-0000-0000-0000-00000000000c',
       (select id from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2444444-4444-4444-4444-444444444444'),
       'e6000000-0000-0000-0000-00000000000c') $$,
  'administratie_a can INSERT a new warehouse_stock row too (widened matrix)'
); -- 63

select lives_ok(
  $$ delete from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000c' $$,
  'administratie_a can DELETE the row it just inserted (widened matrix)'
); -- 64

select is(
  (select count(*)::int from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000c'),
  0,
  'the administratie insert-then-delete round-trip actually left no row behind'
); -- 65

-- ---------------------------------------------------------------------------
-- 11. warehouse_stock SELECT scoping: this is the whole point of denormalizing
--     user_id onto warehouse_stock — an engineer sees only THEIR OWN
--     warehouse's stock rows, not another engineer's, with no in-policy join.
--     Plus tenant isolation for this table specifically.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.warehouse_stock (id, warehouse_id, article_id, quantity)
     values ('e8000000-0000-0000-0000-00000000000b',
       (select id from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2444444-4444-4444-4444-444444444444'),
       'e6000000-0000-0000-0000-00000000000a', 5) $$,
  'owner_a adds article_a to engineer_a2''s warehouse too, so per-engineer scoping is meaningfully testable'
); -- 66

select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.warehouse_stock where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a sees exactly one warehouse_stock row (their own warehouse''s), not engineer_a2''s'
); -- 67

select is(
  (select count(*)::int from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000b'),
  0,
  'engineer_a cannot see engineer_a2''s specific warehouse_stock row'
); -- 68

select pg_temp.act_as('e2444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from public.warehouse_stock where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a2 sees exactly one warehouse_stock row (their own warehouse''s), not engineer_a''s'
); -- 69

select pg_temp.act_as('e2555555-5555-5555-5555-555555555555');

select is(
  (select count(*)::int from public.warehouse_stock where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  2,
  'finance_a sees BOTH warehouse_stock rows in org_a (read-only, not user-scoped like engineer)'
); -- 70

update public.warehouse_stock set min_threshold = 99 where id = 'e8000000-0000-0000-0000-00000000000b';

select is(
  (select min_threshold from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000b'),
  null::numeric,
  'finance_a''s UPDATE attempt is silently excluded by RLS (read-only), despite the table-level UPDATE grant authenticated holds'
); -- 71

select pg_temp.act_as('e2777777-7777-7777-7777-777777777777');

select is(
  (select count(*)::int from public.warehouse_stock where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT any of org_a''s warehouse_stock rows'
); -- 72

select throws_ok(
  $$ insert into public.warehouse_stock (warehouse_id, article_id)
     values (
       (select id from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2333333-3333-3333-3333-333333333333'),
       'e6000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_b cannot INSERT a warehouse_stock row under org_a''s warehouse (not a member of org_a at all)'
); -- 73

select is(
  (select count(*)::int from public.warehouse_stock where organization_id = 'e1000000-0000-0000-0000-00000000000b'),
  0,
  'org_b has no warehouse_stock rows of its own in this fixture (sanity check — org_b''s engineer_b warehouse was never stocked)'
); -- 74

select * from finish();
rollback;
