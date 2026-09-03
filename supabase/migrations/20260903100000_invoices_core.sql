-- Invoicing (issue #119, "Als owner / administratie / platform admin wil ik
-- een factuur kunnen maken"). Schema only — PDF rendering itself is
-- `api-backend-engineer`'s follow-up (a Server Action that reads a quote's
-- own line items/client/totals plus the tenant's own company data via
-- `organizations.own_client_id` -> that Client's name/kvk_number/vat_number/
-- iban/logo_path, issue #120), and the "open in centered popup"/"delete"
-- buttons are `frontend-ui-engineer`'s. This migration builds: (A) the
-- `invoices` table itself, one row per quote; (B) a race-safe per-organization
-- sequential invoice-number generator; (C) a PRIVATE Storage bucket for the
-- generated PDFs.
--
-- Confirmed scope decision (already resolved with the user — do not
-- relitigate): Platform Admin needs NO new cross-tenant access here. Per
-- docs/ARCHITECTURE.md's existing Platform Admin model, a Platform Admin
-- already qualifies for invoice actions purely by being an `owner` tenant-role
-- member of their own "Platform" org — there is no service-role/cross-tenant
-- bypass to build. RLS below is therefore ordinary same-org
-- `current_member_role(organization_id) in ('owner', 'administratie')`,
-- nothing platform-admin-specific.
--
-- Design notes (read before extending):
--
-- 1. `invoices.organization_id` denormalization: same pattern as
--    `quotes`/`contracts`/`quote_line_items` — denormalized from
--    `quotes.organization_id` via `quote_id` (`derive_invoice_organization_id`),
--    so RLS stays a single-column `current_member_role(organization_id)`
--    shape with no in-policy joins. Never client-suppliable (excluded from
--    the INSERT grant below).
--
-- 2. "At most one live invoice per quote": enforced at the DB level by
--    `quote_id uuid not null unique references quotes(id) on delete cascade`
--    — not by a partial/soft-delete flag. Regenerating an invoice is
--    DELETE-the-old-row-then-INSERT-a-new-one (application-layer), not an
--    UPDATE of the same row: there is no "edit an invoice" concept (an
--    invoice is a generated artifact of a quote's state at generation time,
--    not a hand-edited document), so `invoices` gets NO update policy and NO
--    UPDATE grant at all — only SELECT/INSERT/DELETE. This keeps "at most
--    one per quote" a structural guarantee of the `unique` constraint rather
--    than something an upsert code path has to get right. `on delete cascade`
--    (not `set null`/`restrict`) because an invoice row has no meaning once
--    its quote is gone.
--
-- 3. RLS role boundary is DELIBERATELY narrower than, and role-different
--    from, `quotes`' own RLS (owner+planner CRUD, everyone else read) —
--    matching issue #119's explicit "owner / administratie" framing, not
--    reusing the quotes module's shape. No planner/engineer/finance access at
--    all, not even read: this is financial output, not the sales document
--    itself. Confirmed `current_member_role` (the same helper `work_orders`
--    uses for its owner/planner/engineer 3-way split) is the right tool for
--    this 2-role allowlist too — no new helper needed, just a different `in
--    (...)` list.
--
-- 4. Invoice numbering: `invoice_number_sequences` is the EXACT structural
--    precedent of `asset_id_sequences`
--    (`20260831090000_assets_auto_generate_asset_id.sql`) — one counter row
--    per organization, advanced atomically via a single `INSERT ... ON
--    CONFLICT (organization_id) DO UPDATE ... RETURNING` statement (Postgres
--    takes a row lock on the target counter row for the duration of the
--    UPSERT, serializing concurrent callers in the same organization;
--    different organizations never contend, each having its own row) —
--    race-safe under concurrent invoice generation. RLS is enabled with zero
--    policies and there are no grants to `authenticated`: this table is never
--    read or written directly, only through `next_invoice_number()`.
--
--    Format: `INV-<year>-NNNN` (e.g. `INV-2026-0184`, matching the exact
--    digit count in the reference layout at `docs/invoice/Invoiceexample.pdf`)
--    — the year is embedded at ISSUANCE time (`to_char(now(), 'YYYY')`), not
--    reset per year: the counter itself is a single running total per
--    organization, not a `(organization_id, year)` composite key. Two
--    considered alternatives, both rejected: (a) resetting the counter every
--    January 1st would require a composite counter key and a "which year is
--    this counter for" migration step every year-end, for a cosmetic
--    property (numbers seeming to "restart") the issue's acceptance criteria
--    don't ask for — the only hard requirement is "sequential and
--    collision-free per organization", which a single running counter
--    already satisfies; (b) a global (cross-tenant) counter was rejected for
--    the same reason `asset_id_sequences` rejected it — a leaked cross-tenant
--    sequential id (a competitor could infer another tenant's invoice volume
--    from a shared counter) is exactly the kind of cross-tenant information
--    leak this schema avoids everywhere else via strict `organization_id`
--    scoping.
--
--    Unlike `next_asset_display_id` (which has NO grant to `authenticated` at
--    all, reachable only from an internal `BEFORE INSERT` trigger),
--    `next_invoice_number(organization_id)` IS `grant execute ... to
--    authenticated` — the issue requires a Server Action (running under the
--    caller's own session, not a trigger) to call it directly to mint the
--    number before constructing the PDF/inserting the `invoices` row. Since
--    that makes it directly callable by ANY authenticated member of an
--    organization (not just owner/administratie) unless guarded, the
--    function itself re-checks `current_member_role(p_organization_id) in
--    ('owner', 'administratie')` and raises `42501` otherwise — defense in
--    depth matching `invoices`' own RLS boundary, so a planner/engineer/
--    finance member cannot burn/gap the sequence by calling this function
--    directly even though they could never successfully INSERT the resulting
--    `invoices` row anyway.
--
-- 5. Storage bucket `invoices` is PRIVATE (`public = false`) — unlike
--    `client-logos`/`avatars`, a financial PDF is never embedded via a plain
--    `<img>`/public URL. Path convention `{organization_id}/{quote_id}/
--    invoice.pdf` (fixed filename per quote, consistent with "at most one
--    invoice per quote" and "regenerate = delete + re-insert" above — a
--    regenerate overwrites/replaces the same path rather than accumulating
--    orphans). RLS on `storage.objects` has NO public SELECT policy at all —
--    SELECT/INSERT/UPDATE/DELETE are ALL restricted to
--    `current_member_role((storage.foldername(name))[1]::uuid) in ('owner',
--    'administratie')`, keyed on the path's organization_id segment, same
--    role restriction as the `invoices` table itself. The app mints
--    short-lived signed URLs server-side for the "open in a centered popup"
--    UI; minting that signed URL still requires the calling identity to pass
--    this SELECT policy, which is intentional — only owner/administratie can
--    even create a link, not just "can't guess the path".
--    `current_member_role` is safe to call from a `storage.objects` policy
--    for the same reason `is_org_owner` already is
--    (`20260903090000_clients_logo_and_organization_own_client.sql`'s header,
--    point B): both are `security definer` + already `grant execute ... to
--    authenticated` (`20260823120000_work_orders_core.sql`), so the policy
--    (evaluated as `authenticated`) can invoke it regardless of the caller's
--    own row-visibility into `memberships`.
--
-- ---------------------------------------------------------------------------
-- Due diligence performed before writing this migration:
--   - Grepped supabase/migrations/ and supabase/tests/ for `invoice` — every
--     hit is either the unrelated `work_order_status` lifecycle value
--     `'invoiced'`, the ARCHITECTURE.md "Not yet implemented" stub line (being
--     replaced by this migration), or forward-looking comments in
--     `20260901090000_work_order_auto_draft_quotes.sql`/
--     `20260903090000_clients_logo_and_organization_own_client.sql` noting
--     that a future Invoicing module would read `organizations.own_client_id`
--     — none is an existing `invoices` table/column/function/bucket. This is
--     the first real Invoicing schema.
--   - Confirmed `current_member_role(uuid) returns membership_role`
--     (`20260823120000_work_orders_core.sql`) is `security definer`/`stable`
--     and already `grant execute ... to authenticated` — reused as-is below,
--     no changes to that function.
--   - Confirmed `organizations.own_client_id` (validated same-org by
--     `validate_organization_own_client`) and `clients.logo_path`/
--     `kvk_number`/`vat_number`/`iban` already exist
--     (`20260903090000_clients_logo_and_organization_own_client.sql`,
--     `20260825150000_clients_business_fields.sql`) — the PDF-rendering
--     Server Action (api-backend-engineer, out of scope here) reads all of
--     these via `organizations.own_client_id -> clients`, nothing further
--     needed schema-side for the "tenant data configured via Settings"
--     acceptance criterion.
--   - Did NOT touch `lib/rbac/permissions.ts` — being edited concurrently by
--     `auth-rbac-engineer` for this same issue.
--
-- Out of scope here (api-backend-engineer / frontend-ui-engineer follow-ups):
--   - The actual PDF generation Server Action (calls `next_invoice_number`,
--     renders the PDF from the quote + `organizations.own_client_id` data,
--     uploads to the `invoices` bucket at
--     `{organization_id}/{quote_id}/invoice.pdf`, then inserts the `invoices`
--     row with that `pdf_path` and the minted `invoice_number`).
--   - Minting short-lived signed URLs for the "view in centered popup" UI.
--   - The delete button's Server Action (deletes the Storage object, then the
--     `invoices` row — or vice versa; either order is safe since neither is
--     the other's foreign key parent).
--
-- Column-grant lockdown: `invoices` and `invoice_number_sequences` are new
-- tables, so the usual "this project's public schema grants ALL to
-- authenticated/anon by default on new tables" gotcha applies — `revoke all`
-- before the explicit grants.

-- ===========================================================================
-- A. Per-organization counter table + generator function backing
--    invoices.invoice_number. See design note 4 above.
-- ===========================================================================
create table public.invoice_number_sequences (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  last_number bigint not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.invoice_number_sequences is
  'Per-organization counter backing auto-generated invoices.invoice_number values (format INV-<year>-NNNN, e.g. INV-2026-0184). One row per organization; last_number is the last-issued sequence number (a single running total, NOT reset per calendar year — see design note 4 in 20260903100000_invoices_core.sql), advanced atomically by next_invoice_number() via a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING statement, which Postgres serializes per-row (row lock on the target organization''s counter row) so concurrent invoice generation within the same organization can never receive the same number. RLS is enabled with zero policies and there are no grants to `authenticated` -- this table is never read or written directly by any client-facing role, only by next_invoice_number() (SECURITY DEFINER). Exact structural precedent: asset_id_sequences (20260831090000_assets_auto_generate_asset_id.sql).';

comment on column public.invoice_number_sequences.last_number is
  'The last sequence number issued for this organization''s invoices (INV-<year>-<lpad(last_number, 4, ''0'')>). Starts at 0 (no invoices generated yet); next_invoice_number() increments before returning, so the first issued number is <...>-0001.';

alter table public.invoice_number_sequences enable row level security;
alter table public.invoice_number_sequences force row level security;

-- No RLS policies and no grants to `authenticated`, deliberately: reachable
-- only via next_invoice_number() (SECURITY DEFINER, owned by the migration
-- role which bypasses RLS). Enabling + forcing RLS with zero policies is pure
-- defense in depth, same stance as asset_id_sequences.

create or replace function public.next_invoice_number(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
  v_role public.membership_role;
begin
  -- `is distinct from` (not a plain `not in (...)`) deliberately: for a
  -- caller with NO membership in p_organization_id at all,
  -- current_member_role returns NULL, and `NULL not in ('owner',
  -- 'administratie')` itself evaluates to NULL -- which `if NULL then`
  -- treats as false in plpgsql, silently SKIPPING this guard entirely and
  -- letting a complete stranger to the organization burn/observe its invoice
  -- sequence. `is distinct from` never evaluates to NULL, so a NULL role
  -- (non-member) correctly falls through to the exception below.
  v_role := public.current_member_role(p_organization_id);

  if v_role is distinct from 'owner' and v_role is distinct from 'administratie' then
    raise exception 'Only owner or administratie members may generate an invoice number for this organization'
      using errcode = '42501';
  end if;

  insert into public.invoice_number_sequences (organization_id, last_number)
  values (p_organization_id, 1)
  on conflict (organization_id)
  do update set last_number = public.invoice_number_sequences.last_number + 1,
                updated_at = now()
  returning last_number into v_next;

  return 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_next::text, 4, '0');
end;
$$;

comment on function public.next_invoice_number(uuid) is
  'Returns the next sequential INV-<year>-NNNN invoice number (4-digit zero-padded, e.g. INV-2026-0184; year embedded at issuance time, the counter itself is a single running total per organization, never reset per year -- see design note 4 in 20260903100000_invoices_core.sql) for the given organization, atomically advancing that organization''s counter row in invoice_number_sequences via a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING statement. Race-safe under concurrent calls: Postgres takes a row lock on the target invoice_number_sequences row for the duration of the UPSERT, so two simultaneous callers for the same organization are serialized and never observe or return the same number; callers from different organizations never contend, since each has its own counter row. SECURITY DEFINER because callers have no direct grant on invoice_number_sequences -- but unlike next_asset_display_id (internal-trigger-only, no grant to authenticated), this function IS granted to authenticated (a Server Action calls it directly, not a trigger), so it re-checks current_member_role(p_organization_id) in (''owner'', ''administratie'') itself and raises 42501 otherwise, matching invoices'' own RLS boundary.';

revoke all on function public.next_invoice_number(uuid) from public;
grant execute on function public.next_invoice_number(uuid) to authenticated;

-- ===========================================================================
-- B. invoices: one row per quote (unique quote_id). organization_id is
--    denormalized from the QUOTE (see design note 1). No update policy/grant
--    at all -- regenerate is delete + re-insert (see design note 2).
-- ===========================================================================
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  quote_id uuid not null unique references public.quotes (id) on delete cascade,
  invoice_number text not null,
  pdf_path text not null,
  generated_by uuid not null references public.users (id) on delete cascade,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, invoice_number)
);

comment on table public.invoices is
  'A generated invoice PDF for a quote (issue #119). At most one invoice per quote, enforced by the `unique (quote_id)` constraint -- regenerating replaces it (application-layer DELETE + fresh INSERT, not an UPDATE; there is no "edit an invoice" concept). organization_id is denormalized from quotes.organization_id (via quote_id) by derive_invoice_organization_id. RLS is deliberately narrower than quotes'' own (owner/planner CRUD, everyone read) -- only owner/administratie may SELECT/INSERT/DELETE, matching issue #119''s explicit "owner / administratie" framing; Platform Admin is covered for free by being an owner of their own Platform org (docs/ARCHITECTURE.md), no platform-admin-specific RLS clause needed.';
comment on column public.invoices.organization_id is
  'Denormalized from quotes.organization_id (via quote_id). Never client-writable -- see derive_invoice_organization_id trigger and the column-level grants below.';
comment on column public.invoices.quote_id is
  'The quote this invoice was generated from. unique -- a quote has at most one live invoice at a time. on delete cascade: an invoice has no meaning once its quote is gone.';
comment on column public.invoices.invoice_number is
  'Human-facing sequential invoice number, format INV-<year>-NNNN (e.g. INV-2026-0184), minted by next_invoice_number(organization_id) and supplied by the Server Action on INSERT (server-computed, but written directly by the app -- not a DB trigger/default, since the app needs the number before it can render the PDF it is embedded in). unique per organization (see the table-level `unique (organization_id, invoice_number)` constraint).';
comment on column public.invoices.pdf_path is
  'Supabase Storage OBJECT PATH (not a full URL, and not a public one -- the "invoices" bucket is private) in the "invoices" bucket, fixed as "{organization_id}/{quote_id}/invoice.pdf". Server-computed and written directly by the app on INSERT, same reasoning as invoice_number.';
comment on column public.invoices.generated_by is
  'Who generated this invoice. Stamped by the set_invoice_generated_by trigger from auth.uid() -- never client-suppliable (excluded from the INSERT grant below), same "trigger-stamped, not client-writable" treatment as created_by elsewhere in this schema, just under a domain-specific column name since "created_by" would undersell that generating an invoice is a distinct, audited action from merely creating a row.';

create index invoices_organization_id_idx on public.invoices (organization_id);
create index invoices_generated_by_idx on public.invoices (generated_by);
-- quote_id already has a unique index from the `unique (quote_id)` column
-- constraint above -- no separate plain index needed.

alter table public.invoices enable row level security;
alter table public.invoices force row level security;

-- Derives organization_id from quote_id (blocking cross-organization
-- re-parenting), mirroring derive_quote_line_item_organization_id. quote_id
-- is excluded from any UPDATE grant (there is no UPDATE grant on invoices at
-- all -- see design note 2), so the UPDATE branch here is a defense-in-depth
-- backstop, unreachable via any client-facing grant.
create or replace function public.derive_invoice_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select q.organization_id into v_org_id
  from public.quotes q
  where q.id = new.quote_id;

  if v_org_id is null then
    raise exception 'invoices.quote_id % does not reference an existing quote', new.quote_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move an invoice to a quote in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_invoice_organization_id() is
  'BEFORE INSERT/UPDATE OF quote_id trigger on public.invoices: sets organization_id from the referenced quote, and blocks cross-organization re-parenting. There is no UPDATE grant on invoices at all (see design note 2 in 20260903100000_invoices_core.sql), so the UPDATE branch here is an unreachable defense-in-depth backstop, same pattern as derive_quote_line_item_organization_id.';

create trigger invoices_derive_organization_id
  before insert or update of quote_id on public.invoices
  for each row execute function public.derive_invoice_organization_id();

-- Stamps generated_by = auth.uid(), same shape as set_created_by but under
-- this table's domain-specific column name (see column comment above).
create or replace function public.set_invoice_generated_by()
returns trigger
language plpgsql
as $$
begin
  new.generated_by := auth.uid();
  return new;
end;
$$;

comment on function public.set_invoice_generated_by() is
  'BEFORE INSERT trigger on public.invoices: stamps generated_by = auth.uid(). Deliberately excluded from every client-facing INSERT/UPDATE column grant so it cannot be spoofed -- same lockdown as set_created_by, under a domain-specific column name.';

create trigger invoices_set_generated_by
  before insert on public.invoices
  for each row execute function public.set_invoice_generated_by();

-- ---------------------------------------------------------------------------
-- RLS policies: invoices -- owner/administratie only, SELECT/INSERT/DELETE.
-- No UPDATE policy at all (see design note 2 and 3 above).
-- ---------------------------------------------------------------------------

create policy "invoices_select_owner_or_administratie"
on public.invoices
for select
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'administratie')
);

create policy "invoices_insert_owner_or_administratie"
on public.invoices
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'administratie')
);

create policy "invoices_delete_owner_or_administratie"
on public.invoices
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'administratie')
);

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table -- always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.invoices from authenticated;

grant select, delete on public.invoices to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_invoice_organization_id. generated_by intentionally excluded:
-- stamped by set_invoice_generated_by. generated_at/created_at intentionally
-- excluded: default now() covers both, no client override needed.
-- invoice_number/pdf_path ARE included -- both are server-computed by the
-- Server Action itself (next_invoice_number() + the Storage upload), not by
-- a DB trigger/default, so the app writes them directly on INSERT (same
-- "server-computed but client-grant-required" shape as e.g.
-- quote_line_items.unit_price). `id` IS included in the INSERT grant, same
-- reasoning as quotes/quote_line_items (this migration's own RLS test
-- assigns deterministic fixture ids on insert). No UPDATE grant at all --
-- there is no "edit an invoice" concept (see design note 2).
grant insert (
  id, quote_id, invoice_number, pdf_path
) on public.invoices to authenticated;

-- ===========================================================================
-- C. Storage: "invoices" bucket. PRIVATE (public = false), path convention
--    "{organization_id}/{quote_id}/invoice.pdf". See design note 5 above for
--    the full reasoning (no public SELECT policy at all; every operation
--    gated on current_member_role of the path's organization_id segment).
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

create policy "invoices_bucket_select_owner_or_administratie"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'invoices'
  and public.current_member_role((storage.foldername(name))[1]::uuid) in ('owner', 'administratie')
);

create policy "invoices_bucket_insert_owner_or_administratie"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'invoices'
  and public.current_member_role((storage.foldername(name))[1]::uuid) in ('owner', 'administratie')
);

create policy "invoices_bucket_update_owner_or_administratie"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'invoices'
  and public.current_member_role((storage.foldername(name))[1]::uuid) in ('owner', 'administratie')
)
with check (
  bucket_id = 'invoices'
  and public.current_member_role((storage.foldername(name))[1]::uuid) in ('owner', 'administratie')
);

create policy "invoices_bucket_delete_owner_or_administratie"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'invoices'
  and public.current_member_role((storage.foldername(name))[1]::uuid) in ('owner', 'administratie')
);
