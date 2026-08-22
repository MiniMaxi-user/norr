-- Tenant-configurable reference/lookup data (picklists), starting with Asset
-- Type and Asset Status. See docs/ARCHITECTURE.md ("Core schema (v1)").
--
-- Problem being fixed: `assets.status` was a hardcoded Postgres enum
-- (`asset_status`, values 'active'/'decommissioned') and `assets.type` was
-- ungoverned free text. Neither lets a tenant configure their own set of
-- values ("elke client heeft zijn eigen configuratie") — a Postgres enum
-- specifically cannot gain a new value per-tenant without a schema
-- migration every time, which is the wrong tool here.
--
-- Pattern chosen: (a) GENERIC reference-list pattern
-- (`reference_lists` + `reference_list_items`, keyed by `list_key`), NOT
-- (b) one dedicated table pair per concept (`asset_types`/`asset_statuses`).
--
-- Why (a) over (b): the roadmap already flags more of these coming (Phase 2
-- Contracts wants a configurable `type`; SLA tiers, work-order priorities,
-- etc. are the same shape) — with (b) every one of those needs its own
-- table, its own RLS policy pair, its own seed trigger, its own grant
-- lockdown boilerplate (and this codebase has *twice* already shipped that
-- boilerplate wrong on the first pass — see the two `fix_*_column_grants`
-- migrations — so minimizing how many times we write it is a real risk
-- reduction, not just DRY-for-its-own-sake). With (a), the schema, RLS
-- policies, grant lockdown, and seeding mechanism are written ONCE and
-- every future configurable picklist is just new rows (a new `list_key` +
-- seed items appended to `seed_default_reference_lists()`), not a new
-- migration surface. The trade-off is real and worth naming: every query
-- against a picklist's items is one join deeper (`reference_list_items` ->
-- `reference_lists` to get `organization_id`/`list_key`) than a dedicated
-- table would be, and there's no per-concept FK typing (e.g. nothing stops
-- a caller, at the schema level alone, from trying to point `assets.type_id`
-- at an `asset_status` item by id — this migration closes that specific gap
-- with the `validate_asset_reference_items` trigger below rather than
-- relying on distinct FK target tables). For a handful of small, admin-
-- configured dropdowns (tens of rows per org, read far more than written),
-- that extra join is negligible next to the migration-churn cost of (b), so
-- (a) is the deliberate choice.
--
-- Design notes (read before extending):
--
-- 1. `reference_lists` is the picklist container (one per organization per
--    `list_key`, e.g. ('org-123', 'asset_type')); `reference_list_items` are
--    the individual selectable values within it. `reference_list_items`
--    carries its own denormalized `organization_id` (derived from
--    `reference_list_id` by the `derive_reference_list_item_org` trigger),
--    for the exact same reason `sites`/`assets` denormalize `organization_id`
--    from their parent chain (see `20260822190000_clients_sites_assets.sql`
--    design note 1): every tenant-scoped table keeps the same simple,
--    single-column `is_member_of_org(organization_id)` /
--    `is_org_owner(organization_id)` RLS policy shape, no in-policy joins.
--
-- 2. Seeded defaults per organization: `seed_default_reference_lists(org_id)`
--    is idempotent (safe to re-run; uses `on conflict do nothing`) and is
--    called two ways:
--      a. Automatically, via an `after insert on organizations` trigger
--         (`organizations_seed_reference_lists`), SECURITY DEFINER,
--         following the same pattern as `handle_new_auth_user` in the
--         baseline migration — so every NEW organization gets sensible
--         defaults without the application layer having to remember to
--         call anything.
--      b. Once, directly in this migration, for every organization that
--         already existed before this migration ran (backfill — this
--         project already has one live organization; see below).
--    Future picklists (e.g. Phase 2's Contract Type) should extend this
--    same function with another `insert ... on conflict do nothing` block
--    (new `list_key`, new default items) plus a one-time backfill call for
--    existing organizations in that feature's own migration — not invent a
--    new seeding mechanism.
--
-- 3. RLS: identical shape on both tables — SELECT is
--    `is_member_of_org(organization_id)` (any role, needed for every Select
--    dropdown in the app), INSERT/UPDATE/DELETE is `is_org_owner(organization_id)`
--    only (configuring picklists is an owner/admin action), matching the
--    `clients`/`sites`/`assets` write boundary exactly.
--
-- 4. `reference_list_items.reference_list_id` is deliberately EXCLUDED from
--    the UPDATE column grant (see grants below) — unlike `sites.client_id`/
--    `assets.site_id`, there's no legitimate "move this to a different
--    parent" action for a reference item (moving "HVAC" from the
--    `asset_type` list to the `asset_status` list is meaningless), so it's
--    simply immutable after creation rather than re-parentable-with-a-guard.
--
-- 5. Exactly one item per list may be `is_default = true` (used to
--    auto-populate `assets.status_id` when a caller omits it on INSERT, the
--    same UX `assets.status` already had via `default 'active'`).
--    `enforce_single_default_reference_item` (BEFORE INSERT/UPDATE OF
--    is_default) auto-unsets any previous default in the same list before
--    the new row's write completes, backed by a partial unique index as a
--    defense-in-depth backstop.
--
-- 6. `assets.type`/`assets.status` (free text / enum) are migrated to
--    `assets.type_id`/`assets.status_id` (uuid FKs into
--    `reference_list_items`). Live-checked on the linked project
--    (`fxpjzcyeevtaadexnkub`, "norr") before writing this migration: exactly
--    one organization exists ("Norr") and ZERO rows currently exist in
--    `public.assets` — so there is no non-trivial data to carry over on
--    THIS project today. The backfill logic below is nonetheless written to
--    handle the general case (any number of existing orgs/assets — e.g.
--    local dev, CI, or this project after more test data is added before
--    this migration is applied), not just "zero rows happens to be safe":
--      - `assets.status` (enum) backfills onto the seeded default
--        `asset_status` item in the asset's own organization matching by
--        `value` ('active'/'decommissioned' — the two existing enum labels,
--        both present among the new defaults).
--      - `assets.type` (free text) backfills by first trying to match an
--        existing item in that org's `asset_type` list by label or slugified
--        value (case-insensitive); if nothing matches, a new custom item is
--        created in that org's `asset_type` list carrying the original free
--        text as its label, so no existing data is silently dropped or
--        coerced into a wrong bucket.
--    The old `asset_status` enum type is dropped at the end, once
--    `assets.status` (its last remaining reference) is dropped.

-- ---------------------------------------------------------------------------
-- reference_lists: one picklist container per (organization, list_key).
-- ---------------------------------------------------------------------------
create table public.reference_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  list_key text not null,
  name text not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, list_key),
  constraint reference_lists_list_key_format check (list_key ~ '^[a-z][a-z0-9_]*$')
);

comment on table public.reference_lists is
  'Tenant-configurable picklist container. One row per (organization, list_key) — e.g. (org-123, ''asset_type''). Individual selectable values live in reference_list_items. See design note in 20260822200000_reference_lists.sql for why this generic pattern was chosen over one dedicated table pair per concept.';
comment on column public.reference_lists.list_key is
  'Stable, app-known identifier for which picklist this is (e.g. ''asset_type'', ''asset_status'', future ''contract_type''). Not a Postgres enum specifically so new keys never require a schema migration to introduce — only a data-seeding change.';

create index reference_lists_organization_id_idx on public.reference_lists (organization_id);
create index reference_lists_created_by_idx on public.reference_lists (created_by);

alter table public.reference_lists enable row level security;
alter table public.reference_lists force row level security;

create trigger reference_lists_set_created_by
  before insert on public.reference_lists
  for each row execute function public.set_created_by();

create trigger reference_lists_set_updated_at
  before update on public.reference_lists
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- reference_list_items: individual selectable values within a list.
-- organization_id is denormalized from reference_list_id (see design note 1).
-- ---------------------------------------------------------------------------
create table public.reference_list_items (
  id uuid primary key default gen_random_uuid(),
  reference_list_id uuid not null references public.reference_lists (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  value text not null,
  label text not null,
  color text,
  sort_order integer not null default 0,
  is_default boolean not null default false,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reference_list_id, value),
  constraint reference_list_items_value_format check (value ~ '^[a-z0-9][a-z0-9_]*$')
);

comment on table public.reference_list_items is
  'A single selectable value within a reference_lists picklist (e.g. label="HVAC", value="hvac" within the org''s asset_type list). value is a stable slug (used by seeding/backfill to find "the default active status" etc.); label is the tenant-editable display text.';
comment on column public.reference_list_items.organization_id is
  'Denormalized from reference_lists.organization_id (via reference_list_id). Never client-writable — see derive_reference_list_item_org trigger and the column-level grants below.';
comment on column public.reference_list_items.value is
  'Stable machine key within the list, e.g. ''active''. Distinct from label so seeding/backfill/app logic can look up a specific well-known item without depending on a tenant-editable display string.';
comment on column public.reference_list_items.is_default is
  'At most one true per reference_list_id (enforced by enforce_single_default_reference_item + a partial unique index). Used to auto-populate e.g. assets.status_id when omitted on insert.';

create index reference_list_items_reference_list_id_idx on public.reference_list_items (reference_list_id);
create index reference_list_items_organization_id_idx on public.reference_list_items (organization_id);
create index reference_list_items_created_by_idx on public.reference_list_items (created_by);
create index reference_list_items_list_sort_idx on public.reference_list_items (reference_list_id, sort_order);

create unique index reference_list_items_one_default_per_list_idx
  on public.reference_list_items (reference_list_id)
  where is_default;

alter table public.reference_list_items enable row level security;
alter table public.reference_list_items force row level security;

create or replace function public.derive_reference_list_item_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select rl.organization_id into v_org_id
  from public.reference_lists rl
  where rl.id = new.reference_list_id;

  if v_org_id is null then
    raise exception 'reference_list_items.reference_list_id % does not reference an existing reference_lists row', new.reference_list_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a reference_list_item to a list in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_reference_list_item_org() is
  'BEFORE INSERT/UPDATE OF reference_list_id trigger: sets organization_id from the referenced list, and blocks cross-organization re-parenting. Same shape as derive_site_organization_id / derive_asset_org_and_client. In practice reference_list_id is excluded from the UPDATE column grant entirely (see grants below), so the UPDATE branch here is a defense-in-depth backstop, not a normally-reachable path.';

create trigger reference_list_items_derive_org
  before insert or update of reference_list_id on public.reference_list_items
  for each row execute function public.derive_reference_list_item_org();

create or replace function public.enforce_single_default_reference_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_default then
    update public.reference_list_items
    set is_default = false
    where reference_list_id = new.reference_list_id
      and id <> new.id
      and is_default = true;
  end if;
  return new;
end;
$$;

comment on function public.enforce_single_default_reference_item() is
  'BEFORE INSERT/UPDATE OF is_default trigger: when a row is marked is_default, unsets is_default on every other item in the same list first, so setting a new default never collides with reference_list_items_one_default_per_list_idx.';

create trigger reference_list_items_enforce_single_default
  before insert or update of is_default on public.reference_list_items
  for each row execute function public.enforce_single_default_reference_item();

create trigger reference_list_items_set_created_by
  before insert on public.reference_list_items
  for each row execute function public.set_created_by();

create trigger reference_list_items_set_updated_at
  before update on public.reference_list_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies: reference_lists
-- Read: any org member. Write: owner only.
-- ---------------------------------------------------------------------------
create policy "reference_lists_select_member"
on public.reference_lists
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "reference_lists_insert_owner"
on public.reference_lists
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "reference_lists_update_owner"
on public.reference_lists
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "reference_lists_delete_owner"
on public.reference_lists
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- This project's public schema grants ALL privileges to authenticated/anon
-- by default on every newly created table (confirmed live in
-- 20260822193000_fix_clients_sites_assets_column_grants.sql /
-- 20260822194500_fix_invites_column_grants.sql) — always revoke first.
revoke all on public.reference_lists from authenticated;

grant select, delete on public.reference_lists to authenticated;
grant insert (organization_id, list_key, name) on public.reference_lists to authenticated;
grant update (name) on public.reference_lists to authenticated;

-- ---------------------------------------------------------------------------
-- RLS policies: reference_list_items
-- Read: any org member (every Select dropdown needs this). Write: owner only.
-- ---------------------------------------------------------------------------
create policy "reference_list_items_select_member"
on public.reference_list_items
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "reference_list_items_insert_owner"
on public.reference_list_items
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "reference_list_items_update_owner"
on public.reference_list_items
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "reference_list_items_delete_owner"
on public.reference_list_items
for delete
to authenticated
using (public.is_org_owner(organization_id));

revoke all on public.reference_list_items from authenticated;

grant select, delete on public.reference_list_items to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_reference_list_item_org. reference_list_id is accepted on INSERT
-- (you must say which list a new item belongs to) but excluded from UPDATE
-- (immutable after creation — see design note 4).
grant insert (reference_list_id, value, label, color, sort_order, is_default) on public.reference_list_items to authenticated;
grant update (value, label, color, sort_order, is_default) on public.reference_list_items to authenticated;

-- ---------------------------------------------------------------------------
-- Seeding: sensible per-organization defaults for asset_type / asset_status.
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_reference_lists(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_type_list_id uuid;
  v_asset_status_list_id uuid;
begin
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'asset_type', 'Asset Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_asset_type_list_id, p_organization_id, 'hvac', 'HVAC', 1, false),
    (v_asset_type_list_id, p_organization_id, 'electrical', 'Electrical', 2, false),
    (v_asset_type_list_id, p_organization_id, 'plumbing', 'Plumbing', 3, false),
    (v_asset_type_list_id, p_organization_id, 'generator', 'Generator', 4, false),
    (v_asset_type_list_id, p_organization_id, 'other', 'Other', 5, true)
  on conflict (reference_list_id, value) do nothing;

  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'asset_status', 'Asset Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default, color)
  values
    (v_asset_status_list_id, p_organization_id, 'active', 'Active', 1, true, 'green'),
    (v_asset_status_list_id, p_organization_id, 'in_repair', 'In Repair', 2, false, 'amber'),
    (v_asset_status_list_id, p_organization_id, 'decommissioned', 'Decommissioned', 3, false, 'gray')
  on conflict (reference_list_id, value) do nothing;
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in this migration to backfill organizations that already existed. Future picklists (e.g. Phase 2 contract_type) should extend this function with another list_key block, plus a one-time backfill call in that feature''s own migration for orgs that already exist by then.';

revoke all on function public.seed_default_reference_lists(uuid) from public;

create or replace function public.handle_new_organization_seed_reference_lists()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_reference_lists(new.id);
  return new;
end;
$$;

comment on function public.handle_new_organization_seed_reference_lists() is
  'AFTER INSERT trigger on organizations: seeds default reference lists/items for every new organization. SECURITY DEFINER, following the same pattern as handle_new_auth_user in the baseline migration, so the application layer never has to remember to do this.';

create trigger organizations_seed_reference_lists
  after insert on public.organizations
  for each row execute function public.handle_new_organization_seed_reference_lists();

-- Backfill: seed defaults for every organization that already existed
-- before this migration ran (the trigger above only fires for future
-- inserts).
do $$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform public.seed_default_reference_lists(r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- assets: migrate off assets.type (free text) / assets.status (enum) onto
-- assets.type_id / assets.status_id (FKs into reference_list_items).
-- ---------------------------------------------------------------------------
alter table public.assets
  add column type_id uuid references public.reference_list_items (id),
  add column status_id uuid references public.reference_list_items (id);

comment on column public.assets.type_id is
  'FK into reference_list_items for this organization''s asset_type reference list. Replaces the old free-text assets.type column. Validated (list_key + organization match) by validate_asset_reference_items.';
comment on column public.assets.status_id is
  'FK into reference_list_items for this organization''s asset_status reference list. Replaces the old assets.status enum column. Defaults to the org''s default asset_status item when omitted on insert (see derive_asset_org_and_client). Validated (list_key + organization match) by validate_asset_reference_items.';

-- Backfill assets.status (enum) -> assets.status_id, matching the existing
-- enum labels onto the seeded default asset_status items (by value) in the
-- asset's own organization.
update public.assets a
set status_id = rli.id
from public.reference_list_items rli
join public.reference_lists rl on rl.id = rli.reference_list_id
where rl.organization_id = a.organization_id
  and rl.list_key = 'asset_status'
  and rli.value = a.status::text
  and a.status_id is null;

-- Backfill assets.type (free text) -> assets.type_id. First try to match an
-- existing item in that org's asset_type list by label or slugified value
-- (case-insensitive); if nothing matches, create a new custom item carrying
-- the original free text as its label, so no existing data is silently
-- dropped.
do $$
declare
  r record;
  v_list_id uuid;
  v_item_id uuid;
  v_slug text;
  v_next_sort integer;
begin
  for r in select id, organization_id, type from public.assets where type_id is null loop
    select id into v_list_id
    from public.reference_lists
    where organization_id = r.organization_id and list_key = 'asset_type';

    if v_list_id is null then
      -- Defensive: should always exist after the backfill loop above, but
      -- guard in case a row's organization was somehow missed.
      insert into public.reference_lists (organization_id, list_key, name)
      values (r.organization_id, 'asset_type', 'Asset Type')
      returning id into v_list_id;
    end if;

    -- Slugify into the format reference_list_items_value_format requires
    -- (^[a-z0-9][a-z0-9_]*$): collapse non-alphanumerics to underscores,
    -- then trim any leading/trailing underscore that would otherwise
    -- violate the "must start with a-z0-9" rule; fall back to a generic
    -- slug if the original type text has no alphanumeric characters at all.
    v_slug := lower(regexp_replace(trim(r.type), '[^a-zA-Z0-9]+', '_', 'g'));
    v_slug := regexp_replace(v_slug, '^_+|_+$', '', 'g');
    if v_slug = '' or v_slug is null then
      v_slug := 'item_' || replace(gen_random_uuid()::text, '-', '_');
    end if;

    select id into v_item_id
    from public.reference_list_items
    where reference_list_id = v_list_id
      and (lower(label) = lower(r.type) or value = v_slug);

    if v_item_id is null then
      select coalesce(max(sort_order), 0) + 1 into v_next_sort
      from public.reference_list_items
      where reference_list_id = v_list_id;

      insert into public.reference_list_items
        (reference_list_id, organization_id, value, label, sort_order)
      values (v_list_id, r.organization_id, v_slug, r.type, v_next_sort)
      on conflict (reference_list_id, value) do update set label = excluded.label
      returning id into v_item_id;
    end if;

    update public.assets set type_id = v_item_id where id = r.id;
  end loop;
end;
$$;

alter table public.assets
  alter column type_id set not null,
  alter column status_id set not null;

create index assets_type_id_idx on public.assets (type_id);
create index assets_status_id_idx on public.assets (status_id);

alter table public.assets
  drop column type,
  drop column status;

drop type public.asset_status;

-- Merge "default status_id when omitted" into the existing organization_id/
-- client_id derivation trigger, so it runs in the correct order (org_id
-- must be known before we can look up that org's default status item) —
-- Postgres fires same-timing triggers in name order, and folding this into
-- the existing function sidesteps having to reason about trigger-name
-- ordering between two separate triggers.
create or replace function public.derive_asset_org_and_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_org_id uuid;
begin
  select s.client_id, s.organization_id into v_client_id, v_org_id
  from public.sites s
  where s.id = new.site_id;

  if v_org_id is null then
    raise exception 'assets.site_id % does not reference an existing site', new.site_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move an asset to a site in a different organization'
      using errcode = '23514';
  end if;

  new.client_id := v_client_id;
  new.organization_id := v_org_id;

  if new.status_id is null then
    select rli.id into new.status_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rl.organization_id = v_org_id
      and rl.list_key = 'asset_status'
      and rli.is_default
    limit 1;
  end if;

  return new;
end;
$$;

comment on function public.derive_asset_org_and_client() is
  'BEFORE INSERT/UPDATE OF site_id trigger on public.assets: sets client_id and organization_id from the referenced site, blocks cross-organization re-parenting, and (since this always fires on INSERT) fills in status_id with the organization''s default asset_status item when the caller omitted it — replacing the old "status asset_status not null default ''active''" column default now that the default is tenant-configurable data, not a fixed enum literal.';

-- Validates that assets.type_id / assets.status_id point at an item from
-- the correct list_key, in the asset's own organization. A plain FK to
-- reference_list_items(id) alone can't express "and it must be from the
-- asset_type list, not the asset_status list, and it must belong to this
-- asset's tenant" — that's the real cost of the generic reference-list
-- pattern (see the migration-header trade-off note), closed here instead of
-- by distinct per-concept FK target tables.
create or replace function public.validate_asset_reference_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type_org uuid;
  v_type_key text;
  v_status_org uuid;
  v_status_key text;
begin
  if new.type_id is not null then
    select rl.organization_id, rl.list_key into v_type_org, v_type_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.type_id;

    if v_type_org is null then
      raise exception 'assets.type_id % does not reference an existing reference_list_items row', new.type_id
        using errcode = '23503';
    elsif v_type_key <> 'asset_type' then
      raise exception 'assets.type_id must reference an item from the asset_type reference list (got list_key=%)', v_type_key
        using errcode = '23514';
    elsif v_type_org <> new.organization_id then
      raise exception 'assets.type_id must belong to the same organization as the asset'
        using errcode = '23514';
    end if;
  end if;

  if new.status_id is not null then
    select rl.organization_id, rl.list_key into v_status_org, v_status_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.status_id;

    if v_status_org is null then
      raise exception 'assets.status_id % does not reference an existing reference_list_items row', new.status_id
        using errcode = '23503';
    elsif v_status_key <> 'asset_status' then
      raise exception 'assets.status_id must reference an item from the asset_status reference list (got list_key=%)', v_status_key
        using errcode = '23514';
    elsif v_status_org <> new.organization_id then
      raise exception 'assets.status_id must belong to the same organization as the asset'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_asset_reference_items() is
  'BEFORE INSERT/UPDATE OF type_id, status_id trigger on public.assets: rejects an item from the wrong list_key (e.g. an asset_status item used as type_id) or from a different organization''s reference list. Runs after derive_asset_org_and_client (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger assets_validate_reference_items
  before insert or update of type_id, status_id on public.assets
  for each row execute function public.validate_asset_reference_items();

-- type_id / status_id grants: these are new columns on an already-existing
-- table, not privileges on a newly-created table, so this project's
-- "default privileges grant ALL to authenticated on new tables" gotcha does
-- NOT apply here (default privileges only fire at table-creation time; a
-- previously column-restricted table's ALTER TABLE ADD COLUMN grants
-- nothing automatically). public.assets already had `revoke all` applied in
-- 20260822193000_fix_clients_sites_assets_column_grants.sql, so this is a
-- plain additive grant, replacing the old type/status column grants that
-- were dropped automatically along with those columns above.
grant insert (type_id, status_id) on public.assets to authenticated;
grant update (type_id, status_id) on public.assets to authenticated;
