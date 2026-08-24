-- pgTAP RLS tests for quotes + quote_line_items + work_orders.source_quote_id
-- + contracts.source_quote_id (issue #16, 20260824090000_quotes_core.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/work_orders_rls.test.sql and
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
-- This is the FIFTH table pair whose RBAC matrix row is enforced as real RLS
-- via current_member_role, reusing work_orders' EXACT shape (owner/planner
-- CRUD, everyone else read-only, no per-row assignment scoping), not
-- contracts' owner+finance shape. Coverage: tenant isolation on quotes AND
-- quote_line_items specifically; owner AND planner BOTH directly tested on
-- UPDATE and DELETE (not just one); engineer/finance/administratie
-- read-only (INSERT/UPDATE/DELETE all rejected, for all three roles) on BOTH
-- quotes and quote_line_items (each of the three roles gets its own
-- SELECT-succeeds + INSERT/UPDATE/DELETE-all-rejected set against
-- quote_line_items, mirroring the quotes-table coverage); quotes.site_id
-- must belong to client_id; quotes.status_id reference-list validation
-- (wrong list_key, cross-org); quote_line_items.asset_id must belong to the
-- QUOTE's own client_id (not just any client in the org); source_quote_id
-- cross-field checks on both work_orders and contracts.

begin;
create extension if not exists pgtap with schema extensions;

select plan(60);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with one of each relevant role, org_b for tenant
-- isolation. Two clients in org_a (client_a, client_a2), each with their own
-- site/asset, to exercise the site/asset-must-belong-to-the-same-client
-- cross-field checks (on quotes.site_id, quote_line_items.asset_id, and the
-- source_quote_id checks on work_orders/contracts).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('f2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('f2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('f2333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('f2444444-4444-4444-4444-444444444444', 'finance-a@test.local'),
  ('f2555555-5555-5555-5555-555555555555', 'administratie-a@test.local'),
  ('f2666666-6666-6666-6666-666666666666', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create table pg_temp.captured_ids (key text primary key, val uuid not null);

select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('f1000000-0000-0000-0000-00000000000a', 'Org A', 'f2111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role) values
  ('f2111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-00000000000a', 'owner'),
  ('f2222222-2222-2222-2222-222222222222', 'f1000000-0000-0000-0000-00000000000a', 'planner'),
  ('f2333333-3333-3333-3333-333333333333', 'f1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('f2444444-4444-4444-4444-444444444444', 'f1000000-0000-0000-0000-00000000000a', 'finance'),
  ('f2555555-5555-5555-5555-555555555555', 'f1000000-0000-0000-0000-00000000000a', 'administratie');

insert into public.clients (id, organization_id, name) values
  ('f3000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 'Client A'),
  ('f3000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-00000000000a', 'Client A2');

insert into public.sites (id, client_id, name) values
  ('f4000000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-00000000000a', 'Site A'),
  ('f4000000-0000-0000-0000-00000000000b', 'f3000000-0000-0000-0000-00000000000b', 'Site A2');

insert into public.assets (id, site_id, name, type_id, serial_number)
select 'f5000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000a', 'Asset A', rli.id, 'SN-A'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'hvac';

insert into public.assets (id, site_id, name, type_id, serial_number)
select 'f5000000-0000-0000-0000-00000000000b', 'f4000000-0000-0000-0000-00000000000b', 'Asset A2', rli.id, 'SN-A2'
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'asset_type' and rli.value = 'electrical';

-- Two quotes, one per client, used only in sections 9-10 for the
-- source_quote_id cross-field checks on work_orders/contracts.
insert into public.quotes (id, client_id, name)
values ('f6000000-0000-0000-0000-00000000000c', 'f3000000-0000-0000-0000-00000000000a', 'Client A Quote For Conversion');

insert into public.quotes (id, client_id, name)
values ('f6000000-0000-0000-0000-00000000000d', 'f3000000-0000-0000-0000-00000000000b', 'Client A2 Quote For Conversion');

select pg_temp.act_as('f2666666-6666-6666-6666-666666666666');

insert into public.organizations (id, name, created_by)
values ('f1000000-0000-0000-0000-00000000000b', 'Org B', 'f2666666-6666-6666-6666-666666666666');

insert into public.memberships (user_id, organization_id, role)
values ('f2666666-6666-6666-6666-666666666666', 'f1000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name)
values ('f3000000-0000-0000-0000-00000000000c', 'f1000000-0000-0000-0000-00000000000b', 'Client B');

-- Capture org_b's seeded quote_status "draft" (default) item id, needed
-- later (while acting as owner_a) for the cross-org status_id hostile-insert
-- test.
insert into pg_temp.captured_ids (key, val)
select 'org_b_quote_status_draft_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'f1000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'quote_status' and rli.value = 'draft';

-- ---------------------------------------------------------------------------
-- 1. owner: insert, derived columns, defaults, and every cross-field/
--    reference-list validation this migration adds to quotes.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.quotes (id, client_id, site_id, name)
     values ('f6000000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-00000000000a',
       'f4000000-0000-0000-0000-00000000000a', 'HVAC Replacement Proposal') $$,
  'owner_a can insert a quote under client A (org_a) with site_id=Site A (same client), status_id omitted'
); -- 1

select is(
  (select organization_id from public.quotes where id = 'f6000000-0000-0000-0000-00000000000a'),
  'f1000000-0000-0000-0000-00000000000a'::uuid,
  'quotes.organization_id was auto-derived from clients.organization_id via client_id'
); -- 2

select is(
  (select created_by from public.quotes where id = 'f6000000-0000-0000-0000-00000000000a'),
  'f2111111-1111-1111-1111-111111111111'::uuid,
  'quotes.created_by was auto-stamped to the inserting user (trigger), not client-supplied'
); -- 3

select is(
  (select rli.value from public.quotes q
     join public.reference_list_items rli on rli.id = q.status_id
     where q.id = 'f6000000-0000-0000-0000-00000000000a'),
  'draft',
  'quotes.status_id defaulted to the org''s default quote_status item ("draft") when omitted on insert'
); -- 4

select throws_ok(
  $$ insert into public.quotes (client_id, name, organization_id)
     values ('f3000000-0000-0000-0000-00000000000a', 'Spoofed', 'f1000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_a cannot set quotes.organization_id directly on insert (column-level grant withheld)'
); -- 5

select throws_ok(
  $$ insert into public.quotes (client_id, name, created_by)
     values ('f3000000-0000-0000-0000-00000000000a', 'Spoofed', '00000000-0000-0000-0000-000000000000') $$,
  '42501',
  null,
  'owner_a cannot set quotes.created_by directly on insert (column-level grant withheld)'
); -- 6

select throws_ok(
  $$ insert into public.quotes (client_id, site_id, name)
     values ('f3000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000b', 'Wrong Site Client') $$,
  '23514',
  null,
  'quotes.site_id from a different client (Site A2 under Client A2) is rejected when client_id=Client A'
); -- 7

select throws_ok(
  $$ insert into public.quotes (client_id, name, status_id)
     select 'f3000000-0000-0000-0000-00000000000a', 'Wrong Status List',
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'asset_status' and rli.is_default) $$,
  '23514',
  null,
  'quotes.status_id must be from the quote_status list, not asset_status (validate_quote_reference_items)'
); -- 8

select throws_ok(
  $$ insert into public.quotes (client_id, name, status_id)
     select 'f3000000-0000-0000-0000-00000000000a', 'Cross Org Status', val
     from pg_temp.captured_ids where key = 'org_b_quote_status_draft_id' $$,
  '23514',
  null,
  'quotes.status_id from a different organization''s quote_status list (org_b''s) is rejected'
); -- 9

-- ---------------------------------------------------------------------------
-- 2. planner: full CRUD on quotes, matching the new quotes module's row
--    (owner/planner CRUD, same shape as work_orders' planning row).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ insert into public.quotes (id, client_id, name)
     values ('f6000000-0000-0000-0000-00000000000b', 'f3000000-0000-0000-0000-00000000000a', 'Planner Drafted Quote') $$,
  'planner_a can insert a quote in org_a'
); -- 10

select lives_ok(
  $$ update public.quotes set name = 'HVAC Replacement Proposal (Revised)' where id = 'f6000000-0000-0000-0000-00000000000a' $$,
  'planner_a can update any quote in org_a, not just their own'
); -- 11

select is(
  (select name from public.quotes where id = 'f6000000-0000-0000-0000-00000000000a'),
  'HVAC Replacement Proposal (Revised)',
  'planner_a''s update took effect'
); -- 12

insert into public.quotes (id, client_id, name)
values ('f6000000-0000-0000-0000-00000000000e', 'f3000000-0000-0000-0000-00000000000a', 'Planner Disposable');

select lives_ok(
  $$ delete from public.quotes where id = 'f6000000-0000-0000-0000-00000000000e' $$,
  'planner_a can directly delete a quote in org_a'
); -- 13

select is(
  (select count(*)::int from public.quotes where id = 'f6000000-0000-0000-0000-00000000000e'),
  0,
  'the disposable quote is actually gone after planner_a''s delete'
); -- 14

-- ---------------------------------------------------------------------------
-- 3. engineer: read-only (RBAC matrix: engineer has Read on quotes, no
--    per-row assignment scoping — unlike work_orders' engineer row).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.quotes where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  4,
  'engineer_a can SELECT every quote in org_a (read-only, all rows, not assignment-scoped): the two conversion-fixture quotes plus quote_a and planner''s quote_b'
); -- 15

select throws_ok(
  $$ insert into public.quotes (client_id, name)
     values ('f3000000-0000-0000-0000-00000000000a', 'Engineer Attempt') $$,
  '42501',
  null,
  'engineer_a cannot INSERT a quote (RBAC matrix: engineer is read-only on quotes)'
); -- 16

update public.quotes set name = 'Hijacked' where id = 'f6000000-0000-0000-0000-00000000000a';

select is(
  (select name from public.quotes where id = 'f6000000-0000-0000-0000-00000000000a'),
  'HVAC Replacement Proposal (Revised)',
  'engineer_a''s UPDATE is silently excluded by RLS (read-only); name unchanged'
); -- 17

delete from public.quotes where id = 'f6000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.quotes where id = 'f6000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a''s DELETE is silently excluded by RLS (read-only); row still exists'
); -- 18

-- ---------------------------------------------------------------------------
-- 4. finance: read-only (RBAC matrix: finance has Read on quotes — a NEW
--    shape vs. contracts, where finance gets full CRUD; quotes aren't yet
--    revenue).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from public.quotes where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  4,
  'finance_a can SELECT every quote in org_a (read-only, all rows)'
); -- 19

select throws_ok(
  $$ insert into public.quotes (client_id, name)
     values ('f3000000-0000-0000-0000-00000000000a', 'Finance Attempt') $$,
  '42501',
  null,
  'finance_a cannot INSERT a quote (RBAC matrix: finance is read-only on quotes, unlike contracts)'
); -- 20

update public.quotes set name = 'Hijacked' where id = 'f6000000-0000-0000-0000-00000000000a';

select is(
  (select name from public.quotes where id = 'f6000000-0000-0000-0000-00000000000a'),
  'HVAC Replacement Proposal (Revised)',
  'finance_a''s UPDATE is silently excluded by RLS (read-only); name unchanged'
); -- 21

delete from public.quotes where id = 'f6000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.quotes where id = 'f6000000-0000-0000-0000-00000000000a'),
  1,
  'finance_a''s DELETE is silently excluded by RLS (read-only); row still exists'
); -- 22

-- ---------------------------------------------------------------------------
-- 5. administratie: read-only (RBAC matrix: administratie has Read on
--    quotes).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2555555-5555-5555-5555-555555555555');

select is(
  (select count(*)::int from public.quotes where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  4,
  'administratie_a can SELECT every quote in org_a (read-only, all rows)'
); -- 23

select throws_ok(
  $$ insert into public.quotes (client_id, name)
     values ('f3000000-0000-0000-0000-00000000000a', 'Administratie Attempt') $$,
  '42501',
  null,
  'administratie_a cannot INSERT a quote (RBAC matrix: administratie is read-only on quotes)'
); -- 24

update public.quotes set name = 'Hijacked' where id = 'f6000000-0000-0000-0000-00000000000a';

select is(
  (select name from public.quotes where id = 'f6000000-0000-0000-0000-00000000000a'),
  'HVAC Replacement Proposal (Revised)',
  'administratie_a''s UPDATE is silently excluded by RLS (read-only); name unchanged'
); -- 25

delete from public.quotes where id = 'f6000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.quotes where id = 'f6000000-0000-0000-0000-00000000000a'),
  1,
  'administratie_a''s DELETE is silently excluded by RLS (read-only); row still exists'
); -- 26

-- ---------------------------------------------------------------------------
-- 6. owner: direct UPDATE and DELETE on a quotes row (previously only
--    owner_a's INSERT/reference-list validations were exercised directly in
--    section 1 — owner_a's own UPDATE/DELETE write path was only exercised
--    indirectly via other roles' rejected attempts in sections 3-5, which
--    target quote_a and always expect it unchanged/still present). Uses its
--    own disposable row so quote_a/quote_b are left untouched for the later
--    sections that still depend on them.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

insert into public.quotes (id, client_id, name)
values ('f6000000-0000-0000-0000-00000000000f', 'f3000000-0000-0000-0000-00000000000a', 'Owner Disposable');

select lives_ok(
  $$ update public.quotes set name = 'Owner Disposable Renamed' where id = 'f6000000-0000-0000-0000-00000000000f' $$,
  'owner_a can directly update a quote in org_a'
); -- 27

select lives_ok(
  $$ delete from public.quotes where id = 'f6000000-0000-0000-0000-00000000000f' $$,
  'owner_a can directly delete a quote in org_a'
); -- 28

-- ---------------------------------------------------------------------------
-- 7. Tenant isolation: owner_b (org_b) cannot see or write org_a's quotes.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.quotes where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s quotes'
); -- 29

select throws_ok(
  $$ insert into public.quotes (client_id, name)
     values ('f3000000-0000-0000-0000-00000000000a', 'Hostile Cross Org Insert') $$,
  '42501',
  null,
  'owner_b cannot INSERT a quote under org_a''s client (not a member of org_a at all, so current_member_role is null)'
); -- 30

-- ---------------------------------------------------------------------------
-- 8. quote_line_items: owner/planner CRUD (same boundary as quotes itself —
--    "if you can manage the quote, you can manage its line items"); asset_id
--    must belong to the QUOTE's own client_id; engineer/finance/administratie
--    read-only; tenant isolation specifically on this table too.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.quote_line_items (id, quote_id, asset_id, description, quantity, unit_price)
     values ('f7000000-0000-0000-0000-00000000000a', 'f6000000-0000-0000-0000-00000000000a',
       'f5000000-0000-0000-0000-00000000000a', 'Replace compressor unit', 1, 1250.00) $$,
  'owner_a can insert a quote_line_items row on quote_a (Client A) with asset_a (Client A) — same client'
); -- 31

select is(
  (select organization_id from public.quote_line_items where id = 'f7000000-0000-0000-0000-00000000000a'),
  'f1000000-0000-0000-0000-00000000000a'::uuid,
  'quote_line_items.organization_id was auto-derived from the quote''s organization_id'
); -- 32

select is(
  (select created_by from public.quote_line_items where id = 'f7000000-0000-0000-0000-00000000000a'),
  'f2111111-1111-1111-1111-111111111111'::uuid,
  'quote_line_items.created_by was auto-stamped to the inserting user (trigger), not client-supplied'
); -- 33

select throws_ok(
  $$ insert into public.quote_line_items (quote_id, asset_id, description)
     values ('f6000000-0000-0000-0000-00000000000a', 'f5000000-0000-0000-0000-00000000000b', 'Wrong Client Asset') $$,
  '23514',
  null,
  'quote_line_items.asset_id from a different client (asset_a2, Client A2) is rejected on a quote under Client A, even though both are in org_a'
); -- 34

select lives_ok(
  $$ insert into public.quote_line_items (id, quote_id, description, quantity, unit_price, sort_order)
     values ('f7000000-0000-0000-0000-00000000000b', 'f6000000-0000-0000-0000-00000000000a', 'Labor: 4 hours', 4, 95.00, 1) $$,
  'owner_a can insert a quote_line_items row with asset_id omitted (line items don''t all need an asset link)'
); -- 35

select lives_ok(
  $$ update public.quote_line_items set unit_price = 99.00 where id = 'f7000000-0000-0000-0000-00000000000b' $$,
  'owner_a can update a quote_line_items row (unit_price)'
); -- 36

select is(
  (select unit_price from public.quote_line_items where id = 'f7000000-0000-0000-0000-00000000000b'),
  99.00::numeric,
  'owner_a''s update to unit_price took effect'
); -- 37

select pg_temp.act_as('f2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ update public.quote_line_items set quantity = 5 where id = 'f7000000-0000-0000-0000-00000000000b' $$,
  'planner_a can update any quote_line_items row in org_a, not just their own'
); -- 38

insert into public.quote_line_items (id, quote_id, description)
values ('f7000000-0000-0000-0000-00000000000c', 'f6000000-0000-0000-0000-00000000000a', 'Planner Disposable Line');

select lives_ok(
  $$ delete from public.quote_line_items where id = 'f7000000-0000-0000-0000-00000000000c' $$,
  'planner_a can directly delete a quote_line_items row'
); -- 39

select pg_temp.act_as('f2333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.quote_line_items where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  2,
  'engineer_a can SELECT every quote_line_items row in org_a (read-only, all rows)'
); -- 40

select throws_ok(
  $$ insert into public.quote_line_items (quote_id, description)
     values ('f6000000-0000-0000-0000-00000000000a', 'Engineer Attempt') $$,
  '42501',
  null,
  'engineer_a cannot INSERT a quote_line_items row (RBAC matrix: engineer is read-only on quotes)'
); -- 41

update public.quote_line_items set description = 'Hijacked' where id = 'f7000000-0000-0000-0000-00000000000a';

select is(
  (select description from public.quote_line_items where id = 'f7000000-0000-0000-0000-00000000000a'),
  'Replace compressor unit',
  'engineer_a''s UPDATE on quote_line_items is silently excluded by RLS (read-only); description unchanged'
); -- 42

delete from public.quote_line_items where id = 'f7000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.quote_line_items where id = 'f7000000-0000-0000-0000-00000000000a'),
  1,
  'engineer_a''s DELETE on quote_line_items is silently excluded by RLS (read-only); row still exists'
); -- 43

-- ---------------------------------------------------------------------------
-- 8c. finance: read-only on quote_line_items too (mirrors 4. above, on the
--    sibling table).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from public.quote_line_items where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  2,
  'finance_a can SELECT every quote_line_items row in org_a (read-only, all rows)'
); -- 44

select throws_ok(
  $$ insert into public.quote_line_items (quote_id, description)
     values ('f6000000-0000-0000-0000-00000000000a', 'Finance Attempt') $$,
  '42501',
  null,
  'finance_a cannot INSERT a quote_line_items row (RBAC matrix: finance is read-only on quotes, unlike contracts)'
); -- 45

update public.quote_line_items set description = 'Hijacked' where id = 'f7000000-0000-0000-0000-00000000000a';

select is(
  (select description from public.quote_line_items where id = 'f7000000-0000-0000-0000-00000000000a'),
  'Replace compressor unit',
  'finance_a''s UPDATE on quote_line_items is silently excluded by RLS (read-only); description unchanged'
); -- 46

delete from public.quote_line_items where id = 'f7000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.quote_line_items where id = 'f7000000-0000-0000-0000-00000000000a'),
  1,
  'finance_a''s DELETE on quote_line_items is silently excluded by RLS (read-only); row still exists'
); -- 47

-- ---------------------------------------------------------------------------
-- 8d. administratie: read-only on quote_line_items too (mirrors 5. above, on
--    the sibling table).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2555555-5555-5555-5555-555555555555');

select is(
  (select count(*)::int from public.quote_line_items where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  2,
  'administratie_a can SELECT every quote_line_items row in org_a (read-only, all rows)'
); -- 48

select throws_ok(
  $$ insert into public.quote_line_items (quote_id, description)
     values ('f6000000-0000-0000-0000-00000000000a', 'Administratie Attempt') $$,
  '42501',
  null,
  'administratie_a cannot INSERT a quote_line_items row (RBAC matrix: administratie is read-only on quotes)'
); -- 49

update public.quote_line_items set description = 'Hijacked' where id = 'f7000000-0000-0000-0000-00000000000a';

select is(
  (select description from public.quote_line_items where id = 'f7000000-0000-0000-0000-00000000000a'),
  'Replace compressor unit',
  'administratie_a''s UPDATE on quote_line_items is silently excluded by RLS (read-only); description unchanged'
); -- 50

delete from public.quote_line_items where id = 'f7000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.quote_line_items where id = 'f7000000-0000-0000-0000-00000000000a'),
  1,
  'administratie_a''s DELETE on quote_line_items is silently excluded by RLS (read-only); row still exists'
); -- 51

-- ---------------------------------------------------------------------------
-- 8b. Tenant isolation on quote_line_items specifically (not just quotes):
--    owner_b (org_b) cannot see org_a's quote_line_items rows, and cannot
--    INSERT a line item naming org_a's quote_id directly.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.quote_line_items where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s quote_line_items rows'
); -- 52

select throws_ok(
  $$ insert into public.quote_line_items (quote_id, description)
     values ('f6000000-0000-0000-0000-00000000000a', 'Hostile Cross Org Insert') $$,
  '42501',
  null,
  'owner_b cannot INSERT a quote_line_items row referencing org_a''s quote (not a member of org_a, so current_member_role is null)'
); -- 53

-- ---------------------------------------------------------------------------
-- 9. work_orders.source_quote_id: must belong to the same client_id as the
--    work order (validate_work_order_relations, extended by this migration).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.work_orders (client_id, title, source_quote_id)
     values ('f3000000-0000-0000-0000-00000000000a', 'Install From Accepted Quote', 'f6000000-0000-0000-0000-00000000000c') $$,
  'owner_a can insert a work order under client A with source_quote_id set to the Client A quote (same client)'
); -- 54

select throws_ok(
  $$ insert into public.work_orders (client_id, title, source_quote_id)
     values ('f3000000-0000-0000-0000-00000000000a', 'Wrong Quote Client', 'f6000000-0000-0000-0000-00000000000d') $$,
  '23514',
  null,
  'work_orders.source_quote_id from a different client (the Client A2 quote) is rejected when client_id=Client A'
); -- 55

-- ---------------------------------------------------------------------------
-- 10. contracts.source_quote_id: must belong to the same client_id as the
--    contract (the brand-new validate_contract_relations trigger).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.contracts (client_id, name, start_date, source_quote_id)
     values ('f3000000-0000-0000-0000-00000000000a', 'Contract From Accepted Quote', '2026-01-01', 'f6000000-0000-0000-0000-00000000000c') $$,
  'owner_a can insert a contract under client A with source_quote_id set to the Client A quote (same client)'
); -- 56

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, source_quote_id)
     values ('f3000000-0000-0000-0000-00000000000a', 'Wrong Quote Client Contract', '2026-01-01', 'f6000000-0000-0000-0000-00000000000d') $$,
  '23514',
  null,
  'contracts.source_quote_id from a different client (the Client A2 quote) is rejected when client_id=Client A'
); -- 57

select throws_ok(
  $$ insert into public.work_orders (client_id, title, source_quote_id)
     values ('f3000000-0000-0000-0000-00000000000a', 'Nonexistent Quote', '00000000-0000-0000-0000-000000000000') $$,
  '23503',
  null,
  'work_orders.source_quote_id pointing at a nonexistent quote is rejected (dangling reference)'
); -- 58

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, source_quote_id)
     values ('f3000000-0000-0000-0000-00000000000a', 'Nonexistent Quote Contract', '2026-01-01', '00000000-0000-0000-0000-000000000000') $$,
  '23503',
  null,
  'contracts.source_quote_id pointing at a nonexistent quote is rejected (dangling reference)'
); -- 59

select is(
  (select count(*)::int from public.quotes where id in ('f6000000-0000-0000-0000-00000000000c', 'f6000000-0000-0000-0000-00000000000d')),
  2,
  'both conversion-fixture quotes (Client A and Client A2) still exist, unaffected by the work_orders/contracts insert attempts above'
); -- 60

select * from finish();
rollback;
