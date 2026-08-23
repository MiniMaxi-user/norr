-- Contacts on Clients + dependent reference lists (issue #26).
-- See docs/ARCHITECTURE.md ("Core schema (v1)", "Domain completeness").
--
-- Three things in this migration:
--
-- 1. `contacts` — client contact persons, multiple per client. Same shape
--    and design decisions as `sites` (20260822190000_clients_sites_assets.sql):
--    `organization_id` is denormalized from `client_id` (via
--    `derive_contact_organization_id`, same pattern as
--    `derive_site_organization_id`) so RLS stays a single-column
--    `is_member_of_org(organization_id)`/`is_org_owner(organization_id)`
--    check with no in-policy joins. Write boundary is the same
--    "owner only" coarse v1 boundary as clients/sites/assets/reference
--    lists (see design note 2 in 20260822190000_clients_sites_assets.sql) —
--    Planner/Engineer read-only via RLS, finer app-layer scoping is a later
--    phase's concern, not a regression introduced here.
--
-- 2. Generic "dependent reference list" mechanism: `reference_lists` gains
--    `parent_list_key` (which OTHER list_key, in the same organization,
--    this list's items depend on) and `reference_list_items` gains
--    `parent_item_id` (which item, from that parent list, THIS item belongs
--    under). Validated by `validate_reference_list_item_parent`, the same
--    structural style as `validate_asset_reference_items`
--    (20260822200000_reference_lists.sql): a plain FK can't express "must
--    belong to a list with a specific list_key, in the same organization",
--    so a trigger closes that gap instead. This is deliberately generic —
--    NOT hardcoded to asset_subtype/asset_type — so the next dependent list
--    (e.g. Phase 2's SLA tier depending on Contract Type) is just new seed
--    rows, not a new schema/trigger surface.
--
--    `parent_list_key` cannot be a real FK to `reference_lists.list_key`
--    because `list_key` alone is not unique — uniqueness is scoped to
--    `(organization_id, list_key)` — so "which list this points at" can only
--    be resolved inside the trigger (organization-scoped lookup), not
--    declaratively.
--
-- 3. Pilot of (2): a per-organization `asset_subtype` list with
--    `parent_list_key = 'asset_type'`, seeded with a handful of items per
--    existing asset_type value, each carrying `parent_item_id` pointing at
--    its matching asset_type item in the same organization. `assets` gains
--    a nullable `subtype_id`, validated by extending (not duplicating)
--    `validate_asset_reference_items`: subtype_id must (a) be an
--    `asset_subtype` item, (b) in the asset's own organization — both
--    already guaranteed at the generic list level by (2) — AND (c) have
--    `parent_item_id` equal to the asset's own `type_id` — the actual
--    cross-field dependency check, which (2)'s generic list-level trigger
--    cannot express because it only knows about the reference-list-items
--    graph, not about `assets` at all.
--
-- Column-grant lockdown: this codebase has shipped the
-- "revoke all then grant back an explicit subset" boilerplate wrong twice
-- already (see the two `fix_*_column_grants` migrations) — every grant
-- block below is checked against the `sites`/`reference_lists` grants as
-- the template. New tables (`contacts`) get an explicit `revoke all` before
-- the explicit grants (fresh tables default to ALL granted to
-- authenticated/anon); new COLUMNS on already-locked-down existing tables
-- (`reference_lists.parent_list_key`, `reference_list_items.parent_item_id`,
-- `assets.subtype_id`) get a plain additive grant instead, because
-- `ALTER TABLE ADD COLUMN` does NOT re-trigger the "grant ALL by default"
-- behavior — that only fires at table-creation time (see the comment above
-- `assets.type_id`/`status_id`'s grants in 20260822200000_reference_lists.sql
-- for the same reasoning).

-- ---------------------------------------------------------------------------
-- 1. contacts: client contact persons. organization_id is denormalized from
--    clients.organization_id via client_id (see design note 1 above).
-- ---------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  role_item_id uuid references public.reference_list_items (id),
  email text,
  phone text,
  is_primary boolean not null default false,
  notes text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.contacts is
  'A client contact person — multiple per client. organization_id is denormalized from clients.organization_id (via client_id) by derive_contact_organization_id, purely so RLS here stays a single-column is_member_of_org(organization_id)/is_org_owner(organization_id) check instead of joining through clients — same reasoning as sites/assets (see 20260822190000_clients_sites_assets.sql design note 1).';
comment on column public.contacts.organization_id is
  'Denormalized from clients.organization_id (via client_id). Never client-writable — see derive_contact_organization_id trigger and the column-level grants below.';
comment on column public.contacts.role_item_id is
  'FK into reference_list_items for this organization''s contact_role reference list (e.g. Primary/Billing/Site manager/Technical). Nullable. Validated (list_key + organization match) by validate_contact_role_item, the same structural style as validate_asset_reference_items.';
comment on column public.contacts.is_primary is
  'At most one true per client_id (enforced by enforce_single_primary_contact + a partial unique index) — the client''s main point of contact. Distinct from role_item_id: a contact can be the primary contact regardless of their role_item_id value.';

create index contacts_organization_id_idx on public.contacts (organization_id);
create index contacts_client_id_idx on public.contacts (client_id);
create index contacts_role_item_id_idx on public.contacts (role_item_id);
create index contacts_created_by_idx on public.contacts (created_by);

create unique index contacts_one_primary_per_client_idx
  on public.contacts (client_id)
  where is_primary;

alter table public.contacts enable row level security;
alter table public.contacts force row level security;

-- Derives organization_id from client_id, and refuses to let a re-parent
-- (changing client_id on UPDATE) move the contact into a different
-- organization than it already belongs to. Mirrors derive_site_organization_id.
create or replace function public.derive_contact_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select c.organization_id into v_org_id
  from public.clients c
  where c.id = new.client_id;

  if v_org_id is null then
    raise exception 'contacts.client_id % does not reference an existing client', new.client_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a contact to a client in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_contact_organization_id() is
  'BEFORE INSERT/UPDATE OF client_id trigger on public.contacts: sets organization_id from the referenced client, and blocks cross-organization re-parenting. SECURITY DEFINER, same pattern as derive_site_organization_id.';

create trigger contacts_derive_organization_id
  before insert or update of client_id on public.contacts
  for each row execute function public.derive_contact_organization_id();

-- Auto-unsets any previous primary contact for the same client before this
-- row's write completes, so setting a new primary never collides with
-- contacts_one_primary_per_client_idx. Mirrors
-- enforce_single_default_reference_item, keyed off client_id instead of
-- reference_list_id.
create or replace function public.enforce_single_primary_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_primary then
    update public.contacts
    set is_primary = false
    where client_id = new.client_id
      and id <> new.id
      and is_primary = true;
  end if;
  return new;
end;
$$;

comment on function public.enforce_single_primary_contact() is
  'BEFORE INSERT/UPDATE OF is_primary trigger: when a contact is marked is_primary, unsets is_primary on every other contact for the same client_id first. Mirrors enforce_single_default_reference_item.';

create trigger contacts_enforce_single_primary
  before insert or update of is_primary on public.contacts
  for each row execute function public.enforce_single_primary_contact();

-- Validates that contacts.role_item_id points at an item from the
-- contact_role list, in the contact's own organization. Same structural
-- style as validate_asset_reference_items.
create or replace function public.validate_contact_role_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_org uuid;
  v_role_key text;
begin
  if new.role_item_id is not null then
    select rl.organization_id, rl.list_key into v_role_org, v_role_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.role_item_id;

    if v_role_org is null then
      raise exception 'contacts.role_item_id % does not reference an existing reference_list_items row', new.role_item_id
        using errcode = '23503';
    elsif v_role_key <> 'contact_role' then
      raise exception 'contacts.role_item_id must reference an item from the contact_role reference list (got list_key=%)', v_role_key
        using errcode = '23514';
    elsif v_role_org <> new.organization_id then
      raise exception 'contacts.role_item_id must belong to the same organization as the contact'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_contact_role_item() is
  'BEFORE INSERT/UPDATE OF role_item_id trigger on public.contacts: rejects an item from the wrong list_key or from a different organization''s reference list. Runs after contacts_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger contacts_validate_role_item
  before insert or update of role_item_id on public.contacts
  for each row execute function public.validate_contact_role_item();

create trigger contacts_set_created_by
  before insert on public.contacts
  for each row execute function public.set_created_by();

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

-- RLS: identical shape to sites — select: any org member; write: owner only.
create policy "contacts_select_member"
on public.contacts
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "contacts_insert_owner"
on public.contacts
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "contacts_update_owner"
on public.contacts
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "contacts_delete_owner"
on public.contacts
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.contacts from authenticated;

grant select, delete on public.contacts to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_contact_organization_id. created_by intentionally excluded:
-- stamped by set_created_by.
grant insert (
  client_id, name, role_item_id, email, phone, is_primary, notes
) on public.contacts to authenticated;
grant update (
  client_id, name, role_item_id, email, phone, is_primary, notes
) on public.contacts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Dependent reference lists (generic capability): reference_lists gains
--    parent_list_key, reference_list_items gains parent_item_id.
-- ---------------------------------------------------------------------------
alter table public.reference_lists
  add column parent_list_key text,
  add constraint reference_lists_parent_list_key_format
    check (parent_list_key is null or parent_list_key ~ '^[a-z][a-z0-9_]*$'),
  add constraint reference_lists_no_self_parent
    check (parent_list_key is null or parent_list_key <> list_key);

comment on column public.reference_lists.parent_list_key is
  'When set, every item in THIS list must have parent_item_id pointing at an item belonging to a list with list_key = this value, in the SAME organization (e.g. asset_subtype has parent_list_key=''asset_type''). Plain text, not a FK, because list_key alone is not unique (uniqueness is per (organization_id, list_key)) — resolved organization-scoped inside validate_reference_list_item_parent, not by a declarative FK. Generic mechanism, reused by any future dependent picklist (e.g. Phase 2 SLA tier depending on Contract Type) — not specific to asset_subtype.';

-- New column on an existing, already-locked-down table: additive grant only
-- (see migration header). Insert-only — like reference_list_items'
-- reference_list_id, a list's dependency is a structural property fixed at
-- creation, not something meaningfully "re-parented" later.
grant insert (parent_list_key) on public.reference_lists to authenticated;

alter table public.reference_list_items
  add column parent_item_id uuid references public.reference_list_items (id);

comment on column public.reference_list_items.parent_item_id is
  'FK to the reference_list_items row this item depends on. Required (and validated) when this item''s own list has a non-null parent_list_key — e.g. an asset_subtype item''s parent_item_id must point at the asset_type item it belongs under. Validated by validate_reference_list_item_parent (list_key + organization match); a plain FK alone cannot express "must belong to a list with list_key = the specific parent_list_key configured on this item''s own list."';

create index reference_list_items_parent_item_id_idx on public.reference_list_items (parent_item_id);

grant insert (parent_item_id) on public.reference_list_items to authenticated;
grant update (parent_item_id) on public.reference_list_items to authenticated;

-- Validates the dependent-list relationship: if this item's own list has a
-- non-null parent_list_key, parent_item_id must be set and must resolve to
-- an item belonging to a list with list_key = that parent_list_key, in the
-- same organization. Mirrors validate_asset_reference_items's structure.
create or replace function public.validate_reference_list_item_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_own_org uuid;
  v_own_parent_list_key text;
  v_parent_org uuid;
  v_parent_list_key text;
begin
  select rl.organization_id, rl.parent_list_key
  into v_own_org, v_own_parent_list_key
  from public.reference_lists rl
  where rl.id = new.reference_list_id;

  if v_own_org is null then
    raise exception 'reference_list_items.reference_list_id % does not reference an existing reference_lists row', new.reference_list_id
      using errcode = '23503';
  end if;

  if v_own_parent_list_key is null then
    -- This item's list has no dependency configured — parent_item_id has
    -- nothing to validate against and must not be set.
    if new.parent_item_id is not null then
      raise exception 'reference_list_items.parent_item_id may only be set when the item''s own list has a parent_list_key configured (this item''s list has none)'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.parent_item_id is null then
    raise exception 'reference_list_items.parent_item_id is required because this item''s list has parent_list_key=%', v_own_parent_list_key
      using errcode = '23514';
  end if;

  select rl.organization_id, rl.list_key
  into v_parent_org, v_parent_list_key
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rli.id = new.parent_item_id;

  if v_parent_org is null then
    raise exception 'reference_list_items.parent_item_id % does not reference an existing reference_list_items row', new.parent_item_id
      using errcode = '23503';
  elsif v_parent_list_key <> v_own_parent_list_key then
    raise exception 'reference_list_items.parent_item_id must reference an item from the % reference list (got list_key=%)', v_own_parent_list_key, v_parent_list_key
      using errcode = '23514';
  elsif v_parent_org <> v_own_org then
    raise exception 'reference_list_items.parent_item_id must belong to the same organization as the item'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_reference_list_item_parent() is
  'BEFORE INSERT/UPDATE OF reference_list_id, parent_item_id trigger on public.reference_list_items: enforces the generic dependent-list relationship declared by reference_lists.parent_list_key. Rejects a missing parent_item_id when required, a parent from the wrong list_key, or a parent from a different organization. Generic — not specific to asset_subtype/asset_type.';

create trigger reference_list_items_validate_parent
  before insert or update of reference_list_id, parent_item_id on public.reference_list_items
  for each row execute function public.validate_reference_list_item_parent();

-- ---------------------------------------------------------------------------
-- 3a. Seeding: contact_role (for contacts.role_item_id) and asset_subtype
--     (pilot dependent list, parent_list_key = asset_type) extend
--     seed_default_reference_lists per its documented extension pattern.
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
  v_contact_role_list_id uuid;
  v_asset_subtype_list_id uuid;
  v_hvac_id uuid;
  v_electrical_id uuid;
  v_plumbing_id uuid;
  v_generator_id uuid;
  v_other_id uuid;
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

  -- contact_role: for contacts.role_item_id (issue #26). Not a dependent
  -- list — flat, like asset_type/asset_status.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'contact_role', 'Contact Role')
  on conflict (organization_id, list_key) do nothing;

  select id into v_contact_role_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'contact_role';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_contact_role_list_id, p_organization_id, 'primary', 'Primary', 1, true),
    (v_contact_role_list_id, p_organization_id, 'billing', 'Billing', 2, false),
    (v_contact_role_list_id, p_organization_id, 'site_manager', 'Site manager', 3, false),
    (v_contact_role_list_id, p_organization_id, 'technical', 'Technical', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- asset_subtype: pilot dependent list (issue #26), parent_list_key =
  -- asset_type. Each item's parent_item_id points at the matching
  -- asset_type item just seeded/looked-up above, in this same organization.
  insert into public.reference_lists (organization_id, list_key, name, parent_list_key)
  values (p_organization_id, 'asset_subtype', 'Asset Sub-type', 'asset_type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_subtype_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_subtype';

  select id into v_hvac_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'hvac';
  select id into v_electrical_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'electrical';
  select id into v_plumbing_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'plumbing';
  select id into v_generator_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'generator';
  select id into v_other_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'other';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, parent_item_id)
  values
    (v_asset_subtype_list_id, p_organization_id, 'compressor', 'Compressor', 1, v_hvac_id),
    (v_asset_subtype_list_id, p_organization_id, 'thermostat', 'Thermostat', 2, v_hvac_id),
    (v_asset_subtype_list_id, p_organization_id, 'ductwork', 'Ductwork', 3, v_hvac_id),
    (v_asset_subtype_list_id, p_organization_id, 'panel', 'Panel', 4, v_electrical_id),
    (v_asset_subtype_list_id, p_organization_id, 'wiring', 'Wiring', 5, v_electrical_id),
    (v_asset_subtype_list_id, p_organization_id, 'lighting', 'Lighting', 6, v_electrical_id),
    (v_asset_subtype_list_id, p_organization_id, 'pipe', 'Pipe', 7, v_plumbing_id),
    (v_asset_subtype_list_id, p_organization_id, 'valve', 'Valve', 8, v_plumbing_id),
    (v_asset_subtype_list_id, p_organization_id, 'pump', 'Pump', 9, v_plumbing_id),
    (v_asset_subtype_list_id, p_organization_id, 'engine', 'Engine', 10, v_generator_id),
    (v_asset_subtype_list_id, p_organization_id, 'transfer_switch', 'Transfer switch', 11, v_generator_id),
    (v_asset_subtype_list_id, p_organization_id, 'other_subtype', 'Other', 12, v_other_id)
  on conflict (reference_list_id, value) do nothing;
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Extended in 20260823090000_contacts_dependent_reference_lists.sql with contact_role (flat) and asset_subtype (pilot dependent list, parent_list_key=asset_type) blocks. Future picklists should extend this function the same way, plus a one-time backfill call in that feature''s own migration.';

-- Backfill: seed the new contact_role/asset_subtype lists (and any missing
-- asset_type/asset_status items) for every organization that already
-- existed before this migration ran — the organizations_seed_reference_lists
-- trigger only fires for future inserts.
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
-- 3b. assets.subtype_id: nullable FK into the asset_subtype list, validated
--     by extending validate_asset_reference_items (not a parallel trigger).
-- ---------------------------------------------------------------------------
alter table public.assets
  add column subtype_id uuid references public.reference_list_items (id);

comment on column public.assets.subtype_id is
  'FK into reference_list_items for this organization''s asset_subtype reference list (parent_list_key=asset_type). Nullable. Validated by validate_asset_reference_items: must be an asset_subtype item in the asset''s own organization (both already guaranteed at the list level by validate_reference_list_item_parent) AND its parent_item_id must equal this asset''s own type_id — the cross-field dependency check beyond what the generic list-level trigger can express.';

create index assets_subtype_id_idx on public.assets (subtype_id);

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
  v_subtype_org uuid;
  v_subtype_key text;
  v_subtype_parent_item_id uuid;
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

  if new.subtype_id is not null then
    select rl.organization_id, rl.list_key, rli.parent_item_id
    into v_subtype_org, v_subtype_key, v_subtype_parent_item_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.subtype_id;

    if v_subtype_org is null then
      raise exception 'assets.subtype_id % does not reference an existing reference_list_items row', new.subtype_id
        using errcode = '23503';
    elsif v_subtype_key <> 'asset_subtype' then
      raise exception 'assets.subtype_id must reference an item from the asset_subtype reference list (got list_key=%)', v_subtype_key
        using errcode = '23514';
    elsif v_subtype_org <> new.organization_id then
      raise exception 'assets.subtype_id must belong to the same organization as the asset'
        using errcode = '23514';
    elsif new.type_id is null or v_subtype_parent_item_id is distinct from new.type_id then
      raise exception 'assets.subtype_id must be a sub-type of the asset''s own type_id (the subtype item''s parent_item_id must equal assets.type_id)'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_asset_reference_items() is
  'BEFORE INSERT/UPDATE OF type_id, status_id, subtype_id trigger on public.assets: rejects an item from the wrong list_key or a different organization''s reference list (type_id/status_id/subtype_id alike), and additionally rejects a subtype_id whose parent_item_id does not match the asset''s own type_id — the cross-field dependency check that the generic reference_list_items-level trigger (validate_reference_list_item_parent) cannot express on its own. Runs after assets_derive_org_and_client (alphabetically later trigger name, same timing), so new.organization_id is already final.';

drop trigger if exists assets_validate_reference_items on public.assets;

create trigger assets_validate_reference_items
  before insert or update of type_id, status_id, subtype_id on public.assets
  for each row execute function public.validate_asset_reference_items();

-- New column on an existing, already-locked-down table: plain additive
-- grant (see migration header) — same reasoning as type_id/status_id's
-- grants in 20260822200000_reference_lists.sql.
grant insert (subtype_id) on public.assets to authenticated;
grant update (subtype_id) on public.assets to authenticated;
