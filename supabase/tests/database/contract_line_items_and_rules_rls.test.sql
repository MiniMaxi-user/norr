-- pgTAP RLS tests for contracts.billing_period_id, contract_line_items,
-- contract_article_group_rules, and contract_article_rules (issue #122,
-- 20260905100000_contracts_billing_period_line_items_and_article_rules.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/contracts_rls.test.sql and
-- supabase/tests/database/articles_rls.test.sql: switch to the
-- `authenticated` role and set `request.jwt.claims` to simulate auth.uid()
-- for a given fixture user. All auth.users rows here are test fixtures,
-- rolled back at the end of the transaction.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does
-- NOT raise an error — the row is silently excluded (0 rows changed). Only
-- INSERT/UPDATE `WITH CHECK` violations (and column-level privilege
-- revokes) raise error 42501.
--
-- Coverage: contracts.billing_period_id validated by (extended)
-- validate_contract_reference_items — correct list_key, same-organization,
-- no default-fill on omission (unlike type_id), freely updatable by owner/
-- finance; contract_line_items' organization_id/created_by derivation, the
-- article_id-must-be-same-org check, owner-or-finance write boundary
-- (including finance's own direct writes), contract_id immutability
-- (excluded from UPDATE grant), tenant isolation, and (issue #129,
-- 20260909100000_contract_line_items_volume_and_purchase_price.sql)
-- purchase_price/is_volume defaulting and owner/finance read-write access;
-- contract_article_ group_rules / contract_article_rules' identical shape —
-- organization_id derivation, the unique(contract_id,
-- article_group_id|article_id) constraint, the article_group_id/article_id-
-- must-be-same-org check, owner-or-finance write boundary, is_excluded-only
-- UPDATE grant (the pair itself is immutable), and tenant isolation.

begin;
create extension if not exists pgtap with schema extensions;

select plan(56);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with owner/planner/engineer/finance/administratie members,
-- one client, one contract, two article_groups, and two articles. org_b for
-- tenant isolation and cross-org hostile-reference tests (one article_group,
-- one article, captured billing_period item id).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('d2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('d2333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('d2444444-4444-4444-4444-444444444444', 'finance-a@test.local'),
  ('d2555555-5555-5555-5555-555555555555', 'administratie-a@test.local'),
  ('d2666666-6666-6666-6666-666666666666', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');

-- Created AFTER the first act_as call, so it's owned by role `authenticated`
-- (same reasoning as articles_rls.test.sql's own captured_ids table comment).
create table pg_temp.captured_ids (key text primary key, val uuid not null);

insert into public.organizations (id, name, created_by)
values ('d1000000-0000-0000-0000-00000000000a', 'Org A', 'd2111111-1111-1111-1111-111111111111');

-- Bootstrap owner row and the other members' rows are separate statements
-- (not one multi-row VALUES list) — a row inserted earlier in the SAME
-- statement is not yet visible to that statement's own is_org_owner(...)
-- re-check (same gotcha documented in articles_rls.test.sql).
insert into public.memberships (user_id, organization_id, role)
values ('d2111111-1111-1111-1111-111111111111', 'd1000000-0000-0000-0000-00000000000a', 'owner');

insert into public.memberships (user_id, organization_id, role) values
  ('d2222222-2222-2222-2222-222222222222', 'd1000000-0000-0000-0000-00000000000a', 'planner'),
  ('d2333333-3333-3333-3333-333333333333', 'd1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('d2444444-4444-4444-4444-444444444444', 'd1000000-0000-0000-0000-00000000000a', 'finance'),
  ('d2555555-5555-5555-5555-555555555555', 'd1000000-0000-0000-0000-00000000000a', 'administratie');

insert into public.clients (id, organization_id, name) values
  ('d3000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'Client A');

insert into public.contracts (id, client_id, name, start_date)
values ('d6000000-0000-0000-0000-00000000000a', 'd3000000-0000-0000-0000-00000000000a', 'Contract A', '2026-01-01');

insert into public.article_groups (id, organization_id, name) values
  ('d7000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'Group A'),
  ('d7000000-0000-0000-0000-00000000000b', 'd1000000-0000-0000-0000-00000000000a', 'Group A2');

insert into public.articles (id, organization_id, article_number, description) values
  ('d8000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a', 'ART-A-001', 'Article A'),
  ('d8000000-0000-0000-0000-00000000000b', 'd1000000-0000-0000-0000-00000000000a', 'ART-A-002', 'Article A2');

select pg_temp.act_as('d2666666-6666-6666-6666-666666666666');

insert into public.organizations (id, name, created_by)
values ('d1000000-0000-0000-0000-00000000000b', 'Org B', 'd2666666-6666-6666-6666-666666666666');

insert into public.memberships (user_id, organization_id, role)
values ('d2666666-6666-6666-6666-666666666666', 'd1000000-0000-0000-0000-00000000000b', 'owner');

insert into public.article_groups (id, organization_id, name)
values ('d7000000-0000-0000-0000-00000000000f', 'd1000000-0000-0000-0000-00000000000b', 'Org B Group');

insert into public.articles (id, organization_id, article_number, description)
values ('d8000000-0000-0000-0000-00000000000f', 'd1000000-0000-0000-0000-00000000000b', 'ORGB-001', 'Org B Article');

insert into pg_temp.captured_ids (key, val) values
  ('org_b_article_group_id', 'd7000000-0000-0000-0000-00000000000f'),
  ('org_b_article_id', 'd8000000-0000-0000-0000-00000000000f');

insert into pg_temp.captured_ids (key, val)
select 'org_b_billing_period_monthly_id', rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = 'd1000000-0000-0000-0000-00000000000b'
  and rl.list_key = 'billing_period' and rli.value = 'monthly';

select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 1. contracts.billing_period_id: correct list_key, same-organization,
--    no default-fill on omission, freely updatable by owner/finance.
-- ---------------------------------------------------------------------------

select is(
  (select billing_period_id from public.contracts where id = 'd6000000-0000-0000-0000-00000000000a'),
  null::uuid,
  'contracts.billing_period_id stays null when omitted on insert — no default-fill (unlike type_id)'
); -- 1

select lives_ok(
  $$ insert into public.contracts (id, client_id, name, start_date, billing_period_id)
     select 'd6000000-0000-0000-0000-00000000000b', 'd3000000-0000-0000-0000-00000000000a',
       'Contract B', '2026-01-01', rli.id
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'billing_period' and rli.value = 'quarterly' $$,
  'owner_a can insert a contract with billing_period_id=quarterly (own org billing_period list)'
); -- 2

select is(
  (select rli.value from public.contracts c
     join public.reference_list_items rli on rli.id = c.billing_period_id
     where c.id = 'd6000000-0000-0000-0000-00000000000b'),
  'quarterly',
  'the just-inserted contract''s billing_period_id resolves to quarterly'
); -- 3

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, billing_period_id)
     select 'd3000000-0000-0000-0000-00000000000a', 'Wrong List Period', '2026-01-01', rli.id
     from public.reference_list_items rli
     join public.reference_lists rl on rl.id = rli.reference_list_id
     where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
       and rl.list_key = 'billing_terms' and rli.value = 'monthly' $$,
  '23514',
  null,
  'contracts.billing_period_id must be from the billing_period list, not billing_terms (validate_contract_reference_items)'
); -- 4

select throws_ok(
  $$ insert into public.contracts (client_id, name, start_date, billing_period_id)
     select 'd3000000-0000-0000-0000-00000000000a', 'Cross Org Period', '2026-01-01', val
     from pg_temp.captured_ids where key = 'org_b_billing_period_monthly_id' $$,
  '23514',
  null,
  'contracts.billing_period_id from a different organization''s billing_period list (org_b''s) is rejected'
); -- 5

select lives_ok(
  $$ update public.contracts set billing_period_id =
       (select rli.id from public.reference_list_items rli
          join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'd1000000-0000-0000-0000-00000000000a'
            and rl.list_key = 'billing_period' and rli.value = 'annually')
     where id = 'd6000000-0000-0000-0000-00000000000a' $$,
  'owner_a can update contract_a''s billing_period_id (freely editable, no immutability)'
); -- 6

select is(
  (select rli.value from public.contracts c
     join public.reference_list_items rli on rli.id = c.billing_period_id
     where c.id = 'd6000000-0000-0000-0000-00000000000a'),
  'annually',
  'contract_a''s billing_period_id update took effect'
); -- 7

-- ---------------------------------------------------------------------------
-- 2. contract_line_items: derivation, cross-org article check, owner-or-
--    finance write boundary, contract_id immutability, tenant isolation,
--    and (issue #129) purchase_price/is_volume defaulting + read-write
--    access.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.contract_line_items (id, contract_id, article_id, quantity, unit_price, sort_order)
     values ('d9000000-0000-0000-0000-00000000000a', 'd6000000-0000-0000-0000-00000000000a',
       'd8000000-0000-0000-0000-00000000000a', 2, 150.50, 1) $$,
  'owner_a can insert a contract_line_items row for contract_a / article_a'
); -- 8

select is(
  (select organization_id from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000a'),
  'd1000000-0000-0000-0000-00000000000a'::uuid,
  'contract_line_items.organization_id was auto-derived from the contract''s organization_id'
); -- 9

select is(
  (select created_by from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000a'),
  'd2111111-1111-1111-1111-111111111111'::uuid,
  'contract_line_items.created_by was auto-stamped to the inserting user, not client-supplied'
); -- 10

-- issue #129 (20260909100000_contract_line_items_volume_and_purchase_price.sql):
-- purchase_price/is_volume both default when omitted on insert, mirroring
-- unit_price's own default-value shape (not a NULL — a concrete default).
select is(
  (select purchase_price from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000a'),
  0.00,
  'contract_line_items.purchase_price defaults to 0 when omitted on insert'
); -- 11

select is(
  (select is_volume from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000a'),
  false,
  'contract_line_items.is_volume defaults to false when omitted on insert'
); -- 12

select throws_ok(
  $$ insert into public.contract_line_items (contract_id, article_id)
     select 'd6000000-0000-0000-0000-00000000000a', val
     from pg_temp.captured_ids where key = 'org_b_article_id' $$,
  '23514',
  null,
  'contract_line_items.article_id from a different organization (org_b''s article) is rejected'
); -- 13

select throws_ok(
  $$ insert into public.contract_line_items (contract_id, article_id, organization_id)
     values ('d6000000-0000-0000-0000-00000000000a', 'd8000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_a cannot set contract_line_items.organization_id directly on insert (column-level grant withheld)'
); -- 14

select throws_ok(
  $$ insert into public.contract_line_items (contract_id, article_id, created_by)
     values ('d6000000-0000-0000-0000-00000000000a', 'd8000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000') $$,
  '42501',
  null,
  'owner_a cannot set contract_line_items.created_by directly on insert (column-level grant withheld)'
); -- 15

select pg_temp.act_as('d2222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.contract_line_items (contract_id, article_id)
     values ('d6000000-0000-0000-0000-00000000000a', 'd8000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'planner_a cannot INSERT a contract_line_items row (same owner-or-finance write boundary as contracts itself)'
); -- 16

update public.contract_line_items set unit_price = 0 where id = 'd9000000-0000-0000-0000-00000000000a';

select is(
  (select unit_price from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000a'),
  150.50,
  'planner_a''s UPDATE is silently excluded by RLS (read-only); unit_price unchanged'
); -- 17

delete from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000a'),
  1,
  'planner_a''s DELETE is silently excluded by RLS (read-only); row still exists'
); -- 18

select pg_temp.act_as('d2444444-4444-4444-4444-444444444444');

-- issue #129: finance_a can insert/update purchase_price and is_volume
-- directly (both are in the column-level INSERT/UPDATE grants, same as
-- unit_price — no column-grant withholding for these two, unlike
-- organization_id/created_by above).
select lives_ok(
  $$ insert into public.contract_line_items
       (id, contract_id, article_id, purchase_price, is_volume)
     values ('d9000000-0000-0000-0000-00000000000b', 'd6000000-0000-0000-0000-00000000000a',
       'd8000000-0000-0000-0000-00000000000b', 75.25, true) $$,
  'finance_a can insert a contract_line_items row with explicit purchase_price/is_volume'
); -- 19

select is(
  (select purchase_price from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000b'),
  75.25,
  'the just-inserted row''s purchase_price was stored as supplied (issue #129 snapshot-at-signing column)'
); -- 20

select is(
  (select is_volume from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000b'),
  true,
  'the just-inserted row''s is_volume was stored as supplied ("Volume" line item flag)'
); -- 21

select lives_ok(
  $$ update public.contract_line_items
     set unit_price = 42.00, purchase_price = 10.00, is_volume = false
     where id = 'd9000000-0000-0000-0000-00000000000b' $$,
  'finance_a can update a contract_line_items row, including purchase_price/is_volume'
); -- 22

select is(
  (select unit_price from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000b'),
  42.00,
  'finance_a''s unit_price update took effect'
); -- 23

select is(
  (select purchase_price from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000b'),
  10.00,
  'finance_a''s purchase_price update took effect'
); -- 24

select is(
  (select is_volume from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000b'),
  false,
  'finance_a''s is_volume update took effect'
); -- 25

select lives_ok(
  $$ delete from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000b' $$,
  'finance_a can delete a contract_line_items row'
); -- 26

select is(
  (select count(*)::int from public.contract_line_items where id = 'd9000000-0000-0000-0000-00000000000b'),
  0,
  'the deleted contract_line_items row is actually gone'
); -- 27

select throws_ok(
  $$ update public.contract_line_items set contract_id = 'd6000000-0000-0000-0000-00000000000b'
     where id = 'd9000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'contract_line_items.contract_id is immutable after creation (excluded from the UPDATE column grant)'
); -- 28

select pg_temp.act_as('d2666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.contract_line_items where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s contract_line_items rows'
); -- 29

select throws_ok(
  $$ insert into public.contract_line_items (contract_id, article_id)
     values ('d6000000-0000-0000-0000-00000000000a', 'd8000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_b cannot INSERT a contract_line_items row referencing org_a''s contract/article (not a member of org_a)'
); -- 30

select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 3. contract_article_group_rules: derivation, unique(contract_id,
--    article_group_id), cross-org check, owner-or-finance write boundary,
--    is_excluded-only UPDATE grant, tenant isolation.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.contract_article_group_rules (id, contract_id, article_group_id, is_excluded)
     values ('da000000-0000-0000-0000-00000000000a', 'd6000000-0000-0000-0000-00000000000a',
       'd7000000-0000-0000-0000-00000000000a', true) $$,
  'owner_a can insert a contract_article_group_rules row for contract_a / group A'
); -- 31

select is(
  (select organization_id from public.contract_article_group_rules where id = 'da000000-0000-0000-0000-00000000000a'),
  'd1000000-0000-0000-0000-00000000000a'::uuid,
  'contract_article_group_rules.organization_id was auto-derived from the contract''s organization_id'
); -- 32

select throws_ok(
  $$ insert into public.contract_article_group_rules (contract_id, article_group_id)
     values ('d6000000-0000-0000-0000-00000000000a', 'd7000000-0000-0000-0000-00000000000a') $$,
  '23505',
  null,
  'a second rule for the same (contract_id, article_group_id) pair violates the unique constraint'
); -- 33

select throws_ok(
  $$ insert into public.contract_article_group_rules (contract_id, article_group_id)
     select 'd6000000-0000-0000-0000-00000000000a', val
     from pg_temp.captured_ids where key = 'org_b_article_group_id' $$,
  '23514',
  null,
  'contract_article_group_rules.article_group_id from a different organization (org_b''s group) is rejected'
); -- 34

select lives_ok(
  $$ update public.contract_article_group_rules set is_excluded = false
     where id = 'da000000-0000-0000-0000-00000000000a' $$,
  'owner_a can update is_excluded on an existing rule'
); -- 35

select is(
  (select is_excluded from public.contract_article_group_rules where id = 'da000000-0000-0000-0000-00000000000a'),
  false,
  'the is_excluded update took effect'
); -- 36

select throws_ok(
  $$ update public.contract_article_group_rules set article_group_id = 'd7000000-0000-0000-0000-00000000000b'
     where id = 'da000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'contract_article_group_rules.article_group_id is immutable after creation (excluded from the UPDATE column grant)'
); -- 37

select pg_temp.act_as('d2222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.contract_article_group_rules (contract_id, article_group_id)
     values ('d6000000-0000-0000-0000-00000000000a', 'd7000000-0000-0000-0000-00000000000b') $$,
  '42501',
  null,
  'planner_a cannot INSERT a contract_article_group_rules row (owner-or-finance write boundary)'
); -- 38

select pg_temp.act_as('d2444444-4444-4444-4444-444444444444');

select lives_ok(
  $$ insert into public.contract_article_group_rules (id, contract_id, article_group_id, is_excluded)
     values ('da000000-0000-0000-0000-00000000000b', 'd6000000-0000-0000-0000-00000000000a',
       'd7000000-0000-0000-0000-00000000000b', false) $$,
  'finance_a can insert a contract_article_group_rules row (for group A2)'
); -- 39

select lives_ok(
  $$ delete from public.contract_article_group_rules where id = 'da000000-0000-0000-0000-00000000000b' $$,
  'finance_a can delete a contract_article_group_rules row'
); -- 40

select is(
  (select count(*)::int from public.contract_article_group_rules where id = 'da000000-0000-0000-0000-00000000000b'),
  0,
  'the deleted contract_article_group_rules row is actually gone'
); -- 41

select pg_temp.act_as('d2666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.contract_article_group_rules where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s contract_article_group_rules rows'
); -- 42

select throws_ok(
  $$ insert into public.contract_article_group_rules (contract_id, article_group_id)
     values ('d6000000-0000-0000-0000-00000000000a', 'd7000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_b cannot INSERT a contract_article_group_rules row referencing org_a''s contract/group (not a member of org_a)'
); -- 43

select pg_temp.act_as('d2111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- 4. contract_article_rules: the article-level sibling of section 3, same
--    coverage shape.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.contract_article_rules (id, contract_id, article_id, is_excluded)
     values ('db000000-0000-0000-0000-00000000000a', 'd6000000-0000-0000-0000-00000000000a',
       'd8000000-0000-0000-0000-00000000000a', true) $$,
  'owner_a can insert a contract_article_rules row for contract_a / article_a'
); -- 44

select is(
  (select organization_id from public.contract_article_rules where id = 'db000000-0000-0000-0000-00000000000a'),
  'd1000000-0000-0000-0000-00000000000a'::uuid,
  'contract_article_rules.organization_id was auto-derived from the contract''s organization_id'
); -- 45

select throws_ok(
  $$ insert into public.contract_article_rules (contract_id, article_id)
     values ('d6000000-0000-0000-0000-00000000000a', 'd8000000-0000-0000-0000-00000000000a') $$,
  '23505',
  null,
  'a second rule for the same (contract_id, article_id) pair violates the unique constraint'
); -- 46

select throws_ok(
  $$ insert into public.contract_article_rules (contract_id, article_id)
     select 'd6000000-0000-0000-0000-00000000000a', val
     from pg_temp.captured_ids where key = 'org_b_article_id' $$,
  '23514',
  null,
  'contract_article_rules.article_id from a different organization (org_b''s article) is rejected'
); -- 47

select lives_ok(
  $$ update public.contract_article_rules set is_excluded = false
     where id = 'db000000-0000-0000-0000-00000000000a' $$,
  'owner_a can update is_excluded on an existing rule'
); -- 48

select is(
  (select is_excluded from public.contract_article_rules where id = 'db000000-0000-0000-0000-00000000000a'),
  false,
  'the is_excluded update took effect'
); -- 49

select throws_ok(
  $$ update public.contract_article_rules set article_id = 'd8000000-0000-0000-0000-00000000000b'
     where id = 'db000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'contract_article_rules.article_id is immutable after creation (excluded from the UPDATE column grant)'
); -- 50

select pg_temp.act_as('d2222222-2222-2222-2222-222222222222');

select throws_ok(
  $$ insert into public.contract_article_rules (contract_id, article_id)
     values ('d6000000-0000-0000-0000-00000000000a', 'd8000000-0000-0000-0000-00000000000b') $$,
  '42501',
  null,
  'planner_a cannot INSERT a contract_article_rules row (owner-or-finance write boundary)'
); -- 51

select pg_temp.act_as('d2444444-4444-4444-4444-444444444444');

select lives_ok(
  $$ insert into public.contract_article_rules (id, contract_id, article_id, is_excluded)
     values ('db000000-0000-0000-0000-00000000000b', 'd6000000-0000-0000-0000-00000000000a',
       'd8000000-0000-0000-0000-00000000000b', false) $$,
  'finance_a can insert a contract_article_rules row (for article A2)'
); -- 52

select lives_ok(
  $$ delete from public.contract_article_rules where id = 'db000000-0000-0000-0000-00000000000b' $$,
  'finance_a can delete a contract_article_rules row'
); -- 53

select is(
  (select count(*)::int from public.contract_article_rules where id = 'db000000-0000-0000-0000-00000000000b'),
  0,
  'the deleted contract_article_rules row is actually gone'
); -- 54

select pg_temp.act_as('d2666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.contract_article_rules where organization_id = 'd1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s contract_article_rules rows'
); -- 55

select throws_ok(
  $$ insert into public.contract_article_rules (contract_id, article_id)
     values ('d6000000-0000-0000-0000-00000000000a', 'd8000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_b cannot INSERT a contract_article_rules row referencing org_a''s contract/article (not a member of org_a)'
); -- 56

select * from finish();
rollback;
