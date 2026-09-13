-- pgTAP tests for the warehouse stock consumption deduction trigger (issue
-- #182, "[Story] Synchronisatie voorraad monteur",
-- 20260917090000_warehouse_stock_consumption.sql) — the
-- work_order_articles -> warehouse_stock deduction hook, second of the
-- three-story sequence 20260916090000_warehouses_and_stock.sql (issue #181)
-- started.
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/warehouses_and_stock_rls.test.sql /
-- work_order_articles_rls.test.sql: switch to the `authenticated` role and
-- set `request.jwt.claims` to simulate auth.uid() for a given fixture user.
-- All auth.users rows here are test fixtures, rolled back at the end of the
-- transaction.
--
-- Coverage: (a) normal deduction — quantity decreases, total_consumed
-- increases, last_counted_at stays untouched, including across a
-- subsequent manual-count UPDATE that DOES set last_counted_at (proving the
-- automatic path never clobbers it either way); (b) deduction floors at 0
-- while total_consumed still records the FULL consumed amount when
-- consumption exceeds available quantity; (c) no-op (insert still succeeds,
-- no stray row created) when no matching warehouse_stock row exists for the
-- consumed article in the assigned engineer's warehouse; (d) no-op when the
-- work order has no assigned engineer at all, AND when the assignee is a
-- member but NOT currently an 'engineer' (a planner assigned to their own
-- work order); (e) no-op when the assigned engineer has no warehouse row at
-- all (a historical edge case, simulated by deleting an auto-created one);
-- (f) cross-org safety — an org_b consumption never touches any org_a
-- warehouse_stock row, and vice versa.

begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with owner/planner/two engineers (engineer_a stocked,
-- engineer_a3 used for the "no warehouse" edge case), org_b for the
-- cross-org section.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('e2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('e2333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('e2999999-9999-9999-9999-999999999999', 'engineer-a3@test.local'),
  ('e2777777-7777-7777-7777-777777777777', 'owner-b@test.local'),
  ('e2aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'engineer-b@test.local');

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
  ('e2999999-9999-9999-9999-999999999999', 'e1000000-0000-0000-0000-00000000000a', 'engineer');

insert into public.clients (id, organization_id, name)
values ('e3000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'Client A');

-- article_a is stocked in engineer_a's warehouse below; article_b never is —
-- used for the "no matching warehouse_stock row" no-op case.
insert into public.articles (id, organization_id, article_number, description) values
  ('e6000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'ART-A-001', 'Filter A'),
  ('e6000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000a', 'ART-A-002', 'Filter B');

insert into public.work_orders (id, client_id, title, assigned_to) values
  ('e4000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000a', 'WO engineer_a', 'e2333333-3333-3333-3333-333333333333'),
  ('e4000000-0000-0000-0000-00000000000b', 'e3000000-0000-0000-0000-00000000000a', 'WO unassigned', null),
  ('e4000000-0000-0000-0000-00000000000c', 'e3000000-0000-0000-0000-00000000000a', 'WO planner-assigned', 'e2222222-2222-2222-2222-222222222222'),
  ('e4000000-0000-0000-0000-00000000000d', 'e3000000-0000-0000-0000-00000000000a', 'WO engineer_a3', 'e2999999-9999-9999-9999-999999999999');

insert into public.warehouse_stock (id, warehouse_id, article_id, quantity, min_threshold)
values (
  'e8000000-0000-0000-0000-00000000000a',
  (select id from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2333333-3333-3333-3333-333333333333'),
  'e6000000-0000-0000-0000-00000000000a',
  10, 2
);

-- ---------------------------------------------------------------------------
-- 1. Normal deduction: engineer_a consumes 3 of article_a on their own
--    assigned work order. quantity decreases, total_consumed increases by
--    the same amount, last_counted_at stays untouched (still null).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id, quantity)
     values ('e4000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000a', 3) $$,
  'engineer_a logs 3 consumed article_a on their own assigned work order'
); -- 1

select is(
  (select quantity from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  7::numeric,
  'quantity decreased by the consumed amount (10 - 3 = 7)'
); -- 2

select is(
  (select total_consumed from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  3::numeric,
  'total_consumed increased by the full consumed amount'
); -- 3

select is(
  (select last_counted_at from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  null::timestamptz,
  'last_counted_at stays null — the automatic deduction path never touches it'
); -- 4

-- ---------------------------------------------------------------------------
-- 2. Floors at 0: consuming 20 more than the current 7 on hand must not
--    raise warehouse_stock_quantity_non_negative (which would abort the
--    triggering INSERT). total_consumed still records the full 20.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id, quantity)
     values ('e4000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000a', 20) $$,
  'engineer_a logs a second consumption of 20 — more than the 7 currently on hand'
); -- 5

select is(
  (select quantity from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  0::numeric,
  'quantity floors at 0 rather than going negative (GREATEST(0, 7 - 20))'
); -- 6

select is(
  (select total_consumed from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  23::numeric,
  'total_consumed still records the FULL consumed amount (3 + 20 = 23), independent of the floor'
); -- 7

select is(
  (select last_counted_at from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  null::timestamptz,
  'last_counted_at still untouched after the floored deduction'
); -- 8

-- ---------------------------------------------------------------------------
-- 3. A human manual count (quantity + last_counted_at together) followed by
--    another automatic deduction: the automatic path must leave the
--    manually-set last_counted_at exactly as-is, never resetting or
--    re-stamping it.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ update public.warehouse_stock
       set quantity = 10, last_counted_at = '2026-01-01 00:00:00+00'
     where id = 'e8000000-0000-0000-0000-00000000000a' $$,
  'owner_a performs a manual count correction (quantity + last_counted_at together)'
); -- 9

select is(
  (select last_counted_at from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  '2026-01-01 00:00:00+00'::timestamptz,
  'last_counted_at was set by the manual count UPDATE'
); -- 10

select pg_temp.act_as('e2333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id, quantity)
     values ('e4000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000a', 4) $$,
  'engineer_a logs a third consumption after the manual count correction'
); -- 11

select is(
  (select quantity from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  6::numeric,
  'quantity decreased from the manually-corrected 10 (10 - 4 = 6)'
); -- 12

select is(
  (select total_consumed from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  27::numeric,
  'total_consumed kept accumulating across the manual correction (23 + 4 = 27)'
); -- 13

select is(
  (select last_counted_at from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  '2026-01-01 00:00:00+00'::timestamptz,
  'last_counted_at is UNCHANGED by the automatic deduction — the manual-count timestamp survives'
); -- 14

-- ---------------------------------------------------------------------------
-- 4. No matching warehouse_stock row: engineer_a consumes article_b, which
--    was never added to their warehouse. Insert succeeds, no stray row is
--    created.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id, quantity)
     values ('e4000000-0000-0000-0000-00000000000a', 'e6000000-0000-0000-0000-00000000000b', 5) $$,
  'engineer_a logs a consumption of article_b, which is not stocked in their warehouse — must not error'
); -- 15

select is(
  (select count(*)::int from public.warehouse_stock
     where warehouse_id = (select id from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000a' and user_id = 'e2333333-3333-3333-3333-333333333333')
       and article_id = 'e6000000-0000-0000-0000-00000000000b'),
  0,
  'no warehouse_stock row was created for article_b — silent no-op, not an auto-created row with a guessed quantity'
); -- 16

-- ---------------------------------------------------------------------------
-- 5. No assigned engineer at all: consuming an article on an unassigned
--    work order must be a safe no-op (and must NOT accidentally touch
--    engineer_a's own article_a stock, which happens to be the same
--    article).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id, quantity)
     values ('e4000000-0000-0000-0000-00000000000b', 'e6000000-0000-0000-0000-00000000000a', 2) $$,
  'engineer_a logs a consumption on the UNASSIGNED work order — must not error'
); -- 17

select is(
  (select quantity from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  6::numeric,
  'engineer_a''s own article_a stock is untouched by the unassigned work order''s consumption'
); -- 18

-- ---------------------------------------------------------------------------
-- 6. Assignee is a member but NOT an engineer: a work order assigned to
--    planner_a (a planner created a work order for themselves). Consuming
--    the SAME article_a must still be a no-op — no warehouse resolves for a
--    non-engineer assignee, and engineer_a's own stock stays untouched.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id, quantity)
     values ('e4000000-0000-0000-0000-00000000000c', 'e6000000-0000-0000-0000-00000000000a', 1) $$,
  'planner_a logs a consumption on their own planner-assigned work order — must not error'
); -- 19

select is(
  (select quantity from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  6::numeric,
  'engineer_a''s article_a stock is untouched — the assignee (planner_a) is not an engineer, so nothing resolves'
); -- 20

-- ---------------------------------------------------------------------------
-- 7. Assigned engineer has no warehouse at all (historical edge case):
--    delete engineer_a3's auto-created warehouse first, then have them log a
--    consumption on their own assigned work order.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ delete from public.warehouses where user_id = 'e2999999-9999-9999-9999-999999999999' $$,
  'owner_a deletes engineer_a3''s auto-created warehouse, simulating the historical no-warehouse edge case'
); -- 21

select is(
  (select count(*)::int from public.warehouses where user_id = 'e2999999-9999-9999-9999-999999999999'),
  0,
  'engineer_a3 now has no warehouse at all'
); -- 22

select pg_temp.act_as('e2999999-9999-9999-9999-999999999999');

select lives_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id, quantity)
     values ('e4000000-0000-0000-0000-00000000000d', 'e6000000-0000-0000-0000-00000000000a', 5) $$,
  'engineer_a3 logs a consumption despite having no warehouse — must not error'
); -- 23

select is(
  (select count(*)::int from public.warehouse_stock where user_id = 'e2999999-9999-9999-9999-999999999999'),
  0,
  'no warehouse_stock row exists (or was created) for engineer_a3 — nothing to resolve into'
); -- 24

select is(
  (select count(*)::int from public.warehouse_stock where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  1,
  'org_a still has exactly the one pre-existing warehouse_stock row — none of the no-op cases (article_b, unassigned, non-engineer assignee, no warehouse) created a stray row'
); -- 25

-- ---------------------------------------------------------------------------
-- 8. Cross-org safety: org_b's own engineer/warehouse/consumption never
--    touches org_a's warehouse_stock, and vice versa.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('e2777777-7777-7777-7777-777777777777');

insert into public.organizations (id, name, created_by)
values ('e1000000-0000-0000-0000-00000000000b', 'Org B', 'e2777777-7777-7777-7777-777777777777');

insert into public.memberships (user_id, organization_id, role) values
  ('e2777777-7777-7777-7777-777777777777', 'e1000000-0000-0000-0000-00000000000b', 'owner'),
  ('e2aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'e1000000-0000-0000-0000-00000000000b', 'engineer');

insert into public.clients (id, organization_id, name)
values ('e3000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b', 'Client B');

insert into public.articles (id, organization_id, article_number, description)
values ('e6000000-0000-0000-0000-00000000000c', 'e1000000-0000-0000-0000-00000000000b', 'ART-B-001', 'Filter B (org B)');

insert into public.work_orders (id, client_id, title, assigned_to)
values ('e4000000-0000-0000-0000-00000000000e', 'e3000000-0000-0000-0000-00000000000b', 'WO engineer_b', 'e2aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select lives_ok(
  $$ insert into public.warehouse_stock (id, warehouse_id, article_id, quantity)
     values (
       'e8000000-0000-0000-0000-00000000000b',
       (select id from public.warehouses where organization_id = 'e1000000-0000-0000-0000-00000000000b' and user_id = 'e2aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
       'e6000000-0000-0000-0000-00000000000c',
       5
     ) $$,
  'owner_b stocks article_c in engineer_b''s warehouse'
); -- 26

select pg_temp.act_as('e2aaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select lives_ok(
  $$ insert into public.work_order_articles (work_order_id, article_id, quantity)
     values ('e4000000-0000-0000-0000-00000000000e', 'e6000000-0000-0000-0000-00000000000c', 2) $$,
  'engineer_b logs a consumption of article_c on their own org_b work order'
); -- 27

select is(
  (select quantity from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000b'),
  3::numeric,
  'org_b''s warehouse_stock row was correctly deducted (5 - 2 = 3)'
); -- 28

select is(
  (select total_consumed from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000b'),
  2::numeric,
  'org_b''s warehouse_stock total_consumed recorded the consumption'
); -- 29

select pg_temp.act_as('e2111111-1111-1111-1111-111111111111');

select is(
  (select quantity from public.warehouse_stock where id = 'e8000000-0000-0000-0000-00000000000a'),
  6::numeric,
  'org_a''s warehouse_stock row is completely unaffected by org_b''s consumption — cross-org isolation holds'
); -- 30

select is(
  (select count(*)::int from public.warehouse_stock where organization_id = 'e1000000-0000-0000-0000-00000000000a'),
  1,
  'org_a still has exactly one warehouse_stock row after org_b''s activity — no cross-org row leaked in'
); -- 31

select pg_temp.act_as('e2777777-7777-7777-7777-777777777777');

select is(
  (select count(*)::int from public.warehouse_stock where organization_id = 'e1000000-0000-0000-0000-00000000000b'),
  1,
  'org_b has exactly the one warehouse_stock row it created — no org_a activity ever touched it'
); -- 32

select * from finish();
rollback;
