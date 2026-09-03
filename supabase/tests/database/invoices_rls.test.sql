-- pgTAP RLS tests for invoices + invoice_number_sequences + the "invoices"
-- Storage bucket (issue #119, 20260903100000_invoices_core.sql).
--
-- Run with the Supabase CLI's local test runner (requires Docker):
--   supabase test db
--
-- Follows the conventions established in
-- supabase/tests/database/quotes_rls.test.sql and
-- supabase/tests/database/clients_logo_and_organization_own_client_rls.test.sql:
-- switch to the `authenticated` role and set `request.jwt.claims` to simulate
-- auth.uid() for a given fixture user. All auth.users rows here are test
-- fixtures, rolled back at the end of the transaction.
--
-- Note on RLS semantics: a `USING` clause violation on UPDATE/DELETE does NOT
-- raise an error -- the row is silently excluded (0 rows changed). Only
-- INSERT `WITH CHECK` violations (and column-level privilege revokes) raise
-- 42501.
--
-- This is a DELIBERATELY NARROWER/different RBAC shape than every other
-- module tested so far: only owner/administratie may SELECT/INSERT/DELETE
-- invoices at all -- planner/engineer/finance get ZERO access (not even
-- read), unlike quotes' owner+planner-write/everyone-read shape. Coverage:
-- owner and administratie can each generate (insert) and delete an invoice;
-- planner/engineer/finance can neither read nor create nor delete an org's
-- invoices; cross-org isolation on invoices AND on the invoices Storage
-- bucket; next_invoice_number() produces distinct, gapless-per-caller,
-- sequential numbers under concurrent-style repeated calls for the same
-- organization and never collides across organizations; next_invoice_number()
-- itself rejects a non-owner/administratie caller (42501); at-most-one-
-- invoice-per-quote is enforced (unique quote_id); deleting a quote cascades
-- to its invoice; there is no UPDATE grant on invoices at all, even for an
-- owner on their own org's row; and Storage cross-org isolation on the
-- invoices bucket is tested against a DIFFERENT org's owner, not just a
-- same-org non-owner/administratie role.

begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

-- ---------------------------------------------------------------------------
-- Fixtures: org_a with one of each relevant role, org_b for tenant isolation.
-- One client + one quote per org (quotes needed as invoices.quote_id's
-- parent).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a9111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('a9222222-2222-2222-2222-222222222222', 'planner-a@test.local'),
  ('a9333333-3333-3333-3333-333333333333', 'engineer-a@test.local'),
  ('a9444444-4444-4444-4444-444444444444', 'finance-a@test.local'),
  ('a9555555-5555-5555-5555-555555555555', 'administratie-a@test.local'),
  ('a9666666-6666-6666-6666-666666666666', 'owner-b@test.local');

create or replace function pg_temp.act_as(p_user_id uuid) returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select pg_temp.act_as('a9111111-1111-1111-1111-111111111111');

insert into public.organizations (id, name, created_by)
values ('a8000000-0000-0000-0000-00000000000a', 'Org A', 'a9111111-1111-1111-1111-111111111111');

insert into public.memberships (user_id, organization_id, role) values
  ('a9111111-1111-1111-1111-111111111111', 'a8000000-0000-0000-0000-00000000000a', 'owner'),
  ('a9222222-2222-2222-2222-222222222222', 'a8000000-0000-0000-0000-00000000000a', 'planner'),
  ('a9333333-3333-3333-3333-333333333333', 'a8000000-0000-0000-0000-00000000000a', 'engineer'),
  ('a9444444-4444-4444-4444-444444444444', 'a8000000-0000-0000-0000-00000000000a', 'finance'),
  ('a9555555-5555-5555-5555-555555555555', 'a8000000-0000-0000-0000-00000000000a', 'administratie');

insert into public.clients (id, organization_id, name)
values ('a7000000-0000-0000-0000-00000000000a', 'a8000000-0000-0000-0000-00000000000a', 'Client A');

insert into public.quotes (id, client_id, name) values
  ('a6000000-0000-0000-0000-00000000000a', 'a7000000-0000-0000-0000-00000000000a', 'Quote A1'),
  ('a6000000-0000-0000-0000-00000000000b', 'a7000000-0000-0000-0000-00000000000a', 'Quote A2'),
  ('a6000000-0000-0000-0000-00000000000c', 'a7000000-0000-0000-0000-00000000000a', 'Quote A3 (for cascade test)');

select pg_temp.act_as('a9666666-6666-6666-6666-666666666666');

insert into public.organizations (id, name, created_by)
values ('a8000000-0000-0000-0000-00000000000b', 'Org B', 'a9666666-6666-6666-6666-666666666666');

insert into public.memberships (user_id, organization_id, role)
values ('a9666666-6666-6666-6666-666666666666', 'a8000000-0000-0000-0000-00000000000b', 'owner');

insert into public.clients (id, organization_id, name)
values ('a7000000-0000-0000-0000-00000000000b', 'a8000000-0000-0000-0000-00000000000b', 'Client B');

insert into public.quotes (id, client_id, name)
values ('a6000000-0000-0000-0000-00000000000d', 'a7000000-0000-0000-0000-00000000000b', 'Quote B1');

-- ---------------------------------------------------------------------------
-- 1. owner: can generate a number, insert an invoice, derived
--    organization_id/generated_by, and cannot spoof either.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a9111111-1111-1111-1111-111111111111');

select matches(
  public.next_invoice_number('a8000000-0000-0000-0000-00000000000a'),
  '^INV-[0-9]{4}-0001$',
  'owner_a''s first next_invoice_number() call for org_a returns INV-<year>-0001'
); -- 1

select matches(
  public.next_invoice_number('a8000000-0000-0000-0000-00000000000a'),
  '^INV-[0-9]{4}-0002$',
  'owner_a''s second next_invoice_number() call for org_a returns INV-<year>-0002 (sequential, no reuse)'
); -- 2

select lives_ok(
  $$ insert into public.invoices (id, quote_id, invoice_number, pdf_path)
     values ('a5000000-0000-0000-0000-00000000000a', 'a6000000-0000-0000-0000-00000000000a',
       'INV-2026-0001', 'a8000000-0000-0000-0000-00000000000a/a6000000-0000-0000-0000-00000000000a/invoice.pdf') $$,
  'owner_a can insert an invoice for Quote A1'
); -- 3

select is(
  (select organization_id from public.invoices where id = 'a5000000-0000-0000-0000-00000000000a'),
  'a8000000-0000-0000-0000-00000000000a'::uuid,
  'invoices.organization_id was auto-derived from quotes.organization_id via quote_id'
); -- 4

select is(
  (select generated_by from public.invoices where id = 'a5000000-0000-0000-0000-00000000000a'),
  'a9111111-1111-1111-1111-111111111111'::uuid,
  'invoices.generated_by was auto-stamped to the inserting user (trigger), not client-supplied'
); -- 5

select throws_ok(
  $$ insert into public.invoices (quote_id, invoice_number, pdf_path, organization_id)
     values ('a6000000-0000-0000-0000-00000000000b', 'INV-2026-0002', 'x/y/invoice.pdf', 'a8000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_a cannot set invoices.organization_id directly on insert (column-level grant withheld)'
); -- 6

select throws_ok(
  $$ insert into public.invoices (quote_id, invoice_number, pdf_path, generated_by)
     values ('a6000000-0000-0000-0000-00000000000b', 'INV-2026-0002', 'x/y/invoice.pdf', '00000000-0000-0000-0000-000000000000') $$,
  '42501',
  null,
  'owner_a cannot set invoices.generated_by directly on insert (column-level grant withheld)'
); -- 7

select throws_ok(
  $$ insert into public.invoices (quote_id, invoice_number, pdf_path)
     values ('a6000000-0000-0000-0000-00000000000a', 'INV-2026-0002', 'x/y/invoice.pdf') $$,
  '23505',
  null,
  'a second invoice for the SAME quote (Quote A1) is rejected -- unique (quote_id), at most one live invoice per quote'
); -- 8

select throws_ok(
  $$ insert into public.invoices (quote_id, invoice_number, pdf_path)
     values ('a6000000-0000-0000-0000-00000000000b', 'INV-2026-0001', 'x/y2/invoice.pdf') $$,
  '23505',
  null,
  'a second invoice reusing the SAME invoice_number in the same org (Quote A2 with INV-2026-0001) is rejected -- unique (organization_id, invoice_number)'
); -- 9

-- ---------------------------------------------------------------------------
-- 2. administratie: same allow-list as owner (SELECT/INSERT/DELETE).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a9555555-5555-5555-5555-555555555555');

select is(
  (select count(*)::int from public.invoices where organization_id = 'a8000000-0000-0000-0000-00000000000a'),
  1,
  'administratie_a can SELECT org_a''s invoices'
); -- 10

select matches(
  public.next_invoice_number('a8000000-0000-0000-0000-00000000000a'),
  '^INV-[0-9]{4}-0003$',
  'administratie_a can call next_invoice_number() for org_a and gets the next number (0003)'
); -- 11

select lives_ok(
  $$ insert into public.invoices (id, quote_id, invoice_number, pdf_path)
     values ('a5000000-0000-0000-0000-00000000000b', 'a6000000-0000-0000-0000-00000000000b',
       'INV-2026-0003', 'a8000000-0000-0000-0000-00000000000a/a6000000-0000-0000-0000-00000000000b/invoice.pdf') $$,
  'administratie_a can insert an invoice for Quote A2'
); -- 12

select lives_ok(
  $$ delete from public.invoices where id = 'a5000000-0000-0000-0000-00000000000b' $$,
  'administratie_a can delete an invoice in org_a'
); -- 13

select is(
  (select count(*)::int from public.invoices where id = 'a5000000-0000-0000-0000-00000000000b'),
  0,
  'the deleted invoice is actually gone after administratie_a''s delete'
); -- 14

-- ---------------------------------------------------------------------------
-- 3. planner: ZERO access -- cannot even SELECT (unlike quotes' own RLS,
--    where planner has full CRUD). This is the module's key deliberate
--    RBAC-shape difference from every other table tested so far.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a9222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.invoices where organization_id = 'a8000000-0000-0000-0000-00000000000a'),
  0,
  'planner_a cannot SELECT org_a''s invoices at all (RLS: owner/administratie only, planner gets zero rows back, not an error)'
); -- 15

select throws_ok(
  $$ insert into public.invoices (quote_id, invoice_number, pdf_path)
     values ('a6000000-0000-0000-0000-00000000000c', 'INV-2026-0099', 'x/y3/invoice.pdf') $$,
  '42501',
  null,
  'planner_a cannot INSERT an invoice (RBAC: owner/administratie only, not quotes'' own owner+planner shape)'
); -- 16

select throws_ok(
  $$ select public.next_invoice_number('a8000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'planner_a cannot call next_invoice_number() for org_a directly (function-internal role re-check, defense in depth)'
); -- 17

delete from public.invoices where id = 'a5000000-0000-0000-0000-00000000000a';

select is(
  (select count(*)::int from public.invoices where id = 'a5000000-0000-0000-0000-00000000000a'),
  1,
  'planner_a''s DELETE is silently excluded by RLS; Quote A1''s invoice still exists'
); -- 18

-- ---------------------------------------------------------------------------
-- 4. engineer: ZERO access (mirrors planner's exclusion).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a9333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.invoices where organization_id = 'a8000000-0000-0000-0000-00000000000a'),
  0,
  'engineer_a cannot SELECT org_a''s invoices at all'
); -- 19

select throws_ok(
  $$ insert into public.invoices (quote_id, invoice_number, pdf_path)
     values ('a6000000-0000-0000-0000-00000000000c', 'INV-2026-0098', 'x/y4/invoice.pdf') $$,
  '42501',
  null,
  'engineer_a cannot INSERT an invoice'
); -- 20

select throws_ok(
  $$ select public.next_invoice_number('a8000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'engineer_a cannot call next_invoice_number() for org_a directly'
); -- 21

-- ---------------------------------------------------------------------------
-- 5. finance: ZERO access -- deliberately, even though finance has CRUD on
--    the "Billing/Facturatie" RBAC matrix row in general; issue #119 scopes
--    invoice generation/deletion to owner/administratie only, not finance.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a9444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int from public.invoices where organization_id = 'a8000000-0000-0000-0000-00000000000a'),
  0,
  'finance_a cannot SELECT org_a''s invoices at all (issue #119 scopes this to owner/administratie only, not finance)'
); -- 22

select throws_ok(
  $$ insert into public.invoices (quote_id, invoice_number, pdf_path)
     values ('a6000000-0000-0000-0000-00000000000c', 'INV-2026-0097', 'x/y5/invoice.pdf') $$,
  '42501',
  null,
  'finance_a cannot INSERT an invoice'
); -- 23

select throws_ok(
  $$ select public.next_invoice_number('a8000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'finance_a cannot call next_invoice_number() for org_a directly'
); -- 24

-- ---------------------------------------------------------------------------
-- 6. Tenant isolation: owner_b (org_b) cannot see or write org_a's invoices,
--    and next_invoice_number() sequences never collide across organizations.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a9666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from public.invoices where organization_id = 'a8000000-0000-0000-0000-00000000000a'),
  0,
  'owner_b cannot SELECT org_a''s invoices'
); -- 25

select throws_ok(
  $$ insert into public.invoices (quote_id, invoice_number, pdf_path)
     values ('a6000000-0000-0000-0000-00000000000a', 'INV-2026-9999', 'hostile/x/invoice.pdf') $$,
  '42501',
  null,
  'owner_b cannot INSERT an invoice under org_a''s quote (not a member of org_a at all, so current_member_role is null)'
); -- 26

select throws_ok(
  $$ select public.next_invoice_number('a8000000-0000-0000-0000-00000000000a') $$,
  '42501',
  null,
  'owner_b cannot call next_invoice_number() for org_a (not a member of org_a)'
); -- 27

select matches(
  public.next_invoice_number('a8000000-0000-0000-0000-00000000000b'),
  '^INV-[0-9]{4}-0001$',
  'owner_b''s own org_b sequence starts independently at 0001, unaffected by org_a''s counter already being at 3'
); -- 28

select lives_ok(
  $$ insert into public.invoices (id, quote_id, invoice_number, pdf_path)
     values ('a5000000-0000-0000-0000-00000000000c', 'a6000000-0000-0000-0000-00000000000d',
       'INV-2026-0001', 'a8000000-0000-0000-0000-00000000000b/a6000000-0000-0000-0000-00000000000d/invoice.pdf') $$,
  'owner_b can insert an invoice for Quote B1 reusing the SAME invoice_number text (INV-2026-0001) as org_a -- unique constraint is per-organization, not global'
); -- 29

-- ---------------------------------------------------------------------------
-- 7. on delete cascade: deleting a quote removes its invoice.
-- ---------------------------------------------------------------------------
select pg_temp.act_as('a9111111-1111-1111-1111-111111111111');

insert into public.invoices (id, quote_id, invoice_number, pdf_path)
values ('a5000000-0000-0000-0000-00000000000d', 'a6000000-0000-0000-0000-00000000000c',
  'INV-2026-0004', 'a8000000-0000-0000-0000-00000000000a/a6000000-0000-0000-0000-00000000000c/invoice.pdf');

delete from public.quotes where id = 'a6000000-0000-0000-0000-00000000000c';

select is(
  (select count(*)::int from public.invoices where id = 'a5000000-0000-0000-0000-00000000000d'),
  0,
  'deleting Quote A3 cascades to delete its invoice (on delete cascade)'
); -- 30

-- ---------------------------------------------------------------------------
-- 8. No UPDATE grant on invoices at all (design note 2): even the invoice's
--    OWNING org's owner cannot UPDATE a single column, and the failure mode
--    is 42501 (missing privilege, from the absent GRANT) -- NOT a silent
--    RLS-USING exclusion, since there is no UPDATE policy/grant to even
--    evaluate a USING clause against. Still acting as owner_a from section 7;
--    a5000000-0000-0000-0000-00000000000a (org_a, Quote A1) still exists.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.invoices set invoice_number = 'INV-2026-9999' where id = 'a5000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'owner_a cannot UPDATE invoice_number (or any column) on their own org''s invoice -- there is no UPDATE grant on invoices at all, so this is a missing-privilege error, not an RLS USING/WITH CHECK failure'
); -- 31

-- ---------------------------------------------------------------------------
-- 9. Storage: "invoices" bucket. PRIVATE -- no public SELECT policy;
--    SELECT/INSERT/UPDATE/DELETE all restricted to owner/administratie,
--    keyed on the path's organization_id segment. Covers both a same-org
--    non-owner/administratie role (planner_a) AND a DIFFERENT org's owner
--    (owner_b), per the header's cross-org-isolation claim.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('invoices', 'a8000000-0000-0000-0000-00000000000a/a6000000-0000-0000-0000-00000000000a/invoice.pdf') $$,
  'owner_a can INSERT an invoices object under org_a''s own folder'
); -- 32

select pg_temp.act_as('a9222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'invoices'),
  0,
  'planner_a (same org, but not owner/administratie) cannot SELECT the invoices object -- private bucket, no public-read policy'
); -- 33

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('invoices', 'a8000000-0000-0000-0000-00000000000a/a6000000-0000-0000-0000-00000000000a/second.pdf') $$,
  '42501',
  null,
  'planner_a cannot INSERT into the invoices bucket under org_a''s folder either'
); -- 34

select pg_temp.act_as('a9666666-6666-6666-6666-666666666666');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'invoices' and name like 'a8000000-0000-0000-0000-00000000000a/%'),
  0,
  'owner_b (a DIFFERENT organization''s owner, not merely a same-org non-owner/administratie role) cannot SELECT org_a''s invoices object either -- cross-org isolation on the Storage bucket itself, not just on the invoices table'
); -- 35

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('invoices', 'a8000000-0000-0000-0000-00000000000a/a6000000-0000-0000-0000-00000000000a/hostile.pdf') $$,
  '42501',
  null,
  'owner_b cannot INSERT into org_a''s folder in the invoices bucket either -- being owner of org_b grants no access to org_a''s path segment'
); -- 36

select * from finish();
rollback;
