-- Work Orders module: core entity (issue #13, Phase 2 — "Operations core").
-- See docs/ARCHITECTURE.md ("Core schema (v1)", RBAC matrix's `planning`
-- row) and docs/ROADMAP.md ("Phase 2 — Operations core").
--
-- This is the first table where the RBAC matrix's Planner/Engineer split is
-- enforced in RLS itself, not just deferred to the application layer. Every
-- table so far (clients/sites/assets/contacts/reference lists) used the
-- coarse "select = any member, write = is_org_owner only" boundary and
-- explicitly deferred the finer per-role split (see design note 2 in
-- 20260822190000_clients_sites_assets.sql). `lib/rbac/permissions.ts`'s
-- `planning` entry is: owner CRUD, planner CRUD, engineer read_own/
-- update_own (assigned rows only, no create/delete), finance/administratie
-- read-only. That's what this migration's RLS policies implement, for real,
-- at the database layer.
--
-- Design notes (read before extending):
--
-- 1. New reusable helper: `public.current_member_role(org_id uuid) returns
--    membership_role` (SECURITY DEFINER, stable) — the caller's role in that
--    organization, or NULL if they're not a member at all. Generic on
--    purpose: it's what closes Assets' own still-deferred Planner/Engineer
--    RLS split when that's picked up, and what a future Contracts table
--    (Finance CRUD, per the RBAC matrix) should reuse too. Lives alongside
--    `is_member_of_org`/`is_org_owner` (both from the baseline migration) —
--    those answer "is this true", `current_member_role` answers "which role
--    is it", which is what a 3+-way split (owner/planner full, engineer
--    assigned-only, finance/administratie read-only) actually needs instead
--    of stacking more boolean helpers.
--
-- 2. `organization_id` denormalization: same pattern as `sites`/`contacts` —
--    denormalized from `clients.organization_id` via `client_id`
--    (`derive_work_order_organization_id`, mirrors `derive_site_organization_id`,
--    including the cross-org re-parent guard), so RLS stays a single-column
--    `is_member_of_org(organization_id)`/`current_member_role(organization_id)`
--    shape with no in-policy joins.
--
-- 3. Cross-field consistency: `site_id` (if set) must belong to `client_id`;
--    `asset_id` (if set) must belong to `client_id` AND, if `site_id` is
--    also set, to that same `site_id` too. `assigned_to` (if set) must be a
--    member of the work order's own organization. All three are checked by
--    `validate_work_order_relations` — same structural style as
--    `validate_asset_reference_items`/`validate_contact_role_item`
--    (SECURITY DEFINER so it can resolve the referenced rows' real
--    client/site/org regardless of the caller's own RLS visibility).
--
-- 4. `status_id`/`priority_id` are reference-list FKs (not a hardcoded
--    enum), validated by `validate_work_order_reference_items` — same
--    structural style as `validate_asset_reference_items`.
--    `work_order_status`/`work_order_priority` are flat lists (no
--    `parent_list_key`) seeded by extending `seed_default_reference_lists`
--    per its documented extension pattern (see
--    20260822200000_reference_lists.sql design note 2), not a new seeding
--    mechanism. `status_id` defaults to the org's default `work_order_status`
--    item when omitted on insert, folded into the organization-derivation
--    trigger for the same trigger-ordering reason `assets.status_id`'s
--    default was folded into `derive_asset_org_and_client`.
--
-- 5. No `contract_id` column yet — the `contracts` table doesn't exist.
--    Whoever builds Contracts next (Phase 2) should add `contract_id uuid
--    references public.contracts (id)` as a new nullable column on
--    `work_orders` then, not a placeholder FK to nothing now.
--
-- 6. Out of scope for this migration (explicitly, not an oversight): photos/
--    signature capture, checklists/inspection form templates, and time
--    tracking are named alongside Work Orders in docs/ROADMAP.md's Phase 2
--    entry but are their own sub-entities/modules with their own schema —
--    this migration is the core work_orders entity + status/priority
--    lifecycle only, matching the issue #13 scope ("core entity").
--
-- Column-grant lockdown: new table, so the usual "this project's public
-- schema grants ALL to authenticated/anon by default on new tables" gotcha
-- applies — `revoke all` before the explicit grants (see the two
-- `fix_*_column_grants` migrations for why this matters).

-- ---------------------------------------------------------------------------
-- Helper: current_member_role — the caller's role in an organization, or
-- NULL if they have no membership there at all. Reusable by any future
-- table needing a finer-than-boolean RLS split (Assets' deferred
-- Planner/Engineer split, a future Contracts table's Finance CRUD, etc.).
-- ---------------------------------------------------------------------------
create or replace function public.current_member_role(org_id uuid)
returns public.membership_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.memberships m
  where m.organization_id = org_id
    and m.user_id = auth.uid()
  limit 1;
$$;

comment on function public.current_member_role(uuid) is
  'Returns the current auth.uid()''s membership_role in the given organization, or NULL if they have no membership there. SECURITY DEFINER, same reasoning as is_member_of_org/is_org_owner (avoids "infinite recursion detected in policy" and reads memberships regardless of the caller''s own RLS visibility). Use this (not a one-off inline subquery) whenever an RLS policy needs to branch on WHICH role the caller has, not just whether they''re a member/owner.';

revoke all on function public.current_member_role(uuid) from public;
grant execute on function public.current_member_role(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- work_orders: the first-class job/ticket entity. organization_id is
-- denormalized from clients.organization_id via client_id (see design note 2
-- above).
-- ---------------------------------------------------------------------------
create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  site_id uuid references public.sites (id) on delete set null,
  asset_id uuid references public.assets (id) on delete set null,
  assigned_to uuid references public.users (id) on delete set null,
  title text not null,
  description text,
  notes text,
  status_id uuid not null references public.reference_list_items (id),
  priority_id uuid references public.reference_list_items (id),
  scheduled_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.work_orders is
  'The first-class job/ticket entity (previously only implicit inside Planning). organization_id is denormalized from clients.organization_id (via client_id) by derive_work_order_organization_id, same reasoning as sites/contacts. No contract_id column yet — add it as a new nullable column once the contracts table exists (Phase 2), not a placeholder FK now.';
comment on column public.work_orders.organization_id is
  'Denormalized from clients.organization_id (via client_id). Never client-writable — see derive_work_order_organization_id trigger and the column-level grants below.';
comment on column public.work_orders.site_id is
  'Nullable — not every work order is scoped to one specific site. When set, must belong to the same client_id (validated by validate_work_order_relations).';
comment on column public.work_orders.asset_id is
  'Nullable — not every job is about one specific asset. When set, must belong to the same client_id (and the same site_id, if that''s also set) (validated by validate_work_order_relations).';
comment on column public.work_orders.assigned_to is
  'The engineer (or any member) this work order is assigned to. Nullable. When set, must be a member of the work order''s own organization (validated by validate_work_order_relations) — mirrors the cross-org-reference validation style used for reference-list FKs elsewhere (e.g. validate_contact_role_item), applied here to a membership rather than a reference_list_items row. This is also the column the engineer RLS scoping (SELECT/UPDATE "own rows only") is keyed on.';
comment on column public.work_orders.status_id is
  'FK into reference_list_items for this organization''s work_order_status list (New -> Scheduled -> En Route -> In Progress -> Completed -> Invoiced). Not null; defaults to the org''s default work_order_status item when omitted on insert (see derive_work_order_organization_id). Validated by validate_work_order_reference_items.';
comment on column public.work_orders.priority_id is
  'FK into reference_list_items for this organization''s work_order_priority list (Low/Normal/High/Urgent). Nullable. Validated by validate_work_order_reference_items.';

create index work_orders_organization_id_idx on public.work_orders (organization_id);
create index work_orders_client_id_idx on public.work_orders (client_id);
create index work_orders_site_id_idx on public.work_orders (site_id);
create index work_orders_asset_id_idx on public.work_orders (asset_id);
create index work_orders_assigned_to_idx on public.work_orders (assigned_to);
create index work_orders_status_id_idx on public.work_orders (status_id);
create index work_orders_priority_id_idx on public.work_orders (priority_id);
create index work_orders_created_by_idx on public.work_orders (created_by);
create index work_orders_scheduled_at_idx on public.work_orders (scheduled_at);

alter table public.work_orders enable row level security;
alter table public.work_orders force row level security;

-- Derives organization_id from client_id (blocking cross-organization
-- re-parenting, same as derive_site_organization_id), and fills in the
-- organization's default work_order_status item when status_id is omitted
-- on insert — folded into this trigger (not a separate one) for the same
-- trigger-ordering reason assets.status_id's default was folded into
-- derive_asset_org_and_client: organization_id must be known first.
create or replace function public.derive_work_order_organization_id()
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
    raise exception 'work_orders.client_id % does not reference an existing client', new.client_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a work order to a client in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;

  if new.status_id is null then
    select rli.id into new.status_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rl.organization_id = v_org_id
      and rl.list_key = 'work_order_status'
      and rli.is_default
    limit 1;
  end if;

  return new;
end;
$$;

comment on function public.derive_work_order_organization_id() is
  'BEFORE INSERT/UPDATE OF client_id trigger on public.work_orders: sets organization_id from the referenced client, blocks cross-organization re-parenting, and fills in status_id with the organization''s default work_order_status item when the caller omitted it. Runs before validate_work_order_relations/validate_work_order_reference_items (alphabetically earlier trigger name, same timing), so organization_id and status_id are already final by the time those run.';

create trigger work_orders_derive_organization_id
  before insert or update of client_id on public.work_orders
  for each row execute function public.derive_work_order_organization_id();

-- Cross-field consistency: site_id/asset_id must belong to the work order's
-- own client_id (and asset_id to site_id, if both are set); assigned_to
-- must be a member of the work order's own organization. SECURITY DEFINER so
-- it can resolve the referenced sites/assets/memberships rows regardless of
-- the caller's own RLS visibility (mirrors validate_asset_reference_items /
-- validate_contact_role_item's reasoning).
create or replace function public.validate_work_order_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_client_id uuid;
  v_asset_client_id uuid;
  v_asset_site_id uuid;
  v_assigned_is_member boolean;
begin
  if new.site_id is not null then
    select s.client_id into v_site_client_id
    from public.sites s
    where s.id = new.site_id;

    if v_site_client_id is null then
      raise exception 'work_orders.site_id % does not reference an existing site', new.site_id
        using errcode = '23503';
    elsif v_site_client_id <> new.client_id then
      raise exception 'work_orders.site_id must belong to the same client as the work order'
        using errcode = '23514';
    end if;
  end if;

  if new.asset_id is not null then
    select a.client_id, a.site_id into v_asset_client_id, v_asset_site_id
    from public.assets a
    where a.id = new.asset_id;

    if v_asset_client_id is null then
      raise exception 'work_orders.asset_id % does not reference an existing asset', new.asset_id
        using errcode = '23503';
    elsif v_asset_client_id <> new.client_id then
      raise exception 'work_orders.asset_id must belong to the same client as the work order'
        using errcode = '23514';
    elsif new.site_id is not null and v_asset_site_id <> new.site_id then
      raise exception 'work_orders.asset_id must belong to the same site as the work order (when site_id is set)'
        using errcode = '23514';
    end if;
  end if;

  if new.assigned_to is not null then
    select exists (
      select 1
      from public.memberships m
      where m.user_id = new.assigned_to
        and m.organization_id = new.organization_id
    ) into v_assigned_is_member;

    if not v_assigned_is_member then
      raise exception 'work_orders.assigned_to must be a member of the same organization as the work order'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_work_order_relations() is
  'BEFORE INSERT/UPDATE OF client_id, site_id, asset_id, assigned_to trigger on public.work_orders: rejects a site_id/asset_id from a different client than the work order''s own client_id, an asset_id from a different site than the work order''s own site_id (when both are set), and an assigned_to user who is not a member of the work order''s own organization. Runs after derive_work_order_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger work_orders_validate_relations
  before insert or update of client_id, site_id, asset_id, assigned_to on public.work_orders
  for each row execute function public.validate_work_order_relations();

-- Validates that status_id/priority_id point at an item from the correct
-- list_key, in the work order's own organization. Same structural style as
-- validate_asset_reference_items.
create or replace function public.validate_work_order_reference_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_org uuid;
  v_status_key text;
  v_priority_org uuid;
  v_priority_key text;
begin
  if new.status_id is not null then
    select rl.organization_id, rl.list_key into v_status_org, v_status_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.status_id;

    if v_status_org is null then
      raise exception 'work_orders.status_id % does not reference an existing reference_list_items row', new.status_id
        using errcode = '23503';
    elsif v_status_key <> 'work_order_status' then
      raise exception 'work_orders.status_id must reference an item from the work_order_status reference list (got list_key=%)', v_status_key
        using errcode = '23514';
    elsif v_status_org <> new.organization_id then
      raise exception 'work_orders.status_id must belong to the same organization as the work order'
        using errcode = '23514';
    end if;
  end if;

  if new.priority_id is not null then
    select rl.organization_id, rl.list_key into v_priority_org, v_priority_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.priority_id;

    if v_priority_org is null then
      raise exception 'work_orders.priority_id % does not reference an existing reference_list_items row', new.priority_id
        using errcode = '23503';
    elsif v_priority_key <> 'work_order_priority' then
      raise exception 'work_orders.priority_id must reference an item from the work_order_priority reference list (got list_key=%)', v_priority_key
        using errcode = '23514';
    elsif v_priority_org <> new.organization_id then
      raise exception 'work_orders.priority_id must belong to the same organization as the work order'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_work_order_reference_items() is
  'BEFORE INSERT/UPDATE OF status_id, priority_id trigger on public.work_orders: rejects an item from the wrong list_key or a different organization''s reference list. Runs after derive_work_order_organization_id (alphabetically later trigger name, same timing), so new.organization_id (and the default-filled status_id) are already final.';

create trigger work_orders_validate_reference_items
  before insert or update of status_id, priority_id on public.work_orders
  for each row execute function public.validate_work_order_reference_items();

create trigger work_orders_set_created_by
  before insert on public.work_orders
  for each row execute function public.set_created_by();

create trigger work_orders_set_updated_at
  before update on public.work_orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies: work_orders — the RBAC matrix's `planning` row, enforced for
-- real (see migration header):
--   owner:         CRUD, all rows
--   planner:       CRUD, all rows
--   engineer:      SELECT/UPDATE only rows where assigned_to = auth.uid();
--                  no INSERT, no DELETE
--   finance/administratie: SELECT only, all rows
-- ---------------------------------------------------------------------------

-- SELECT: any member, EXCEPT an engineer, who only sees rows assigned to them.
create policy "work_orders_select_scoped"
on public.work_orders
for select
to authenticated
using (
  public.is_member_of_org(organization_id)
  and (
    public.current_member_role(organization_id) <> 'engineer'
    or assigned_to = auth.uid()
  )
);

-- INSERT: owner/planner only (engineer has no create action in the matrix).
create policy "work_orders_insert_owner_or_planner"
on public.work_orders
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

-- UPDATE: owner/planner any row; engineer only their own assigned row.
create policy "work_orders_update_scoped"
on public.work_orders
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and assigned_to = auth.uid()
  )
)
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and assigned_to = auth.uid()
  )
);

-- DELETE: owner/planner only (engineer has no delete action in the matrix).
create policy "work_orders_delete_owner_or_planner"
on public.work_orders
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.work_orders from authenticated;

grant select, delete on public.work_orders to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_work_order_organization_id. created_by intentionally excluded:
-- stamped by set_created_by.
--
-- `id` IS included here (unlike the INSERT column-list on clients/sites/
-- assets/contacts/reference_lists/invites, which all omit it): per Postgres
-- docs (https://www.postgresql.org/docs/current/ddl-priv.html), a column
-- explicitly listed in an INSERT's target list requires INSERT privilege on
-- that specific column even if the supplied value happens to match what its
-- DEFAULT would produce — only columns OMITTED from the INSERT statement
-- fall back to their default without needing any privilege. Since every RLS
-- test file in this codebase (including this migration's own
-- work_orders_rls.test.sql) explicitly assigns `id` on insert for
-- deterministic fixture IDs to reference later in the same test, and since
-- `id` is an opaque random-default uuid (no security exposure in letting a
-- caller choose a legal-but-arbitrary uuid for a row they're otherwise
-- already authorized to create), granting it here is both safe and
-- necessary for those tests to actually pass under `authenticated` rather
-- than only appearing to work because of table-owner/superuser privilege in
-- a local psql session. Flagged for qa-reviewer: the other tables' INSERT
-- grants (clients/sites/assets/contacts/reference_lists/invites) all
-- likewise omit `id` while their own RLS test files also explicitly insert
-- one — that combination has never actually been exercised against a real
-- Postgres (this project's CI has no `supabase test db` step; see
-- .github/workflows/ci.yml), so it's worth verifying with a real
-- `supabase test db` run whether those pre-existing tests still pass, and
-- extending their INSERT grants the same way if not. Not fixed here since
-- that spans five other migrations outside this task's scope.
grant insert (
  id, client_id, site_id, asset_id, assigned_to, title, description, notes,
  status_id, priority_id, scheduled_at, completed_at
) on public.work_orders to authenticated;
grant update (
  client_id, site_id, asset_id, assigned_to, title, description, notes,
  status_id, priority_id, scheduled_at, completed_at
) on public.work_orders to authenticated;

-- ---------------------------------------------------------------------------
-- Reference lists: work_order_status (lifecycle) and work_order_priority.
-- Both flat (no parent_list_key), extending seed_default_reference_lists per
-- its documented extension pattern (20260822200000_reference_lists.sql
-- design note 2) rather than a new seeding mechanism.
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

  -- work_order_status: for work_orders.status_id (issue #13). Flat list,
  -- ordered lifecycle per docs/BUSINESS-PLAN.md / docs/ROADMAP.md: New
  -- (default) -> Scheduled -> En Route -> In Progress -> Completed -> Invoiced.
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
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Extended in 20260823120000_work_orders_core.sql with work_order_status (flat, ordered lifecycle) and work_order_priority (flat) blocks. Future picklists should extend this function the same way, plus a one-time backfill call in that feature''s own migration.';

-- Backfill: seed the new work_order_status/work_order_priority lists (and
-- any missing items from earlier blocks) for every organization that
-- already existed before this migration ran — the
-- organizations_seed_reference_lists trigger only fires for future inserts.
do $$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform public.seed_default_reference_lists(r.id);
  end loop;
end;
$$;
