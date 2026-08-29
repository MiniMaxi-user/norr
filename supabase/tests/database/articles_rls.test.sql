-- pgTAP RLS tests for the Articles module (issue #92,
-- 20260829100000_articles_core.sql): article_unit/article_manufacturer/
-- vat_rate reference lists, article_groups (self-referential tree),
-- articles, and article_components (bill-of-materials).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/asset_brand_and_models_rls.test.sql and
-- supabase/tests/database/contracts_rls.test.sql: switch to the
-- `authenticated` role and set `request.jwt.claims` to simulate auth.uid()
-- for a given fixture user. All auth.users rows here are test fixtures,
-- rolled back at the end of the transaction.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error — the row is silently excluded (0 rows changed). Only
-- INSERT/UPDATE `WITH CHECK` violations (and column-level privilege
-- revokes) raise error 42501.
--
-- This is the FIRST module with the "owner AND administratie both get full
-- CRUD" write shape (contracts' owner-or-finance shape's sibling, reusing
-- current_member_role the same way) — coverage below proves administratie's
-- own direct writes succeed, not just that other roles are rejected.

begin;
create extension if not exists pgtap with schema extensions;

select plan(48);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with owner/administratie/finance (a non-write role for
-- this module) members; org_b with its own owner, one article_group, and one
-- article — for tenant isolation and cross-org hostile-reference tests.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('f2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('f2222222-2222-2222-2222-222222222222', 'administratie-a@test.local'),
  ('f2333333-3333-3333-3333-333333333333', 'finance-a@test.local'),
  ('f2444444-4444-4444-4444-444444444444', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

-- Created AFTER the first act_as call (not before), so it's owned by role
-- `authenticated` — the actual Postgres ROLE never changes across later
-- act_as(...) calls (only auth.uid()'s JWT claim does), so every fixture
-- "user" from here on can freely read/write it regardless of which one is
-- currently simulated. Creating it before any act_as call would instead
-- leave it owned by whatever role initiated the session (e.g. `postgres`),
-- which a subsequent `set local role authenticated` cannot access without
-- an explicit grant — a real, reproducible gotcha this migration's own
-- verification run against the linked project surfaced (see
-- 20260829110000_articles_id_insert_grants.sql's header for the sibling
-- `insert (id)` gotcha found the same way).
create table pg_temp.captured_ids (key text primary key, val uuid not null);

insert into public.organizations (id, name, created_by)
values ('f1000000-0000-0000-0000-00000000000a', 'Org A', 'f2111111-1111-1111-1111-111111111111');

-- The bootstrap owner row and the other members' rows must be separate
-- INSERT statements, not one multi-row VALUES list: `memberships_insert_
-- bootstrap_or_owner`'s non-bootstrap branch checks is_org_owner(...), which
-- re-queries `memberships` via a SECURITY DEFINER function — and a row
-- inserted earlier in the SAME statement is not yet visible to that
-- statement's own scans (the same self-visibility/MVCC rule documented in
-- 20260822173916_fix_memberships_self_visibility.sql), so administratie/
-- finance's rows would fail WITH CHECK if bundled into owner's insert.
insert into public.memberships (user_id, organization_id, role)
values ('f2111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-00000000000a', 'owner');

insert into public.memberships (user_id, organization_id, role) values
  ('f2222222-2222-2222-2222-222222222222', 'f1000000-0000-0000-0000-00000000000a', 'administratie'),
  ('f2333333-3333-3333-3333-333333333333', 'f1000000-0000-0000-0000-00000000000a', 'finance');

select pg_temp.act_as('f2444444-4444-4444-4444-444444444444');

insert into public.organizations (id, name, created_by)
values ('f1000000-0000-0000-0000-00000000000b', 'Org B', 'f2444444-4444-4444-4444-444444444444');

insert into public.memberships (user_id, organization_id, role)
values ('f2444444-4444-4444-4444-444444444444', 'f1000000-0000-0000-0000-00000000000b', 'owner');

insert into public.article_groups (id, organization_id, name)
values ('f4000000-0000-0000-0000-00000000000f', 'f1000000-0000-0000-0000-00000000000b', 'Org B Group');

insert into public.articles (id, organization_id, article_number, description)
values ('f5000000-0000-0000-0000-00000000000f', 'f1000000-0000-0000-0000-00000000000b', 'ORGB-001', 'Org B article');

-- Capture org_b's vat_rate 21% item id, its article_group id, and its
-- article id, for later cross-org hostile-reference tests acting as org_a.
insert into pg_temp.captured_ids (key, val)
select 'org_b_vat_21_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'f1000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'vat_rate' and rli.value = '21';

insert into pg_temp.captured_ids (key, val) values
  ('org_b_group_id', 'f4000000-0000-0000-0000-00000000000f'),
  ('org_b_article_id', 'f5000000-0000-0000-0000-00000000000f');

select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 1. Seeding: article_unit / article_manufacturer / vat_rate exist per-org
--    with the expected shape, purely from inserting into organizations.
-- ---------------------------------------------------------------------------
select bag_has(
  $$ select rli.value from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'article_unit' $$,
  $$ values ('stuk'), ('liter'), ('kg') $$,
  'org_a''s seeded article_unit list has the 3 default items (Stuk/Liter/Kg)'
); -- 1

select is(
  (select rli.value from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'article_unit' and rli.is_default),
  'stuk',
  'org_a''s default article_unit item is stuk'
); -- 2

select is(
  (select count(*)::int from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'article_manufacturer'),
  1,
  'org_a''s seeded article_manufacturer list has exactly 1 default (Other) item'
); -- 3

select bag_has(
  $$ select rli.value || ':' || rli.label from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'vat_rate' $$,
  $$ values ('0:0%'), ('9:9%'), ('21:21%') $$,
  'org_a''s seeded vat_rate list has value:label pairs 0:0%, 9:9%, 21:21%'
); -- 4

select is(
  (select rli.value from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'vat_rate' and rli.is_default),
  '21',
  'org_a''s default vat_rate item is 21% (the Dutch standard rate)'
); -- 5

-- ---------------------------------------------------------------------------
-- 2. article_groups: unlimited-depth tree, self-parent/cycle/cross-org/
--    dangling rejection, owner-or-administratie write boundary.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.article_groups (id, organization_id, name)
     values ('f4000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 'Group') $$,
  'owner_a can create a top-level article_group'
); -- 6

select lives_ok(
  $$ insert into public.article_groups (id, organization_id, parent_group_id, name)
     values ('f4000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000a', 'Subgroup') $$,
  'owner_a can create a Subgroup under Group'
); -- 7

select lives_ok(
  $$ insert into public.article_groups (id, organization_id, parent_group_id, name)
     values ('f4000000-0000-0000-0000-00000000000c', 'f1000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000b', 'Subsubgroup') $$,
  'owner_a can create a Subsubgroup under Subgroup — unlimited depth works'
); -- 8

select throws_ok(
  $$ update public.article_groups set parent_group_id = id where id = 'f4000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'a group cannot reference itself as its own parent'
); -- 9

select throws_ok(
  $$ update public.article_groups set parent_group_id = 'f4000000-0000-0000-0000-00000000000c' where id = 'f4000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'Group cannot be re-parented under its own grandchild Subsubgroup (would create a cycle)'
); -- 10

select throws_ok(
  $$ update public.article_groups set parent_group_id = val
     from pg_temp.captured_ids where key = 'org_b_group_id' and article_groups.id = 'f4000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'Group cannot be re-parented under org_b''s article_group (cross-organization rejected)'
); -- 11

select throws_ok(
  $$ update public.article_groups set parent_group_id = gen_random_uuid() where id = 'f4000000-0000-0000-0000-00000000000a' $$,
  '23503',
  null,
  'a parent_group_id pointing at a nonexistent article_groups row is rejected as dangling'
); -- 12

select is(
  (select count(*)::int from public.article_groups where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  3,
  'org_a has exactly 3 article_groups after the tree + rejected attempts above'
); -- 13

select pg_temp.act_as('f2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ update public.article_groups set name = 'Group (renamed by administratie)' where id = 'f4000000-0000-0000-0000-00000000000a' $$,
  'administratie_a can UPDATE an article_group directly (owner-or-administratie write shape)'
); -- 14

select pg_temp.act_as('f2333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ insert into public.article_groups (organization_id, name)
     values ('f1000000-0000-0000-0000-00000000000a', 'Finance Group') $$,
  '42501',
  null,
  'finance_a (neither owner nor administratie) cannot INSERT an article_group'
); -- 15

select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 3. articles: default-fill, explicit refs, uniqueness, wrong list_key,
--    cross-org rejection, price constraints.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.articles (id, organization_id, article_number, description, group_id)
     values ('f5000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 'ART-001', 'Basic article', 'f4000000-0000-0000-0000-00000000000a') $$,
  'owner_a can insert an article omitting unit_item_id/vat_rate_item_id entirely'
); -- 16

select is(
  (select rl.list_key from public.articles a
     join public.reference_list_items rli on rli.id = a.unit_item_id
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where a.id = 'f5000000-0000-0000-0000-00000000000a'),
  'article_unit',
  'omitted unit_item_id was filled from org_a''s default article_unit item (derive_article_defaults)'
); -- 17

select is(
  (select rli.value from public.articles a
     join public.reference_list_items rli on rli.id = a.vat_rate_item_id
     where a.id = 'f5000000-0000-0000-0000-00000000000a'),
  '21',
  'omitted vat_rate_item_id was filled from org_a''s default vat_rate item (21%)'
); -- 18

select is(
  (select created_by from public.articles where id = 'f5000000-0000-0000-0000-00000000000a'),
  'f2111111-1111-1111-1111-111111111111'::uuid,
  'articles.created_by was auto-stamped to the inserting user, not client-supplied'
); -- 19

select is(
  (select is_active from public.articles where id = 'f5000000-0000-0000-0000-00000000000a'),
  true,
  'articles.is_active defaults to true'
); -- 20

select throws_ok(
  $$ insert into public.articles (organization_id, article_number, description)
     values ('f1000000-0000-0000-0000-00000000000a', 'ART-001', 'Duplicate number') $$,
  '23505',
  null,
  'article_number must be unique per organization'
); -- 21

select throws_ok(
  $$ insert into public.articles (organization_id, article_number, description, unit_item_id)
     select 'f1000000-0000-0000-0000-00000000000a', 'ART-002', 'Wrong list unit', rli.id
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'vat_rate' and rli.value = '21' $$,
  '23514',
  null,
  'articles.unit_item_id must reference an item from the article_unit list, not vat_rate'
); -- 22

select throws_ok(
  $$ insert into public.articles (organization_id, article_number, description, vat_rate_item_id)
     select 'f1000000-0000-0000-0000-00000000000a', 'ART-003', 'Wrong list vat', rli.id
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'article_unit' and rli.value = 'stuk' $$,
  '23514',
  null,
  'articles.vat_rate_item_id must reference an item from the vat_rate list, not article_unit'
); -- 23

select throws_ok(
  $$ insert into public.articles (organization_id, article_number, description, vat_rate_item_id)
     select 'f1000000-0000-0000-0000-00000000000a', 'ART-004', 'Cross org vat', val
     from pg_temp.captured_ids where key = 'org_b_vat_21_id' $$,
  '23514',
  null,
  'articles.vat_rate_item_id from a different organization''s vat_rate list is rejected even though it is a same-shape value=21 item'
); -- 24

select throws_ok(
  $$ insert into public.articles (organization_id, article_number, description, group_id)
     values ('f1000000-0000-0000-0000-00000000000a', 'ART-005', 'Nonexistent group', gen_random_uuid()) $$,
  '23503',
  null,
  'articles.group_id must reference an existing article_groups row'
); -- 25

select throws_ok(
  $$ insert into public.articles (organization_id, article_number, description, purchase_price)
     values ('f1000000-0000-0000-0000-00000000000a', 'ART-006', 'Negative price', -1) $$,
  '23514',
  null,
  'articles.purchase_price must be >= 0 when set'
); -- 26

select pg_temp.act_as('f2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.articles (id, organization_id, article_number, description, purchase_price, sale_price)
     values ('f5000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-00000000000a', 'ART-COMP', 'Composite article', 10.00, 25.00) $$,
  'administratie_a can INSERT an article directly (owner-or-administratie write shape)'
); -- 27

select lives_ok(
  $$ update public.articles set is_composite = true where id = 'f5000000-0000-0000-0000-00000000000b' $$,
  'administratie_a can flip a fresh, unused article to is_composite = true'
); -- 28

select lives_ok(
  $$ insert into public.articles (id, organization_id, article_number, description)
     values ('f5000000-0000-0000-0000-00000000000c', 'f1000000-0000-0000-0000-00000000000a', 'ART-PART-1', 'Component part 1') $$,
  'administratie_a can insert component article 1 (non-composite)'
); -- 29

select lives_ok(
  $$ insert into public.articles (id, organization_id, article_number, description)
     values ('f5000000-0000-0000-0000-00000000000d', 'f1000000-0000-0000-0000-00000000000a', 'ART-PART-2', 'Component part 2') $$,
  'administratie_a can insert component article 2 (non-composite)'
); -- 30

select pg_temp.act_as('f2333333-3333-3333-3333-333333333333');

update public.articles set description = 'Hijacked' where id = 'f5000000-0000-0000-0000-00000000000a';

select is(
  (select description from public.articles where id = 'f5000000-0000-0000-0000-00000000000a'),
  'Basic article',
  'finance_a''s UPDATE on an article is silently excluded by RLS (USING); description unchanged — an UPDATE grant is shared at the authenticated role level, so it is RLS (current_member_role), not a column-privilege revoke, that blocks finance_a here'
); -- 31

select is(
  (select count(*)::int from public.articles where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  4,
  'finance_a (read-only member) can still SELECT all 4 of org_a''s articles'
); -- 32

select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 4. article_components: BOM happy path, self-reference, composite/
--    non-composite shape enforcement (both directions), cross-org
--    rejection, and the is_composite-flip back-door closure.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.article_components (id, parent_article_id, component_article_id, quantity)
     values ('f6000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-00000000000b', 'f5000000-0000-0000-0000-00000000000c', 2) $$,
  'owner_a can attach component part 1 (qty 2) to the composite article'
); -- 33

select lives_ok(
  $$ insert into public.article_components (id, parent_article_id, component_article_id, quantity)
     values ('f6000000-0000-0000-0000-00000000000b', 'f5000000-0000-0000-0000-00000000000b', 'f5000000-0000-0000-0000-00000000000d', 0.5) $$,
  'owner_a can attach component part 2 (fractional qty 0.5) to the composite article'
); -- 34

select throws_ok(
  $$ insert into public.article_components (parent_article_id, component_article_id, quantity)
     values ('f5000000-0000-0000-0000-00000000000b', 'f5000000-0000-0000-0000-00000000000b', 1) $$,
  '23514',
  null,
  'an article cannot be its own component (self-reference check constraint)'
); -- 35

select throws_ok(
  $$ insert into public.article_components (parent_article_id, component_article_id, quantity)
     values ('f5000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-00000000000c', 1) $$,
  '23514',
  null,
  'parent_article_id must reference an article with is_composite = true (ART-001 is not composite)'
); -- 36

select lives_ok(
  $$ insert into public.article_components (id, parent_article_id, component_article_id, quantity)
     values ('f6000000-0000-0000-0000-00000000000c', 'f5000000-0000-0000-0000-00000000000b', 'f5000000-0000-0000-0000-00000000000a', 1) $$,
  'ART-001 (a plain, not-yet-used non-composite article) can also be attached as a third BOM component'
); -- 37

select lives_ok(
  $$ insert into public.articles (id, organization_id, article_number, description, is_composite)
     values ('f5000000-0000-0000-0000-00000000000e', 'f1000000-0000-0000-0000-00000000000a', 'ART-COMP-2', 'A second, unrelated composite article', true) $$,
  'a second composite article (ART-COMP-2, not yet used as anyone''s component) can be created directly with is_composite = true'
); -- 38

select throws_ok(
  $$ insert into public.article_components (parent_article_id, component_article_id, quantity)
     values ('f5000000-0000-0000-0000-00000000000e', 'f5000000-0000-0000-0000-00000000000b', 1) $$,
  '23514',
  null,
  'component_article_id cannot itself be composite (ART-COMP is composite) — nested composites are rejected'
); -- 39

select throws_ok(
  $$ insert into public.article_components (parent_article_id, component_article_id, quantity)
     select 'f5000000-0000-0000-0000-00000000000b', val, 1
     from pg_temp.captured_ids where key = 'org_b_article_id' $$,
  '23514',
  null,
  'component_article_id from a different organization than the parent article is rejected'
); -- 40

select throws_ok(
  $$ update public.articles set is_composite = true where id = 'f5000000-0000-0000-0000-00000000000c' $$,
  '23514',
  null,
  'cannot flip an in-use component article (ART-PART-1) to is_composite = true — back-door nested-composite closure'
); -- 41

select is(
  (select count(*)::int from public.article_components where parent_article_id = 'f5000000-0000-0000-0000-00000000000b'),
  3,
  'the composite article has exactly 3 BOM lines (part 1, part 2, ART-001) after the valid inserts + rejected attempts above'
); -- 42

select lives_ok(
  $$ update public.article_components set quantity = 3 where id = 'f6000000-0000-0000-0000-00000000000a' $$,
  'owner_a can update a BOM line''s quantity in place'
); -- 43

select throws_ok(
  $$ update public.article_components set parent_article_id = 'f5000000-0000-0000-0000-00000000000e' where id = 'f6000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'parent_article_id is not updatable after creation (column excluded from the UPDATE grant)'
); -- 44

-- ---------------------------------------------------------------------------
-- 5. Cross-tenant isolation: owner_b sees none of org_a''s Articles-module
--    rows and cannot write into org_a.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from public.articles where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s articles'
); -- 45

select is(
  (select count(*)::int from public.article_groups where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s article_groups'
); -- 46

select is(
  (select count(*)::int from public.article_components where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s article_components'
); -- 47

select throws_ok(
  $$ insert into public.articles (organization_id, article_number, description)
     values ('f1000000-0000-0000-0000-00000000000a', 'ART-HOSTILE', 'Hostile insert') $$,
  '42501',
  null,
  'owner_b cannot INSERT an article into org_a (not is_org_owner/administratie of org_a)'
); -- 48

select * from finish();
rollback;
