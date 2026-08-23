-- Time Tracking on Work Orders (issue #15, Phase 2 — "Operations core").
-- See docs/ARCHITECTURE.md ("Core schema (v1)", RBAC matrix's `planning`
-- row) and docs/ROADMAP.md. Time tracking was explicitly named as its own
-- sub-entity, out of scope, in 20260823120000_work_orders_core.sql's design
-- note 6 — this migration is that follow-up.
--
-- `time_entries` is a sub-resource of Work Orders, reusing the existing
-- `planning` RBAC module (lib/rbac/permissions.ts) rather than inventing a
-- new one — same reasoning `contacts` used to reuse the `clients` module.
-- This IS a real, deliberate matrix change though: `planning`'s engineer row
-- gains `create_own` (an engineer can log/clock in their OWN time), while
-- still lacking plain `create` (an engineer still cannot create Work Orders
-- themselves). See lib/rbac/permissions.ts and docs/ARCHITECTURE.md, updated
-- in the same commit as this migration.
--
-- This is the THIRD table (after work_orders, contracts) enforcing a
-- per-role RBAC matrix row as real RLS via `current_member_role` — same
-- helper, no new one needed, but a NEW shape again: engineer gets INSERT
-- (scoped to their own user_id), unlike work_orders (engineer has no
-- INSERT at all).
--
-- Design notes (read before extending):
--
-- 1. `organization_id` denormalization: same pattern as `sites`/`contacts`/
--    `work_orders`/`contracts` — denormalized from `work_orders.organization_id`
--    via `work_order_id` (`derive_time_entry_organization_id`), so RLS stays
--    a single-column `is_member_of_org(organization_id)`/
--    `current_member_role(organization_id)` shape with no in-policy joins.
--    The same trigger fills in the organization's default `time_entry_type`
--    item when `entry_type_id` is omitted on insert (same fold-in-the-
--    derive-trigger pattern as `work_orders.status_id`/`contracts.type_id`).
--
-- 2. `user_id` (not null) is the engineer/whoever logged the time. Validated
--    by `validate_time_entry_relations` to be a member of the time entry's
--    own organization — mirrors `work_orders.assigned_to`'s validation
--    exactly, just against a different column/table pair. This is also the
--    column the engineer RLS scoping (SELECT/INSERT/UPDATE "own rows only")
--    is keyed on, same role `assigned_to` plays on `work_orders`.
--
-- 3. Clock-in/clock-out UX: `started_at` (not null, default now()),
--    `ended_at` (nullable — null means "currently running"). Cross-field
--    check `ended_at >= started_at` (when set) is a plain table CHECK
--    constraint (`time_entries_ended_at_after_started_at`), not a trigger —
--    unlike the FK-resolving cross-field checks elsewhere in this schema,
--    this one only compares two columns on the same row, which a CHECK
--    constraint expresses natively.
--
-- 4. `entry_type_id` is a reference-list FK (nullable, defaults to the org's
--    default `time_entry_type` item), validated by
--    `validate_time_entry_reference_items` — same structural style as
--    `validate_work_order_reference_items`/`validate_contract_reference_items`.
--    `time_entry_type` is a flat list (Labor [default], Travel, Break),
--    seeded by extending `seed_default_reference_lists` per its documented
--    extension pattern, with a backfill for existing organizations.
--
-- 5. RLS — implements `lib/rbac/permissions.ts`'s updated `planning` row for
--    this sub-resource:
--      owner:    CRUD, all rows
--      planner:  CRUD, all rows
--      engineer: SELECT/INSERT/UPDATE scoped to user_id = auth.uid() only
--                (own clock-in/out); NO DELETE (corrections go through a
--                planner/owner, same conservative precedent as work_orders)
--      finance/administratie: SELECT only, all rows
--    The one shape difference from `work_orders`: engineer here DOES get
--    INSERT (their own rows only) because the matrix's `create_own` action
--    now applies — `work_orders` itself is unaffected (still owner/planner
--    INSERT only; engineer still lacks plain `create`).
--
-- Column-grant lockdown: new table, so the usual "this project's public
-- schema grants ALL to authenticated/anon by default on new tables" gotcha
-- applies — `revoke all` before the explicit grants (see the two
-- `fix_*_column_grants` migrations for why this matters). `id` is included
-- in the INSERT grant (not omitted) per the reasoning documented in
-- 20260823120000_work_orders_core.sql's grant block: this migration's own
-- RLS test explicitly assigns deterministic fixture ids on insert.

-- ---------------------------------------------------------------------------
-- time_entries: logs an engineer's time (labor/travel/break) against a work
-- order, clocked in/out. organization_id is denormalized from
-- work_orders.organization_id via work_order_id (see design note 1 above).
-- ---------------------------------------------------------------------------
create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  entry_type_id uuid references public.reference_list_items (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entries_ended_at_after_started_at check (ended_at is null or ended_at >= started_at)
);

comment on table public.time_entries is
  'An engineer''s labor/travel/break time logged against a work order, clocked in/out. organization_id is denormalized from work_orders.organization_id (via work_order_id) by derive_time_entry_organization_id, same reasoning as sites/contacts/work_orders/contracts. Sub-resource of Work Orders, reuses the `planning` RBAC module (lib/rbac/permissions.ts) rather than a new one.';
comment on column public.time_entries.organization_id is
  'Denormalized from work_orders.organization_id (via work_order_id). Never client-writable — see derive_time_entry_organization_id trigger and the column-level grants below.';
comment on column public.time_entries.user_id is
  'The engineer (or any member) who logged this time. Not null. Must be a member of the time entry''s own organization (validated by validate_time_entry_relations) — mirrors work_orders.assigned_to''s validation. This is also the column the engineer RLS scoping (SELECT/INSERT/UPDATE "own rows only") is keyed on.';
comment on column public.time_entries.entry_type_id is
  'FK into reference_list_items for this organization''s time_entry_type list (Labor [default]/Travel/Break). Nullable; defaults to the org''s default time_entry_type item when omitted on insert (see derive_time_entry_organization_id). Validated by validate_time_entry_reference_items.';
comment on column public.time_entries.started_at is
  'Clock-in time. Not null, defaults to now().';
comment on column public.time_entries.ended_at is
  'Clock-out time. Nullable — null means the entry is currently running (clock-in without clock-out yet). When set, must be >= started_at (time_entries_ended_at_after_started_at check constraint).';

create index time_entries_organization_id_idx on public.time_entries (organization_id);
create index time_entries_work_order_id_idx on public.time_entries (work_order_id);
create index time_entries_user_id_idx on public.time_entries (user_id);
create index time_entries_entry_type_id_idx on public.time_entries (entry_type_id);
create index time_entries_created_by_idx on public.time_entries (created_by);
create index time_entries_started_at_idx on public.time_entries (started_at);

alter table public.time_entries enable row level security;
alter table public.time_entries force row level security;

-- Derives organization_id from work_order_id (blocking cross-organization
-- re-parenting, same as derive_work_order_organization_id/
-- derive_contract_organization_id), and fills in the organization's default
-- time_entry_type item when entry_type_id is omitted on insert — folded into
-- this trigger for the same trigger-ordering reason work_orders.status_id's
-- default was folded into derive_work_order_organization_id: organization_id
-- must be known first.
create or replace function public.derive_time_entry_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select wo.organization_id into v_org_id
  from public.work_orders wo
  where wo.id = new.work_order_id;

  if v_org_id is null then
    raise exception 'time_entries.work_order_id % does not reference an existing work order', new.work_order_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a time entry to a work order in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;

  if new.entry_type_id is null then
    select rli.id into new.entry_type_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rl.organization_id = v_org_id
      and rl.list_key = 'time_entry_type'
      and rli.is_default
    limit 1;
  end if;

  return new;
end;
$$;

comment on function public.derive_time_entry_organization_id() is
  'BEFORE INSERT/UPDATE OF work_order_id trigger on public.time_entries: sets organization_id from the referenced work order, blocks cross-organization re-parenting, and fills in entry_type_id with the organization''s default time_entry_type item when the caller omitted it. Runs before validate_time_entry_relations/validate_time_entry_reference_items (alphabetically earlier trigger name, same timing), so organization_id and entry_type_id are already final by the time those run.';

create trigger time_entries_derive_organization_id
  before insert or update of work_order_id on public.time_entries
  for each row execute function public.derive_time_entry_organization_id();

-- Cross-field consistency: user_id must be a member of the time entry's own
-- organization. SECURITY DEFINER so it can resolve the referenced
-- memberships row regardless of the caller's own RLS visibility (mirrors
-- validate_work_order_relations's assigned_to check).
create or replace function public.validate_time_entry_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_is_member boolean;
begin
  select exists (
    select 1
    from public.memberships m
    where m.user_id = new.user_id
      and m.organization_id = new.organization_id
  ) into v_user_is_member;

  if not v_user_is_member then
    raise exception 'time_entries.user_id must be a member of the same organization as the time entry'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_time_entry_relations() is
  'BEFORE INSERT/UPDATE OF work_order_id, user_id trigger on public.time_entries: rejects a user_id who is not a member of the time entry''s own organization. Runs after derive_time_entry_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger time_entries_validate_relations
  before insert or update of work_order_id, user_id on public.time_entries
  for each row execute function public.validate_time_entry_relations();

-- Validates that entry_type_id points at an item from the correct list_key,
-- in the time entry's own organization. Same structural style as
-- validate_work_order_reference_items/validate_contract_reference_items.
create or replace function public.validate_time_entry_reference_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_type_org uuid;
  v_entry_type_key text;
begin
  if new.entry_type_id is not null then
    select rl.organization_id, rl.list_key into v_entry_type_org, v_entry_type_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.entry_type_id;

    if v_entry_type_org is null then
      raise exception 'time_entries.entry_type_id % does not reference an existing reference_list_items row', new.entry_type_id
        using errcode = '23503';
    elsif v_entry_type_key <> 'time_entry_type' then
      raise exception 'time_entries.entry_type_id must reference an item from the time_entry_type reference list (got list_key=%)', v_entry_type_key
        using errcode = '23514';
    elsif v_entry_type_org <> new.organization_id then
      raise exception 'time_entries.entry_type_id must belong to the same organization as the time entry'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_time_entry_reference_items() is
  'BEFORE INSERT/UPDATE OF entry_type_id trigger on public.time_entries: rejects an item from the wrong list_key or a different organization''s reference list. Runs after derive_time_entry_organization_id (alphabetically later trigger name, same timing), so new.organization_id (and the default-filled entry_type_id) are already final.';

create trigger time_entries_validate_reference_items
  before insert or update of entry_type_id on public.time_entries
  for each row execute function public.validate_time_entry_reference_items();

create trigger time_entries_set_created_by
  before insert on public.time_entries
  for each row execute function public.set_created_by();

create trigger time_entries_set_updated_at
  before update on public.time_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies: time_entries — the RBAC matrix's `planning` row, updated to
-- add engineer create_own (see migration header / lib/rbac/permissions.ts):
--   owner:                 CRUD, all rows
--   planner:                CRUD, all rows
--   engineer:               SELECT/INSERT/UPDATE only rows where
--                            user_id = auth.uid(); no DELETE
--   finance/administratie:  SELECT only, all rows
-- ---------------------------------------------------------------------------

-- SELECT: any member, EXCEPT an engineer, who only sees their own rows.
create policy "time_entries_select_scoped"
on public.time_entries
for select
to authenticated
using (
  public.is_member_of_org(organization_id)
  and (
    public.current_member_role(organization_id) <> 'engineer'
    or user_id = auth.uid()
  )
);

-- INSERT: owner/planner any; engineer only their own clock-in
-- (user_id = auth.uid()).
create policy "time_entries_insert_scoped"
on public.time_entries
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and user_id = auth.uid()
  )
);

-- UPDATE: owner/planner any row; engineer only their own row, and cannot
-- reassign user_id away from themselves (WITH CHECK re-verifies the new row).
create policy "time_entries_update_scoped"
on public.time_entries
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and user_id = auth.uid()
  )
)
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and user_id = auth.uid()
  )
);

-- DELETE: owner/planner only (engineer has no delete action, matches the
-- conservative work_orders precedent — corrections go through a
-- planner/owner).
create policy "time_entries_delete_owner_or_planner"
on public.time_entries
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.time_entries from authenticated;

grant select, delete on public.time_entries to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_time_entry_organization_id. created_by intentionally excluded:
-- stamped by set_created_by. `id` IS included in the INSERT grant (see
-- migration header note / 20260823120000_work_orders_core.sql's grant-block
-- comment) since this migration's own RLS test explicitly assigns
-- deterministic fixture ids on insert.
grant insert (
  id, work_order_id, user_id, entry_type_id, started_at, ended_at, notes
) on public.time_entries to authenticated;
grant update (
  work_order_id, user_id, entry_type_id, started_at, ended_at, notes
) on public.time_entries to authenticated;

-- ---------------------------------------------------------------------------
-- Reference list: time_entry_type (Labor [default], Travel, Break). Flat (no
-- parent_list_key), extending seed_default_reference_lists per its
-- documented extension pattern rather than a new seeding mechanism.
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
  v_work_order_status_list_id uuid;
  v_work_order_priority_list_id uuid;
  v_contract_type_list_id uuid;
  v_sla_tier_list_id uuid;
  v_billing_terms_list_id uuid;
  v_maintenance_id uuid;
  v_service_id uuid;
  v_installation_id uuid;
  v_warranty_id uuid;
  v_time_entry_type_list_id uuid;
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

  -- contact_role: for contacts.role_item_id. Not a dependent list — flat,
  -- like asset_type/asset_status.
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

  -- asset_subtype: pilot dependent list, parent_list_key = asset_type. Each
  -- item's parent_item_id points at the matching asset_type item just
  -- seeded/looked-up above, in this same organization.
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

  -- work_order_status: for work_orders.status_id. Flat list, ordered
  -- lifecycle: New (default) -> Scheduled -> En Route -> In Progress ->
  -- Completed -> Invoiced.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'work_order_status', 'Work Order Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_work_order_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'work_order_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_work_order_status_list_id, p_organization_id, 'new', 'New', 1, true),
    (v_work_order_status_list_id, p_organization_id, 'scheduled', 'Scheduled', 2, false),
    (v_work_order_status_list_id, p_organization_id, 'en_route', 'En Route', 3, false),
    (v_work_order_status_list_id, p_organization_id, 'in_progress', 'In Progress', 4, false),
    (v_work_order_status_list_id, p_organization_id, 'completed', 'Completed', 5, false),
    (v_work_order_status_list_id, p_organization_id, 'invoiced', 'Invoiced', 6, false)
  on conflict (reference_list_id, value) do nothing;

  -- work_order_priority: for work_orders.priority_id. Flat list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'work_order_priority', 'Work Order Priority')
  on conflict (organization_id, list_key) do nothing;

  select id into v_work_order_priority_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'work_order_priority';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_work_order_priority_list_id, p_organization_id, 'low', 'Low', 1, false),
    (v_work_order_priority_list_id, p_organization_id, 'normal', 'Normal', 2, true),
    (v_work_order_priority_list_id, p_organization_id, 'high', 'High', 3, false),
    (v_work_order_priority_list_id, p_organization_id, 'urgent', 'Urgent', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- contract_type: for contracts.type_id. Flat list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'contract_type', 'Contract Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_contract_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'contract_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_contract_type_list_id, p_organization_id, 'maintenance', 'Maintenance', 1, true),
    (v_contract_type_list_id, p_organization_id, 'service', 'Service', 2, false),
    (v_contract_type_list_id, p_organization_id, 'installation', 'Installation', 3, false),
    (v_contract_type_list_id, p_organization_id, 'warranty', 'Warranty', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- sla_tier: dependent list, parent_list_key = contract_type. A few tiers
  -- per contract type.
  insert into public.reference_lists (organization_id, list_key, name, parent_list_key)
  values (p_organization_id, 'sla_tier', 'SLA Tier', 'contract_type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_sla_tier_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'sla_tier';

  select id into v_maintenance_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'maintenance';
  select id into v_service_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'service';
  select id into v_installation_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'installation';
  select id into v_warranty_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'warranty';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, parent_item_id)
  values
    (v_sla_tier_list_id, p_organization_id, 'maintenance_standard', 'Standard', 1, v_maintenance_id),
    (v_sla_tier_list_id, p_organization_id, 'maintenance_priority', 'Priority', 2, v_maintenance_id),
    (v_sla_tier_list_id, p_organization_id, 'maintenance_premium', 'Premium', 3, v_maintenance_id),
    (v_sla_tier_list_id, p_organization_id, 'service_standard', 'Standard', 4, v_service_id),
    (v_sla_tier_list_id, p_organization_id, 'service_express', 'Express', 5, v_service_id),
    (v_sla_tier_list_id, p_organization_id, 'installation_standard', 'Standard', 6, v_installation_id),
    (v_sla_tier_list_id, p_organization_id, 'installation_expedited', 'Expedited', 7, v_installation_id),
    (v_sla_tier_list_id, p_organization_id, 'warranty_standard', 'Standard', 8, v_warranty_id),
    (v_sla_tier_list_id, p_organization_id, 'warranty_extended', 'Extended', 9, v_warranty_id)
  on conflict (reference_list_id, value) do nothing;

  -- billing_terms: for contracts.billing_terms_id. Flat, standalone list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'billing_terms', 'Billing Terms')
  on conflict (organization_id, list_key) do nothing;

  select id into v_billing_terms_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'billing_terms';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_billing_terms_list_id, p_organization_id, 'monthly', 'Monthly', 1, true),
    (v_billing_terms_list_id, p_organization_id, 'quarterly', 'Quarterly', 2, false),
    (v_billing_terms_list_id, p_organization_id, 'annually', 'Annually', 3, false),
    (v_billing_terms_list_id, p_organization_id, 'per_visit', 'Per-visit', 4, false),
    (v_billing_terms_list_id, p_organization_id, 'one_time', 'One-time', 5, false)
  on conflict (reference_list_id, value) do nothing;

  -- time_entry_type: for time_entries.entry_type_id (issue #15). Flat list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'time_entry_type', 'Time Entry Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_time_entry_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'time_entry_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_time_entry_type_list_id, p_organization_id, 'labor', 'Labor', 1, true),
    (v_time_entry_type_list_id, p_organization_id, 'travel', 'Travel', 2, false),
    (v_time_entry_type_list_id, p_organization_id, 'break', 'Break', 3, false)
  on conflict (reference_list_id, value) do nothing;
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Extended in 20260823180000_time_entries_core.sql with the time_entry_type (flat) block. Future picklists should extend this function the same way, plus a one-time backfill call in that feature''s own migration.';

-- Backfill: seed the new time_entry_type list (and any missing items from
-- earlier blocks) for every organization that already existed before this
-- migration ran — the organizations_seed_reference_lists trigger only fires
-- for future inserts.
do $$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform public.seed_default_reference_lists(r.id);
  end loop;
end;
$$;
