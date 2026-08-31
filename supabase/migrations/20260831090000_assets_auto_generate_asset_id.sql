-- Auto-generate assets.name ("Asset ID" in the UI) when a caller creates an
-- asset without one (issue #105, "Asset edit scherm": "Bij opslaan van een
-- asset is AssetID niet verplicht. Nu wel.").
--
-- Product decision (already made with the user, do NOT relitigate here):
-- `assets.name` stays `not null` -- it is the primary display identifier
-- used everywhere an asset is referenced (AssetsTable's Name column,
-- breadcrumbs, DetailHero title, cross-module links from Work
-- Orders/Contracts/Clients/Activities), and making it nullable would scatter
-- "Unnamed asset" fallback logic across every one of those display sites.
-- Instead, when a caller omits it (null or blank), a BEFORE INSERT trigger
-- fills it in with the next sequential `AST-00042`-style id for that
-- organization -- the exact format already implied by the create-form's
-- existing placeholder ("e.g. AST-00042", see
-- app/(app)/assets/components/asset-form-dialog.tsx).
--
-- Design notes:
--
-- 1. Race-safety: a naive "select max(name) ... then +1" is NOT safe under
--    concurrent inserts in the same organization (two simultaneous inserts
--    can both read the same max and mint the same id). Instead this
--    migration adds a dedicated per-organization counter table,
--    `asset_id_sequences` (one row per org, `last_number bigint`), advanced
--    by a single `INSERT ... ON CONFLICT (organization_id) DO UPDATE ...
--    RETURNING` statement in `next_asset_display_id()`. Postgres takes a row
--    lock on the target `asset_id_sequences` row for the duration of that
--    UPSERT, so two concurrent callers for the *same* organization are
--    serialized (the second blocks until the first commits/rolls back its
--    row lock, then reads the already-incremented value) and can never
--    observe or return the same number. Callers from *different*
--    organizations never contend with each other, since each organization
--    has its own counter row. This is the standard Postgres-native
--    "sequence per tenant" pattern -- preferred here over one global
--    `sequence` object per organization (which would require dynamically
--    creating/dropping a database sequence per tenant, an unnecessary
--    DDL-per-tenant operational cost) and over a naive max+1 (unsafe, see
--    above).
--
-- 2. `asset_id_sequences` is never read or written by any client-facing
--    role -- RLS is enabled with zero policies (and zero grants to
--    `authenticated`), so it is reachable only through
--    `next_asset_display_id()` (`security definer`, mirroring
--    `derive_asset_org_and_client`/`set_created_by` in
--    `20260822190000_clients_sites_assets.sql`). No tenant-isolation RLS
--    policy is needed on it in the traditional sense: it carries no
--    tenant-readable data (just an opaque counter), and it is completely
--    inaccessible to every authenticated role either way. It is still kept
--    `organization_id`-scoped (one row per org, FK'd to `organizations`) so
--    each tenant's Asset ID sequence is independent, matching the rest of
--    this schema's tenant-scoping convention.
--
-- 3. Trigger ordering: `assign_default_asset_name()` needs `new.organization_id`
--    to already be resolved, which happens in `derive_asset_org_and_client`
--    (`20260822190000_clients_sites_assets.sql`). Postgres fires same-timing
--    triggers in alphabetical order by trigger name -- `assets_derive_org_and_client`
--    sorts before `assets_set_default_name` ('d' < 's'), so the org id is
--    already final by the time this trigger runs. This is the same
--    ordering trick already documented in
--    `20260826170000_assets_external_reference_brand_model.sql` for
--    `assets_validate_reference_items`, kept as a dedicated trigger here
--    (rather than folded into `derive_asset_org_and_client` the way the
--    `status_id` default was) so it only ever runs on INSERT, never on the
--    `UPDATE OF site_id` re-parent path that also fires
--    `derive_asset_org_and_client` -- an UPDATE must never silently
--    overwrite an existing asset's name.
--
-- 4. Only fills in `new.name` when the caller left it null or blank
--    (whitespace-only) -- never overrides a client-supplied name. Format:
--    `'AST-' || lpad(<n>::text, 5, '0')`, e.g. `AST-00001`, `AST-00042`,
--    matching the create-form's existing placeholder text exactly (5-digit
--    zero-padding). At 100,000 assets in one organization the number simply
--    grows past 5 digits (`AST-100000`) rather than erroring or wrapping --
--    lpad only pads up to the minimum width, it never truncates.
--
-- 5. `assets.name` remains `not null` at the column level -- this trigger
--    runs BEFORE the NOT NULL constraint is enforced (all BEFORE ROW
--    triggers run first, then Postgres checks constraints against the final
--    NEW row), so a caller that omits `name` entirely (or sends null/"")
--    still always ends up with a non-null value in the actual inserted row.
--    Follow-up (api-backend-engineer, not this migration): `name` in
--    `app/(app)/assets/schema.ts` should become `.optional()` on the create
--    path so the Zod layer stops rejecting an omitted Asset ID before the
--    request ever reaches the DB.

-- ---------------------------------------------------------------------------
-- 1. Per-organization counter table backing the auto-generated Asset ID.
-- ---------------------------------------------------------------------------
create table public.asset_id_sequences (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  last_number bigint not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.asset_id_sequences is
  'Per-organization counter backing auto-generated assets.name values (format AST-00001) when a caller creates an asset without supplying one (issue #105). One row per organization; last_number is the last-issued sequence number, advanced atomically by next_asset_display_id() via a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING statement, which Postgres serializes per-row (row lock on the target organization''s counter row) so concurrent inserts within the same organization can never receive the same number. RLS is enabled with zero policies and there are no grants to `authenticated` -- this table is never read or written directly by any client-facing role, only by next_asset_display_id() (SECURITY DEFINER).';

comment on column public.asset_id_sequences.last_number is
  'The last sequence number issued for this organization''s Asset IDs (AST-<lpad(last_number, 5, ''0'')>). Starts at 0 (no assets auto-named yet); next_asset_display_id() increments before returning, so the first issued id is AST-00001.';

alter table public.asset_id_sequences enable row level security;
alter table public.asset_id_sequences force row level security;

-- No RLS policies and no grants to `authenticated` are added, deliberately:
-- this table is reachable only via next_asset_display_id() (SECURITY
-- DEFINER, owned by the migration role which bypasses RLS). Enabling +
-- forcing RLS with zero policies is pure defense in depth in case a grant is
-- ever added here by mistake in the future.

-- ---------------------------------------------------------------------------
-- 2. next_asset_display_id(): atomically issues the next AST-NNNNN id for a
--    given organization.
-- ---------------------------------------------------------------------------
create or replace function public.next_asset_display_id(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
begin
  insert into public.asset_id_sequences (organization_id, last_number)
  values (p_organization_id, 1)
  on conflict (organization_id)
  do update set last_number = public.asset_id_sequences.last_number + 1,
                updated_at = now()
  returning last_number into v_next;

  return 'AST-' || lpad(v_next::text, 5, '0');
end;
$$;

comment on function public.next_asset_display_id(uuid) is
  'Returns the next sequential AST-NNNNN display id (5-digit zero-padded, e.g. AST-00042) for the given organization, atomically advancing that organization''s counter row in asset_id_sequences via a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING statement. Race-safe under concurrent inserts: Postgres takes a row lock on the target asset_id_sequences row for the duration of the UPSERT, so two simultaneous callers for the same organization are serialized (the second waits for the first''s row lock to release, then reads the already-incremented value) and never observe or return the same number; callers from different organizations never contend, since each has its own counter row. SECURITY DEFINER because callers (assign_default_asset_name, ultimately any authenticated org member creating an asset) have no direct grant on asset_id_sequences.';

revoke all on function public.next_asset_display_id(uuid) from public;

-- ---------------------------------------------------------------------------
-- 3. assign_default_asset_name(): BEFORE INSERT trigger on assets. Fills
--    new.name only when the caller left it null/blank; never overrides a
--    client-supplied name.
-- ---------------------------------------------------------------------------
create or replace function public.assign_default_asset_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is not null and btrim(new.name) <> '' then
    return new;
  end if;

  new.name := public.next_asset_display_id(new.organization_id);
  return new;
end;
$$;

comment on function public.assign_default_asset_name() is
  'BEFORE INSERT trigger on public.assets: when the caller leaves name (the "Asset ID" field in the UI) null or blank, fills it in with the next sequential AST-NNNNN id for the asset''s own organization via next_asset_display_id(). Never overrides a client-supplied name. Depends on new.organization_id already being resolved by assets_derive_org_and_client, which is guaranteed to have already run: Postgres fires same-timing BEFORE INSERT triggers in alphabetical order by trigger name, and assets_derive_org_and_client sorts before assets_set_default_name. Deliberately a dedicated INSERT-only trigger (not folded into derive_asset_org_and_client, unlike the status_id default) so it never fires on the UPDATE OF site_id re-parent path -- an UPDATE must never silently overwrite an existing asset''s name.';

drop trigger if exists assets_set_default_name on public.assets;

create trigger assets_set_default_name
  before insert on public.assets
  for each row execute function public.assign_default_asset_name();
