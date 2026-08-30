-- pgTAP RLS tests for the engineer/client custom rate override columns
-- (issue #93, "Reistijd en werktijd artikelen beheren" --
-- 20260830090000_engineer_client_rate_overrides.sql): the 5-column
-- has_custom_rate/travel_article_id/work_article_id/travel_sale_price/
-- work_sale_price shape shared, identically, by public.memberships and
-- public.clients.
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/articles_rls.test.sql and
-- supabase/tests/database/clients_sites_assets_rls.test.sql: switch to the
-- authenticated role and set request.jwt.claims to simulate auth.uid()
-- for a given fixture user. All auth.users rows here are test fixtures,
-- rolled back at the end of the transaction.
--
-- This migration added NO new RLS policies (both tables reuse their
-- existing owner-only write policies unchanged -- see the migration's design
-- note 4). What is new and needs coverage here is: the two
-- *_custom_rate_requires_articles CHECK constraints, the two
-- non-negative-price CHECK constraints per table, and the shared
-- validate_rate_override_articles trigger's cross-org/dangling-reference
-- rejection on BOTH INSERT and UPDATE, on BOTH tables. Cross-tenant
-- read/write isolation on these specific columns is also verified
-- end-to-end (not just assumed to be inherited from the pre-existing
-- clients_update_owner/memberships_update_owner policies).
--
-- Note on RLS semantics: a USING clause violation on UPDATE does NOT raise
-- an error -- the row is silently excluded (0 rows changed). Only INSERT/
-- UPDATE WITH CHECK violations (and CHECK constraint / trigger
-- violations) raise an error.

begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a (owner_a, planner_a, engineer_a) + org_b (owner_b), one
-- Travel-time and one Work-time article per org, and one client in org_a.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('e9111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('e9222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('e9333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('e9444444-4444-4444-4444-444444444444', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('e9111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('e9000000-0000-0000-0000-00000000000a', 'Org A', 'e9111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role)
values ('e9111111-1111-1111-1111-111111111111', 'e9000000-0000-0000-0000-00000000000a', 'owner');

insert into public.memberships (user_id, organization_id, role) values
  ('e9222222-2222-2222-2222-222222222222', 'e9000000-0000-0000-0000-00000000000a', 'planner'),
  ('e9333333-3333-3333-3333-333333333333', 'e9000000-0000-0000-0000-00000000000a', 'engineer');

insert into public.articles (id, organization_id, article_number, description) values
  ('e9500000-0000-0000-0000-00000000000a', 'e9000000-0000-0000-0000-00000000000a', 'TRAVEL-A', 'Travel time org A'),
  ('e9500000-0000-0000-0000-00000000000b', 'e9000000-0000-0000-0000-00000000000a', 'WORK-A', 'Work time org A');

insert into public.clients (id, organization_id, name)
values ('e9600000-0000-0000-0000-00000000000a', 'e9000000-0000-0000-0000-00000000000a', 'Client A');

select pg_temp.act_as('e9444444-4444-4444-4444-444444444444');

insert into public.organizations (id, name, created_by)
values ('e9000000-0000-0000-0000-00000000000b', 'Org B', 'e9444444-4444-4444-4444-444444444444');

insert into public.memberships (user_id, organization_id, role)
values ('e9444444-4444-4444-4444-444444444444', 'e9000000-0000-0000-0000-00000000000b', 'owner');

insert into public.articles (id, organization_id, article_number, description)
values ('e9500000-0000-0000-0000-00000000000c', 'e9000000-0000-0000-0000-00000000000b', 'TRAVEL-B', 'Travel time org B');

select pg_temp.act_as('e9111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 1. public.memberships (engineer_a rate override)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update public.memberships set has_custom_rate = true
     where user_id = 'e9333333-3333-3333-3333-333333333333'
       and organization_id = 'e9000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'memberships: has_custom_rate true with both article ids still null is rejected (memberships_custom_rate_requires_articles)'
); -- 1

select throws_ok(
  $$ update public.memberships
       set has_custom_rate = true, travel_article_id = 'e9500000-0000-0000-0000-00000000000a'
     where user_id = 'e9333333-3333-3333-3333-333333333333'
       and organization_id = 'e9000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'memberships: has_custom_rate true with only travel_article_id set is rejected'
); -- 2

select throws_ok(
  $$ update public.memberships
       set has_custom_rate = true,
           travel_article_id = 'e9500000-0000-0000-0000-00000000000a',
           work_article_id = 'e9500000-0000-0000-0000-00000000000b',
           travel_sale_price = -5
     where user_id = 'e9333333-3333-3333-3333-333333333333'
       and organization_id = 'e9000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'memberships: negative travel_sale_price is rejected (memberships_travel_sale_price_non_negative)'
); -- 3

select throws_ok(
  $$ update public.memberships
       set travel_article_id = 'e9500000-0000-0000-0000-00000000000c'
     where user_id = 'e9333333-3333-3333-3333-333333333333'
       and organization_id = 'e9000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'memberships: travel_article_id pointing at org_b article is rejected (validate_rate_override_articles, cross-org)'
); -- 4

select throws_ok(
  $$ update public.memberships
       set work_article_id = gen_random_uuid()
     where user_id = 'e9333333-3333-3333-3333-333333333333'
       and organization_id = 'e9000000-0000-0000-0000-00000000000a' $$,
  '23503',
  null,
  'memberships: work_article_id pointing at a nonexistent article is rejected as dangling (validate_rate_override_articles)'
); -- 5

select lives_ok(
  $$ update public.memberships
       set has_custom_rate = true,
           travel_article_id = 'e9500000-0000-0000-0000-00000000000a',
           work_article_id = 'e9500000-0000-0000-0000-00000000000b',
           travel_sale_price = 12.50,
           work_sale_price = 45.00
     where user_id = 'e9333333-3333-3333-3333-333333333333'
       and organization_id = 'e9000000-0000-0000-0000-00000000000a' $$,
  'owner_a can set a valid same-org custom rate override on engineer_a membership row'
); -- 6

select is(
  (select has_custom_rate from public.memberships
     where user_id = 'e9333333-3333-3333-3333-333333333333'
       and organization_id = 'e9000000-0000-0000-0000-00000000000a'),
  true,
  'engineer_a membership row now has has_custom_rate = true, proving the write actually took effect'
); -- 7

select lives_ok(
  $$ update public.memberships
       set has_custom_rate = false
     where user_id = 'e9333333-3333-3333-3333-333333333333'
       and organization_id = 'e9000000-0000-0000-0000-00000000000a' $$,
  'memberships: flipping has_custom_rate back to false is allowed even while stale article ids and prices remain on the row (CHECK is trivially satisfied when has_custom_rate is false; the DB does not force clearing, see migration design note 2)'
); -- 8

select is(
  (select travel_article_id is not null from public.memberships
     where user_id = 'e9333333-3333-3333-3333-333333333333'
       and organization_id = 'e9000000-0000-0000-0000-00000000000a'),
  true,
  'confirms the DB itself does not auto-clear travel_article_id on has_custom_rate = false; clearing is an application-layer behavior in lib/rate-overrides/schema.ts, not a DB guarantee'
); -- 9

-- Non-owner (planner_a) cannot write the rate override columns: silently
-- excluded by memberships_update_owner USING clause, same semantics as
-- every other write on this table.
select pg_temp.act_as('e9222222-2222-2222-2222-222222222222');

update public.memberships
   set has_custom_rate = false, travel_article_id = null, work_article_id = null, travel_sale_price = null, work_sale_price = null
 where user_id = 'e9333333-3333-3333-3333-333333333333'
   and organization_id = 'e9000000-0000-0000-0000-00000000000a';

select pg_temp.act_as('e9111111-1111-1111-1111-111111111111');

select is(
  (select travel_article_id is null from public.memberships
     where user_id = 'e9333333-3333-3333-3333-333333333333'
       and organization_id = 'e9000000-0000-0000-0000-00000000000a'),
  false,
  'planner_a non-owner UPDATE attempt was silently excluded by RLS; travel_article_id from test 8/9 above is still present, not cleared by planner_a'
); -- 10

-- Cross-tenant isolation: owner_b must not be able to read or write org_a
-- engineer rate settings at all.
select pg_temp.act_as('e9444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from public.memberships
     where user_id = 'e9333333-3333-3333-3333-333333333333'
       and organization_id = 'e9000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT engineer_a membership row (different org); rate override columns are unreachable, not just hidden'
); -- 11

update public.memberships
   set has_custom_rate = true,
       travel_article_id = 'e9500000-0000-0000-0000-00000000000c',
       work_article_id = 'e9500000-0000-0000-0000-00000000000c',
       travel_sale_price = 1, work_sale_price = 1
 where user_id = 'e9333333-3333-3333-3333-333333333333'
   and organization_id = 'e9000000-0000-0000-0000-00000000000a';

select pg_temp.act_as('e9111111-1111-1111-1111-111111111111');

select is(
  (select has_custom_rate from public.memberships
     where user_id = 'e9333333-3333-3333-3333-333333333333'
       and organization_id = 'e9000000-0000-0000-0000-00000000000a'),
  false,
  'owner_b cross-org UPDATE attempt on engineer_a membership row was silently excluded by RLS; has_custom_rate still false from owner_a perspective'
); -- 12

-- ---------------------------------------------------------------------------
-- 2. public.clients (Client A rate override) -- same CHECK/trigger shape,
--    same owner-only write RLS boundary (clients_update_owner).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.clients set has_custom_rate = true where id = 'e9600000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'clients: has_custom_rate true with both article ids still null is rejected (clients_custom_rate_requires_articles)'
); -- 13

select throws_ok(
  $$ update public.clients
       set has_custom_rate = true,
           travel_article_id = 'e9500000-0000-0000-0000-00000000000a',
           work_article_id = 'e9500000-0000-0000-0000-00000000000b',
           work_sale_price = -1
     where id = 'e9600000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'clients: negative work_sale_price is rejected (clients_work_sale_price_non_negative)'
); -- 14

select throws_ok(
  $$ update public.clients
       set work_article_id = 'e9500000-0000-0000-0000-00000000000c'
     where id = 'e9600000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'clients: work_article_id pointing at org_b article is rejected (validate_rate_override_articles, cross-org)'
); -- 15

select throws_ok(
  $$ update public.clients
       set travel_article_id = gen_random_uuid()
     where id = 'e9600000-0000-0000-0000-00000000000a' $$,
  '23503',
  null,
  'clients: travel_article_id pointing at a nonexistent article is rejected as dangling (validate_rate_override_articles)'
); -- 16

select lives_ok(
  $$ update public.clients
       set has_custom_rate = true,
           travel_article_id = 'e9500000-0000-0000-0000-00000000000a',
           work_article_id = 'e9500000-0000-0000-0000-00000000000b',
           travel_sale_price = 15.00,
           work_sale_price = 60.00
     where id = 'e9600000-0000-0000-0000-00000000000a' $$,
  'owner_a can set a valid same-org custom rate override on Client A'
); -- 17

select is(
  (select work_sale_price from public.clients where id = 'e9600000-0000-0000-0000-00000000000a'),
  60.00,
  'Client A work_sale_price is 60.00 after the write, proving the write actually took effect'
); -- 18

-- Non-owner (planner_a) cannot write the client rate override columns.
select pg_temp.act_as('e9222222-2222-2222-2222-222222222222');

update public.clients
   set has_custom_rate = false, travel_article_id = null, work_article_id = null, travel_sale_price = null, work_sale_price = null
 where id = 'e9600000-0000-0000-0000-00000000000a';

select pg_temp.act_as('e9111111-1111-1111-1111-111111111111');

select is(
  (select has_custom_rate from public.clients where id = 'e9600000-0000-0000-0000-00000000000a'),
  true,
  'planner_a non-owner UPDATE on Client A rate settings was silently excluded by RLS (clients_update_owner USING); has_custom_rate still true'
); -- 19

-- Cross-tenant isolation: owner_b must not be able to read or write Client
-- A rate settings at all.
select pg_temp.act_as('e9444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from public.clients where id = 'e9600000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT Client A (different org); its rate override columns are unreachable, not just hidden'
); -- 20

update public.clients
   set has_custom_rate = false, travel_article_id = null, work_article_id = null, travel_sale_price = null, work_sale_price = null
 where id = 'e9600000-0000-0000-0000-00000000000a';

select pg_temp.act_as('e9111111-1111-1111-1111-111111111111');

select is(
  (select has_custom_rate from public.clients where id = 'e9600000-0000-0000-0000-00000000000a'),
  true,
  'owner_b cross-org UPDATE attempt on Client A rate settings was silently excluded by RLS; has_custom_rate still true from owner_a perspective'
); -- 21

-- ---------------------------------------------------------------------------
-- 3. The shared trigger is genuinely attached to BOTH tables independently:
--    a fresh INSERT (not just UPDATE) with a cross-org article id must also
--    be rejected on each table.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.clients (organization_id, name, has_custom_rate, travel_article_id, work_article_id, travel_sale_price, work_sale_price)
     values ('e9000000-0000-0000-0000-00000000000a', 'Client A2', true, 'e9500000-0000-0000-0000-00000000000c', 'e9500000-0000-0000-0000-00000000000c', 1, 1) $$,
  '23514',
  null,
  'clients: INSERT with a cross-org travel_article_id is rejected (trigger fires on INSERT, not just UPDATE)'
); -- 22

select throws_ok(
  $$ insert into public.memberships (user_id, organization_id, role, has_custom_rate, travel_article_id, work_article_id, travel_sale_price, work_sale_price)
     values ('e9444444-4444-4444-4444-444444444444', 'e9000000-0000-0000-0000-00000000000a', 'engineer', true, 'e9500000-0000-0000-0000-00000000000c', 'e9500000-0000-0000-0000-00000000000c', 1, 1) $$,
  '23514',
  null,
  'memberships: INSERT of a new member with a cross-org travel_article_id (org_b article) is rejected by validate_rate_override_articles; the ordinary memberships_insert_bootstrap_or_owner policy alone would otherwise allow owner_a to add owner_b as a new member of org_a (confirmed by organizations_memberships_rls.test.sql), so this proves the rate-override trigger is a genuine second gate on INSERT, not just UPDATE'
); -- 23

select * from finish();
rollback;
