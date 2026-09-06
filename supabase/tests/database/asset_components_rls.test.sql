-- pgTAP RLS tests for the Asset composite/bill-of-materials module (issue
-- #125, 20260906100000_asset_components.sql): asset_components' unique
-- component-per-parent constraint, arbitrary-depth cycle detection
-- (including the reflexive self-reference case), cross-organization
-- rejection, owner-only write boundary (matching assets' OWN write boundary,
-- not the owner-or-administratie shape article_components/articles use),
-- and tenant isolation.
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/articles_rls.test.sql and
-- supabase/tests/database/clients_sites_assets_rls.test.sql: switch to the
-- `authenticated` role and set `request.jwt.claims` to simulate auth.uid()
-- for a given fixture user. All auth.users rows here are test fixtures,
-- rolled back at the end of the transaction.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error — the row is silently excluded (0 rows changed). Only
-- INSERT/UPDATE `WITH CHECK` violations (and column-level privilege
-- revokes) raise error 42501.

begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with owner/planner (non-owner) members, one client/site,
-- and 5 assets forming most of the composition tree (P, C1, C2, GC, plus one
-- unused "spare"); org_b with its own owner, client/site, and 2 assets
-- (b1/b2) for tenant isolation + cross-org hostile-reference tests.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('9a111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('9a222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('9a333333-3333-3333-3333-333333333333', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('9a111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('9b000000-0000-0000-0000-00000000000a', 'Org A', '9a111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role)
values ('9a111111-1111-1111-1111-111111111111', '9b000000-0000-0000-0000-00000000000a', 'owner');

insert into public.memberships (user_id, organization_id, role)
values ('9a222222-2222-2222-2222-222222222222', '9b000000-0000-0000-0000-00000000000a', 'planner');

insert into public.clients (id, organization_id, name)
values ('9c000000-0000-0000-0000-00000000000a', '9b000000-0000-0000-0000-00000000000a', 'Client A');

insert into public.sites (id, client_id, is_visit_address)
values ('9d000000-0000-0000-0000-00000000000a', '9c000000-0000-0000-0000-00000000000a', true);

-- P, C1, C2, GC, and one unused spare asset — all org_a, all sharing the
-- seeded 'hvac' asset_type item for org_a.
insert into public.assets (id, site_id, name, type_id)
select '9e000000-0000-0000-0000-00000000000a', '9d000000-0000-0000-0000-00000000000a', 'Asset P (parent)', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = '9b000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into public.assets (id, site_id, name, type_id)
select '9e000000-0000-0000-0000-00000000000b', '9d000000-0000-0000-0000-00000000000a', 'Asset C1', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = '9b000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into public.assets (id, site_id, name, type_id)
select '9e000000-0000-0000-0000-00000000000c', '9d000000-0000-0000-0000-00000000000a', 'Asset C2', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = '9b000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into public.assets (id, site_id, name, type_id)
select '9e000000-0000-0000-0000-00000000000d', '9d000000-0000-0000-0000-00000000000a', 'Asset GC (grandchild)', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = '9b000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into public.assets (id, site_id, name, type_id)
select '9e000000-0000-0000-0000-00000000000f', '9d000000-0000-0000-0000-00000000000a', 'Asset Spare (unused)', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = '9b000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

select pg_temp.act_as('9a333333-3333-3333-3333-333333333333');

insert into public.organizations (id, name, created_by)
values ('9b000000-0000-0000-0000-00000000000b', 'Org B', '9a333333-3333-3333-3333-333333333333');

insert into public.memberships (user_id, organization_id, role)
values ('9a333333-3333-3333-3333-333333333333', '9b000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name)
values ('9c000000-0000-0000-0000-00000000000b', '9b000000-0000-0000-0000-00000000000b', 'Client B');

insert into public.sites (id, client_id, is_visit_address)
values ('9d000000-0000-0000-0000-00000000000b', '9c000000-0000-0000-0000-00000000000b', true);

insert into public.assets (id, site_id, name, type_id)
select '9e000000-0000-0000-0000-00000000000e', '9d000000-0000-0000-0000-00000000000b', 'Asset B1', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = '9b000000-0000-0000-0000-00000000000b' and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into public.assets (id, site_id, name, type_id)
select '9e100000-0000-0000-0000-000000000001', '9d000000-0000-0000-0000-00000000000b', 'Asset B2 (parent)', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = '9b000000-0000-0000-0000-00000000000b' and rl.list_key = 'asset_type' and rli.value = 'hvac';

select pg_temp.act_as('9a111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- Happy path: P gets two components (C1, C2), organization_id/created_by
-- auto-populated.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.asset_components (id, parent_asset_id, component_asset_id, quantity)
     values ('9f000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000000b', 2) $$,
  'owner_a can attach C1 (qty 2) as a component of P'
); -- 1

select is(
  (select organization_id from public.asset_components where id = '9f000000-0000-0000-0000-00000000000a'),
  '9b000000-0000-0000-0000-00000000000a'::uuid,
  'asset_components.organization_id was auto-derived from parent_asset_id (P''s own organization)'
); -- 2

select is(
  (select created_by from public.asset_components where id = '9f000000-0000-0000-0000-00000000000a'),
  '9a111111-1111-1111-1111-111111111111'::uuid,
  'asset_components.created_by was auto-stamped to the inserting user, not client-supplied'
); -- 3

select lives_ok(
  $$ insert into public.asset_components (id, parent_asset_id, component_asset_id, quantity)
     values ('9f000000-0000-0000-0000-00000000000b', '9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000000c', 1) $$,
  'owner_a can attach C2 (qty 1) as a second component of P'
); -- 4

select throws_ok(
  $$ insert into public.asset_components (parent_asset_id, component_asset_id, quantity)
     values ('9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000000d', -1) $$,
  '23514',
  null,
  'quantity must be > 0 (asset_components_quantity_positive)'
); -- 5

select throws_ok(
  $$ insert into public.asset_components (parent_asset_id, component_asset_id, quantity)
     values ('9e000000-0000-0000-0000-00000000000c', '9e000000-0000-0000-0000-00000000000b', 1) $$,
  '23505',
  null,
  'component_asset_id is unique across the whole table -- C1 is already a component of P, so it cannot also become a component of C2 (a physical asset can only be in one assembly at a time)'
); -- 6

select throws_ok(
  $$ insert into public.asset_components (parent_asset_id, component_asset_id, quantity)
     values ('9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000000e', 1) $$,
  '23514',
  null,
  'component_asset_id from a different organization (org_b''s Asset B1) than the parent (org_a''s P) is rejected'
); -- 7

-- ---------------------------------------------------------------------------
-- Arbitrary-depth nesting (unlike article_components' flat-only design) and
-- cycle detection, including the reflexive self-reference case.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.asset_components (id, parent_asset_id, component_asset_id, quantity)
     values ('9f000000-0000-0000-0000-00000000000c', '9e000000-0000-0000-0000-00000000000b', '9e000000-0000-0000-0000-00000000000d', 1) $$,
  'owner_a can attach GC as a component of C1 -- depth-2 nesting under P (unlimited depth is supported, unlike article_components)'
); -- 8

select throws_ok(
  $$ insert into public.asset_components (parent_asset_id, component_asset_id, quantity)
     values ('9e000000-0000-0000-0000-00000000000b', '9e000000-0000-0000-0000-00000000000a', 1) $$,
  '23514',
  null,
  'C1 cannot become the parent of P -- P is already C1''s own ancestor (P -> C1), so this would create a direct cycle'
); -- 9

select throws_ok(
  $$ insert into public.asset_components (parent_asset_id, component_asset_id, quantity)
     values ('9e000000-0000-0000-0000-00000000000d', '9e000000-0000-0000-0000-00000000000a', 1) $$,
  '23514',
  null,
  'GC (a depth-2 descendant of P) cannot become the parent of P -- rejected as a deeper cycle by the same recursive descendant walk'
); -- 10

select throws_ok(
  $$ insert into public.asset_components (parent_asset_id, component_asset_id, quantity)
     values ('9e000000-0000-0000-0000-00000000000c', '9e000000-0000-0000-0000-00000000000c', 1) $$,
  '23514',
  null,
  'C2 cannot be its own component -- the reflexive depth-0 case of the cycle check (no dedicated self-reference CHECK constraint exists on this table, unlike article_components)'
); -- 11

select throws_ok(
  $$ insert into public.asset_components (parent_asset_id, component_asset_id, quantity)
     values (gen_random_uuid(), '9e000000-0000-0000-0000-00000000000c', 1) $$,
  '23503',
  null,
  'a parent_asset_id pointing at a nonexistent asset is rejected as dangling'
); -- 12

select throws_ok(
  $$ insert into public.asset_components (parent_asset_id, component_asset_id, quantity)
     values ('9e000000-0000-0000-0000-00000000000a', gen_random_uuid(), 1) $$,
  '23503',
  null,
  'a component_asset_id pointing at a nonexistent asset is rejected as dangling'
); -- 13

select is(
  (select count(*)::int from public.asset_components where organization_id = '9b000000-0000-0000-0000-00000000000a'),
  3,
  'org_a has exactly 3 asset_components rows (P-C1, P-C2, C1-GC) after the valid inserts + rejected attempts above'
); -- 14

-- ---------------------------------------------------------------------------
-- quantity is editable in place; parent_asset_id/component_asset_id are not
-- (delete and re-add to change either side).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update public.asset_components set quantity = 5 where id = '9f000000-0000-0000-0000-00000000000a' $$,
  'owner_a can update a BOM line''s quantity in place'
); -- 15

select throws_ok(
  $$ update public.asset_components set parent_asset_id = '9e000000-0000-0000-0000-00000000000c' where id = '9f000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'parent_asset_id is not updatable after creation (column excluded from the UPDATE grant)'
); -- 16

select throws_ok(
  $$ update public.asset_components set component_asset_id = '9e000000-0000-0000-0000-00000000000f' where id = '9f000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'component_asset_id is not updatable after creation (column excluded from the UPDATE grant)'
); -- 17

-- ---------------------------------------------------------------------------
-- Write boundary: OWNER ONLY (matches assets_insert_owner/assets_update_owner
-- exactly, NOT the owner-or-administratie shape article_components uses).
-- planner_a can read but not write.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('9a222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.asset_components where organization_id = '9b000000-0000-0000-0000-00000000000a'),
  3,
  'planner_a (non-owner member) can SELECT all 3 of org_a''s asset_components'
); -- 18

select throws_ok(
  $$ insert into public.asset_components (parent_asset_id, component_asset_id, quantity)
     values ('9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000000f', 1) $$,
  '42501',
  null,
  'planner_a (non-owner) cannot INSERT an asset_component (RLS owner-only backstop)'
); -- 19

update public.asset_components set quantity = 999 where id = '9f000000-0000-0000-0000-00000000000a';

select is(
  (select quantity from public.asset_components where id = '9f000000-0000-0000-0000-00000000000a'),
  5::numeric(12,3),
  'planner_a''s UPDATE on an asset_component is silently excluded by RLS (USING); quantity unchanged from owner_a''s earlier update'
); -- 20

-- ---------------------------------------------------------------------------
-- Cross-tenant isolation: owner_b sees none of org_a's asset_components and
-- cannot write into org_a, but can freely manage its own org_b tree.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('9a333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.asset_components where organization_id = '9b000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s asset_components'
); -- 21

select throws_ok(
  $$ insert into public.asset_components (parent_asset_id, component_asset_id, quantity)
     values ('9e000000-0000-0000-0000-00000000000a', '9e000000-0000-0000-0000-00000000000f', 1) $$,
  '42501',
  null,
  'owner_b cannot INSERT an asset_component into org_a (not is_org_owner of org_a)'
); -- 22

select lives_ok(
  $$ insert into public.asset_components (parent_asset_id, component_asset_id, quantity)
     values ('9e100000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-00000000000e', 1) $$,
  'owner_b can attach Asset B1 as a component of Asset B2 within its own org_b (previously-rejected cross-org attempt in test 7 left B1 unused, so it is still free to attach here)'
); -- 23

select is(
  (select count(*)::int from public.asset_components where organization_id = '9b000000-0000-0000-0000-00000000000b'),
  1,
  'org_b has exactly 1 asset_components row after its own happy-path insert'
); -- 24

select * from finish();
rollback;
