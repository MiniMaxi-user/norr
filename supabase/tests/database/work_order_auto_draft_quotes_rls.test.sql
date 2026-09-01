-- pgTAP tests for the Work Order auto-draft Quote feature (issue #109,
-- 20260901090000_work_order_auto_draft_quotes.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/work_order_articles_rls.test.sql /
-- contracts_rls.test.sql (captured_ids helper table for reference-list item
-- lookups). Coverage:
--   - A work order INSERT always creates exactly one is_auto_draft quote
--     (name pattern, status default, client_id/site_id copied).
--   - is_auto_draft is withheld from the INSERT grant (system-only) but
--     present on the UPDATE grant (promotion), and the
--     quotes_auto_draft_requires_work_order / quotes_one_auto_draft_per_
--     work_order_idx constraints.
--   - An ENGINEER can INSERT/UPDATE/DELETE time_entries and
--     work_order_articles (their own rows) and have that transitively
--     upsert/delete the auto-draft's quote_line_items via the SECURITY
--     DEFINER sync triggers, despite having NO direct INSERT/UPDATE/DELETE
--     rights on quotes/quote_line_items at all (verified directly).
--   - Full 4-layer resolve_billing_rate precedence: client override ->
--     engineer override -> org default -> unresolved (no line item, then
--     resolves once the org default is configured and the row is re-synced).
--   - Break-type and rounds-to-zero-hours time entries never get a line
--     item.
--   - Sync stops after promotion (is_auto_draft -> false): a further
--     INSERT against that work order's time_entries no longer produces a
--     line item.
--   - organizations.default_travel_article_id/default_work_article_id
--     cross-org rejection and owner-only write (RLS-silent-exclusion style).
--   - resolve_billing_rate's is_member_of_org guard rejects a caller from a
--     different organization.
--   - Tenant isolation throughout.

begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('f2111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('f2222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('f2333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('f2444444-4444-4444-4444-444444444444', 'engineer-a2@test.local'),
  ('f2777777-7777-7777-7777-777777777777', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create table pg_temp.captured_ids (key text primary key, val uuid not null);
grant all on pg_temp.captured_ids to authenticated;

select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('f1000000-0000-0000-0000-00000000000a', 'Org A', 'f2111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role) values
  ('f2111111-1111-1111-1111-111111111111', 'f1000000-0000-0000-0000-00000000000a', 'owner'),
  ('f2222222-2222-2222-2222-222222222222', 'f1000000-0000-0000-0000-00000000000a', 'planner'),
  ('f2333333-3333-3333-3333-333333333333', 'f1000000-0000-0000-0000-00000000000a', 'engineer'),
  ('f2444444-4444-4444-4444-444444444444', 'f1000000-0000-0000-0000-00000000000a', 'engineer');

-- client_custom: has_custom_rate = true (layer 1). client_plain: no
-- override, used to exercise layers 2/3/4.
insert into public.clients (id, organization_id, name) values
  ('f3000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 'Client Custom'),
  ('f3000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-00000000000a', 'Client Plain');

-- Articles: one travel+work pair per resolution layer, plus one material.
insert into public.articles (id, organization_id, article_number, description, purchase_price, sale_price) values
  ('f6000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-00000000000a', 'ART-CLI-TRV', 'Client travel override article', 20.00, 50.00),
  ('f6000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-00000000000a', 'ART-CLI-WRK', 'Client work override article', 30.00, 80.00),
  ('f6000000-0000-0000-0000-00000000000c', 'f1000000-0000-0000-0000-00000000000a', 'ART-ENG-TRV', 'Engineer travel override article', 22.00, 55.00),
  ('f6000000-0000-0000-0000-00000000000d', 'f1000000-0000-0000-0000-00000000000a', 'ART-ENG-WRK', 'Engineer work override article', 33.00, 85.00),
  ('f6000000-0000-0000-0000-00000000000e', 'f1000000-0000-0000-0000-00000000000a', 'ART-ORG-TRV', 'Org default travel article', 18.00, 45.00),
  ('f6000000-0000-0000-0000-00000000000f', 'f1000000-0000-0000-0000-00000000000a', 'ART-ORG-WRK', 'Org default work article', 28.00, 75.00),
  ('f6000000-0000-0000-0000-000000000010', 'f1000000-0000-0000-0000-00000000000a', 'ART-MAT', 'Consumed material', 6.00, 12.50);

-- Client Custom's own rate override (layer 1) — override price deliberately
-- differs from the article's own sale_price, to prove the OVERRIDE price is
-- read, not the article's live price.
update public.clients
set has_custom_rate = true,
    travel_article_id = 'f6000000-0000-0000-0000-00000000000a',
    travel_sale_price = 52.00,
    work_article_id = 'f6000000-0000-0000-0000-00000000000b',
    work_sale_price = 82.00
where id = 'f3000000-0000-0000-0000-00000000000a';

-- engineer_a2's own rate override (layer 2).
update public.memberships
set has_custom_rate = true,
    travel_article_id = 'f6000000-0000-0000-0000-00000000000c',
    travel_sale_price = 57.00,
    work_article_id = 'f6000000-0000-0000-0000-00000000000d',
    work_sale_price = 87.00
where user_id = 'f2444444-4444-4444-4444-444444444444'
  and organization_id = 'f1000000-0000-0000-0000-00000000000a';

-- Org B, for tenant isolation.
select pg_temp.act_as('f2777777-7777-7777-7777-777777777777');

insert into public.organizations (id, name, created_by)
values ('f1000000-0000-0000-0000-00000000000b', 'Org B', 'f2777777-7777-7777-7777-777777777777');

insert into public.memberships (user_id, organization_id, role)
values ('f2777777-7777-7777-7777-777777777777', 'f1000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name)
values ('f3000000-0000-0000-0000-00000000000c', 'f1000000-0000-0000-0000-00000000000b', 'Client B');

insert into public.articles (id, organization_id, article_number, description, purchase_price, sale_price)
values ('f6000000-0000-0000-0000-000000000009', 'f1000000-0000-0000-0000-00000000000b', 'ART-B-001', 'Org B article', 1.00, 2.00);

-- ---------------------------------------------------------------------------
-- 1. Work order INSERT always creates its own is_auto_draft quote.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ insert into public.work_orders (id, client_id, title, assigned_to)
     values ('f4000000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-00000000000a', 'WO Custom Client', 'f2333333-3333-3333-3333-333333333333') $$,
  'owner_a can create a work order under Client Custom'
); -- 1

select is(
  (select count(*)::int from public.quotes where work_order_id = 'f4000000-0000-0000-0000-00000000000a' and is_auto_draft),
  1,
  'exactly one is_auto_draft quote was auto-created for the new work order'
); -- 2

select is(
  (select name from public.quotes where work_order_id = 'f4000000-0000-0000-0000-00000000000a' and is_auto_draft),
  'Quote — WO Custom Client',
  'the auto-draft quote''s name mirrors the "Quote — {title}" pattern'
); -- 3

select is(
  (select client_id from public.quotes where work_order_id = 'f4000000-0000-0000-0000-00000000000a' and is_auto_draft),
  'f3000000-0000-0000-0000-00000000000a'::uuid,
  'the auto-draft quote''s client_id was copied from the work order'
); -- 4

select isnt(
  (select status_id from public.quotes where work_order_id = 'f4000000-0000-0000-0000-00000000000a' and is_auto_draft),
  null::uuid,
  'the auto-draft quote''s status_id was filled in with the org''s default quote_status item'
); -- 5

insert into public.work_orders (id, client_id, title, assigned_to)
values ('f4000000-0000-0000-0000-00000000000b', 'f3000000-0000-0000-0000-00000000000b', 'WO Plain Engineer', 'f2444444-4444-4444-4444-444444444444');

insert into public.work_orders (id, client_id, title, assigned_to)
values ('f4000000-0000-0000-0000-00000000000c', 'f3000000-0000-0000-0000-00000000000b', 'WO Unresolved', 'f2333333-3333-3333-3333-333333333333');

insert into pg_temp.captured_ids (key, val)
select 'wo_custom_quote_id', id from public.quotes where work_order_id = 'f4000000-0000-0000-0000-00000000000a' and is_auto_draft;
insert into pg_temp.captured_ids (key, val)
select 'wo_plain_quote_id', id from public.quotes where work_order_id = 'f4000000-0000-0000-0000-00000000000b' and is_auto_draft;

-- ---------------------------------------------------------------------------
-- 2. is_auto_draft: withheld from INSERT grant, present on UPDATE grant,
--    quotes_auto_draft_requires_work_order, quotes_one_auto_draft_per_
--    work_order_idx.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.quotes (client_id, name, work_order_id, is_auto_draft)
     values ('f3000000-0000-0000-0000-00000000000a', 'Hostile auto-draft', 'f4000000-0000-0000-0000-00000000000a', true) $$,
  '42501',
  null,
  'owner_a cannot set is_auto_draft directly on INSERT (column-level grant withheld — system-only, set by the trigger)'
); -- 6

select lives_ok(
  $$ insert into public.quotes (id, client_id, name)
     values ('f7000000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-00000000000a', 'Plain manual quote') $$,
  'owner_a can insert an ordinary (non-auto-draft, no work_order_id) quote'
); -- 7

select throws_ok(
  $$ update public.quotes set is_auto_draft = true where id = 'f7000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'flipping is_auto_draft to true on a quote with no work_order_id is rejected (quotes_auto_draft_requires_work_order)'
); -- 8

select lives_ok(
  $$ insert into public.quotes (id, client_id, name, work_order_id)
     values ('f7000000-0000-0000-0000-00000000000b', 'f3000000-0000-0000-0000-00000000000b', 'Second quote for WO Plain Engineer', 'f4000000-0000-0000-0000-00000000000b') $$,
  'owner_a can insert a second (non-auto-draft) quote pointed at a work order that already has an auto-draft'
); -- 9

select throws_ok(
  $$ update public.quotes set is_auto_draft = true where id = 'f7000000-0000-0000-0000-00000000000b' $$,
  '23505',
  null,
  'flipping that second quote''s is_auto_draft to true conflicts with the existing auto-draft on the same work_order_id (quotes_one_auto_draft_per_work_order_idx)'
); -- 10

select lives_ok(
  $$ update public.quotes set is_auto_draft = false
     where id = (select val from pg_temp.captured_ids where key = 'wo_plain_quote_id') $$,
  'owner_a CAN promote (flip false) the auto-draft for WO Plain Engineer via the UPDATE grant (promotion action)'
); -- 11

-- ---------------------------------------------------------------------------
-- 3. Layer 1 (client override): engineer_a logs time on WO Custom Client.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2333333-3333-3333-3333-333333333333');

select throws_ok(
  $$ insert into public.quote_line_items (quote_id, description)
     values ((select val from pg_temp.captured_ids where key = 'wo_custom_quote_id'), 'hostile direct insert') $$,
  '42501',
  null,
  'engineer_a cannot directly INSERT a quote_line_items row (no write rights on quotes/quote_line_items at all)'
); -- 12

select lives_ok(
  $$ insert into public.time_entries (id, work_order_id, user_id, entry_type_id, started_at, ended_at)
     values (
       'f8000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000a',
       'f2333333-3333-3333-3333-333333333333',
       (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'time_entry_type' and rli.value = 'labor'),
       '2026-09-01 09:00:00+00', '2026-09-01 11:00:00+00'
     ) $$,
  'engineer_a can log a 2-hour Labor time entry on WO Custom Client (own row, per existing time_entries RLS)'
); -- 13

select is(
  (select article_id from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-00000000000a'),
  'f6000000-0000-0000-0000-00000000000b'::uuid,
  'the synced line item resolved to Client Custom''s work override article (layer 1), not the org default'
); -- 14

select is(
  (select unit_price from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-00000000000a'),
  82.00::numeric,
  'the synced line item''s unit_price is the CLIENT override price (82.00), not the article''s own live sale_price (80.00)'
); -- 15

select is(
  (select purchase_price from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-00000000000a'),
  30.00::numeric,
  'the synced line item''s purchase_price was frozen from the resolved article''s live purchase_price at sync time'
); -- 16

select is(
  (select quantity from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-00000000000a'),
  2.00::numeric,
  'the synced line item''s quantity is 2.00 hours (2-hour entry)'
); -- 17

select lives_ok(
  $$ insert into public.time_entries (id, work_order_id, user_id, entry_type_id, started_at, ended_at)
     values (
       'f8000000-0000-0000-0000-00000000000b', 'f4000000-0000-0000-0000-00000000000a',
       'f2333333-3333-3333-3333-333333333333',
       (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'time_entry_type' and rli.value = 'travel'),
       '2026-09-01 08:00:00+00', '2026-09-01 09:00:00+00'
     ) $$,
  'engineer_a can log a 1-hour Travel time entry on the same work order'
); -- 18

select is(
  (select unit_price from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-00000000000b'),
  52.00::numeric,
  'the Travel entry resolved to Client Custom''s travel override price (52.00)'
); -- 19

-- Break entries and rounds-to-zero entries never get a line item.
select lives_ok(
  $$ insert into public.time_entries (id, work_order_id, user_id, entry_type_id, started_at, ended_at)
     values (
       'f8000000-0000-0000-0000-00000000000c', 'f4000000-0000-0000-0000-00000000000a',
       'f2333333-3333-3333-3333-333333333333',
       (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'time_entry_type' and rli.value = 'break'),
       '2026-09-01 12:00:00+00', '2026-09-01 12:15:00+00'
     ) $$,
  'engineer_a can log a Break entry'
); -- 20

select is(
  (select count(*)::int from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-00000000000c'),
  0,
  'a Break entry never gets a synced line item (not billable)'
); -- 21

select lives_ok(
  $$ insert into public.time_entries (id, work_order_id, user_id, entry_type_id, started_at, ended_at)
     values (
       'f8000000-0000-0000-0000-00000000000d', 'f4000000-0000-0000-0000-00000000000a',
       'f2333333-3333-3333-3333-333333333333',
       (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'time_entry_type' and rli.value = 'labor'),
       '2026-09-01 13:00:00+00', '2026-09-01 13:00:05+00'
     ) $$,
  'engineer_a can log a 5-second Labor entry'
); -- 22

select is(
  (select count(*)::int from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-00000000000d'),
  0,
  'a 5-second entry rounds to 0.00 hours and never gets a synced line item'
); -- 23

-- ---------------------------------------------------------------------------
-- 4. Layer 2 (engineer override): engineer_a2 logs time on WO Plain Engineer
--    (client_plain has no override) — but that quote was already promoted
--    above (step 11), so sync must be a no-op.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2444444-4444-4444-4444-444444444444');

select lives_ok(
  $$ insert into public.time_entries (id, work_order_id, user_id, entry_type_id, started_at, ended_at)
     values (
       'f8000000-0000-0000-0000-00000000000e', 'f4000000-0000-0000-0000-00000000000b',
       'f2444444-4444-4444-4444-444444444444',
       (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'time_entry_type' and rli.value = 'labor'),
       '2026-09-01 09:00:00+00', '2026-09-01 12:00:00+00'
     ) $$,
  'engineer_a2 can log a 3-hour Labor time entry on WO Plain Engineer (already-promoted auto-draft)'
); -- 24

select is(
  (select count(*)::int from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-00000000000e'),
  0,
  'no line item is synced — the owning quote was already promoted (is_auto_draft = false), sync has permanently stopped'
); -- 25

-- Re-run the SAME scenario on a fresh, still-auto-draft work order to
-- actually exercise layer 2's resolution.
select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

insert into public.work_orders (id, client_id, title, assigned_to)
values ('f4000000-0000-0000-0000-00000000000d', 'f3000000-0000-0000-0000-00000000000b', 'WO Plain Engineer 2', 'f2444444-4444-4444-4444-444444444444');

select pg_temp.act_as('f2444444-4444-4444-4444-444444444444');

select lives_ok(
  $$ insert into public.time_entries (id, work_order_id, user_id, entry_type_id, started_at, ended_at)
     values (
       'f8000000-0000-0000-0000-00000000000f', 'f4000000-0000-0000-0000-00000000000d',
       'f2444444-4444-4444-4444-444444444444',
       (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'time_entry_type' and rli.value = 'labor'),
       '2026-09-01 09:00:00+00', '2026-09-01 12:00:00+00'
     ) $$,
  'engineer_a2 can log a 3-hour Labor time entry on WO Plain Engineer 2 (still an active auto-draft)'
); -- 26

select is(
  (select article_id from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-00000000000f'),
  'f6000000-0000-0000-0000-00000000000d'::uuid,
  'resolved to engineer_a2''s own work override article (layer 2), since client_plain has no override'
); -- 27

select is(
  (select unit_price from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-00000000000f'),
  87.00::numeric,
  'unit_price is engineer_a2''s own override price (87.00)'
); -- 28

-- ---------------------------------------------------------------------------
-- 5. Layer 3/4 (org default / unresolved): engineer_a logs time on
--    WO Unresolved (client_plain, engineer_a has no override) BEFORE the
--    org default is configured, then again AFTER.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ insert into public.time_entries (id, work_order_id, user_id, entry_type_id, started_at, ended_at)
     values (
       'f8000000-0000-0000-0000-000000000010', 'f4000000-0000-0000-0000-00000000000c',
       'f2333333-3333-3333-3333-333333333333',
       (select rli.id from public.reference_list_items rli join public.reference_lists rl on rl.id = rli.reference_list_id
          where rl.organization_id = 'f1000000-0000-0000-0000-00000000000a' and rl.list_key = 'time_entry_type' and rli.value = 'labor'),
       '2026-09-01 09:00:00+00', '2026-09-01 10:30:00+00'
     ) $$,
  'engineer_a can log a 1.5-hour Labor entry on WO Unresolved'
); -- 29

select is(
  (select count(*)::int from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-000000000010'),
  0,
  'unresolved (layer 4): no client/engineer override and no org default configured yet — no line item, left off the auto-draft'
); -- 30

select pg_temp.act_as('f2111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ update public.organizations
     set default_travel_article_id = 'f6000000-0000-0000-0000-00000000000e',
         default_work_article_id = 'f6000000-0000-0000-0000-00000000000f'
     where id = 'f1000000-0000-0000-0000-00000000000a' $$,
  'owner_a can configure the org''s default travel/work articles'
); -- 31

select throws_ok(
  $$ update public.organizations
     set default_travel_article_id = 'f6000000-0000-0000-0000-000000000009'
     where id = 'f1000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'org_a cannot set default_travel_article_id to org_b''s article (validate_organization_default_rate_articles cross-org rejection)'
); -- 32

select pg_temp.act_as('f2222222-2222-2222-2222-222222222222');

update public.organizations
set default_work_article_id = 'f6000000-0000-0000-0000-00000000000e'
where id = 'f1000000-0000-0000-0000-00000000000a';

select is(
  (select default_work_article_id from public.organizations where id = 'f1000000-0000-0000-0000-00000000000a'),
  'f6000000-0000-0000-0000-00000000000f'::uuid,
  'planner_a''s attempt to change the org default is silently excluded by RLS (organizations_update_owner is owner-only) — value unchanged'
); -- 33

select pg_temp.act_as('f2333333-3333-3333-3333-333333333333');

update public.time_entries set notes = 'retry after org default configured'
where id = 'f8000000-0000-0000-0000-000000000010';

select is(
  (select article_id from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-000000000010'),
  'f6000000-0000-0000-0000-00000000000f'::uuid,
  'after a re-sync (any UPDATE), the entry now resolves via the org default (layer 3)'
); -- 34

select is(
  (select unit_price from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-000000000010'),
  75.00::numeric,
  'layer 3''s price is the org-default article''s OWN live sale_price (75.00) — no separate override price column at this layer'
); -- 35

select is(
  (select quantity from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-000000000010'),
  1.50::numeric,
  'quantity is unaffected by the notes-only update (still 1.50 hours)'
); -- 36

-- ---------------------------------------------------------------------------
-- 6. DELETE sync: planner_a deletes a time entry, its line item disappears.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ delete from public.time_entries where id = 'f8000000-0000-0000-0000-00000000000b' $$,
  'planner_a can delete engineer_a''s Travel time entry on WO Custom Client'
); -- 37

select is(
  (select count(*)::int from public.quote_line_items where source_time_entry_id = 'f8000000-0000-0000-0000-00000000000b'),
  0,
  'the corresponding line item was removed by the DELETE sync trigger'
); -- 38

-- ---------------------------------------------------------------------------
-- 7. work_order_articles sync: simpler, no client/engineer override layer.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2333333-3333-3333-3333-333333333333');

select lives_ok(
  $$ insert into public.work_order_articles (id, work_order_id, article_id, quantity)
     values ('f9000000-0000-0000-0000-00000000000a', 'f4000000-0000-0000-0000-00000000000a',
       'f6000000-0000-0000-0000-000000000010', 3) $$,
  'engineer_a can log a consumed article on WO Custom Client (own row)'
); -- 39

select is(
  (select unit_price from public.quote_line_items where source_work_order_article_id = 'f9000000-0000-0000-0000-00000000000a'),
  12.50::numeric,
  'the consumed-article line item''s unit_price is the article''s own live sale_price'
); -- 40

select is(
  (select purchase_price from public.quote_line_items where source_work_order_article_id = 'f9000000-0000-0000-0000-00000000000a'),
  6.00::numeric,
  'purchase_price was snapshotted from the article''s own live purchase_price'
); -- 41

update public.work_order_articles set quantity = 5 where id = 'f9000000-0000-0000-0000-00000000000a';

select is(
  (select quantity from public.quote_line_items where source_work_order_article_id = 'f9000000-0000-0000-0000-00000000000a'),
  5::numeric,
  'updating the consumed article''s quantity re-syncs the same line item (upsert, not a duplicate row)'
); -- 42

select pg_temp.act_as('f2222222-2222-2222-2222-222222222222');

select lives_ok(
  $$ delete from public.work_order_articles where id = 'f9000000-0000-0000-0000-00000000000a' $$,
  'planner_a can delete the consumed article'
); -- 43

select is(
  (select count(*)::int from public.quote_line_items where source_work_order_article_id = 'f9000000-0000-0000-0000-00000000000a'),
  0,
  'the corresponding line item was removed by the DELETE sync trigger'
); -- 44

-- ---------------------------------------------------------------------------
-- 8. resolve_billing_rate direct-call guard + tenant isolation.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('f2777777-7777-7777-7777-777777777777');

select throws_ok(
  $$ select * from public.resolve_billing_rate(
       'f1000000-0000-0000-0000-00000000000a', 'f3000000-0000-0000-0000-00000000000a',
       'f2333333-3333-3333-3333-333333333333', true) $$,
  '42501',
  null,
  'owner_b (not a member of org_a) cannot call resolve_billing_rate against org_a — is_member_of_org guard'
); -- 45

select is(
  (select count(*)::int from public.quotes where organization_id = 'f1000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot see any of org_a''s quotes (including its auto-drafts) — tenant isolation unaffected by this feature'
); -- 46

select * from finish();
rollback;
