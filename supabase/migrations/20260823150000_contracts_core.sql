-- Contracts module: core entity + linked assets + SLA tier (issue #33,
-- Phase 2). See docs/ARCHITECTURE.md ("Core schema (v1)" contracts
-- placeholder, RBAC matrix's `contracts` row) and
-- lib/rbac/permissions.ts's `contracts` entry.
--
-- This is the SECOND table (after work_orders,
-- 20260823120000_work_orders_core.sql) whose RBAC matrix row needs real
-- per-role RLS via `current_member_role`, but a NEW shape: TWO roles
-- (owner AND finance) both get full CRUD, planner/engineer/administratie are
-- read-only. Reuses `current_member_role(org_id)` exactly for the
-- reusability it was built for — no new helper needed.
--
-- Design notes (read before extending):
--
-- 1. `organization_id` denormalization: same pattern as `sites`/`contacts`/
--    `work_orders` — denormalized from `clients.organization_id` via
--    `client_id` (`derive_contract_organization_id`), so RLS stays a
--    single-column `is_member_of_org(organization_id)`/
--    `current_member_role(organization_id)` shape with no in-policy joins.
--    The same trigger also fills in the organization's default
--    `contract_type` item when `type_id` is omitted on insert (folded in for
--    the same trigger-ordering reason `work_orders.status_id`'s default was
--    folded into `derive_work_order_organization_id`: organization_id must
--    be known first).
--
-- 2. `sla_tier_id` is a SECOND pilot of the generic dependent-reference-list
--    mechanism (`reference_lists.parent_list_key` / `parent_item_id`,
--    20260823090000_contacts_dependent_reference_lists.sql) — exactly the
--    example docs/ARCHITECTURE.md already named as "the next dependent
--    list": `sla_tier` depends on `contract_type`. The list-level dependency
--    (parent belongs to the right list_key, same org) is already enforced
--    generically by `validate_reference_list_item_parent`; what's new here
--    is the cross-field check on `contracts` itself — `sla_tier_id`'s
--    `parent_item_id` must equal the contract's own `type_id` — mirroring
--    `validate_asset_reference_items`'s `subtype_id`/`type_id` check exactly,
--    just for a different pair of columns/tables. `billing_terms_id` is a
--    third, independent, non-dependent reference list (flat, like
--    `asset_type`/`work_order_status`).
--
-- 3. `contract_assets` is the first genuine many-to-many join table in this
--    schema (everything so far is one-to-many via denormalized
--    organization_id). No surrogate `id` — the natural key
--    `(contract_id, asset_id)` is the primary key, which also satisfies the
--    "unique (contract_id, asset_id)" requirement without a separate index.
--    `organization_id` is denormalized from the contract (not the asset) —
--    both must resolve to the same org, and additionally the asset's
--    `client_id` must match the contract's own `client_id` (you can't link
--    an asset from a different client onto this contract), checked by
--    `validate_contract_asset_relations`. No UPDATE is supported (delete +
--    re-insert to change either side of the link) — no UPDATE policy, no
--    UPDATE column grants; both triggers are BEFORE INSERT only.
--
-- 4. RLS write boundary for both `contracts` and `contract_assets`: owner OR
--    finance (`current_member_role(organization_id) in ('owner','finance')`)
--    for INSERT/UPDATE/DELETE; any member for SELECT. "If you can manage the
--    contract, you can manage its asset links" — same boundary on both
--    tables.
--
-- 5. `work_orders.contract_id` — deferred from the Work Orders migration
--    (design note 5 there) for exactly this. Nullable FK, added here as a
--    plain additive column (ALTER TABLE ADD COLUMN doesn't inherit the
--    "revoke all on new tables" gotcha — ADD COLUMN grants must still be
--    explicit but don't need the `revoke all` step since it's an existing,
--    already-locked-down table). `validate_work_order_relations` is
--    extended (CREATE OR REPLACE, not a parallel trigger) to check
--    `contract_id` belongs to the same `client_id` as the work order —
--    same cross-field spirit as the existing site_id/asset_id checks.
--
-- Column-grant lockdown: `contracts`/`contract_assets` are new tables, so
-- the usual "this project's public schema grants ALL to authenticated/anon
-- by default on new tables" gotcha applies — `revoke all` before the
-- explicit grants (see the two `fix_*_column_grants` migrations for why this
-- matters). `id` is included in `contracts`' INSERT grant (not omitted, like
-- the pre-work_orders tables) per the reasoning documented in
-- 20260823120000_work_orders_core.sql's grant block: this migration's own
-- RLS test explicitly assigns deterministic fixture ids on insert.

-- ---------------------------------------------------------------------------
-- contracts: the core entity. organization_id is denormalized from
-- clients.organization_id via client_id (see design note 1 above).
-- ---------------------------------------------------------------------------
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  type_id uuid not null references public.reference_list_items (id),
  sla_tier_id uuid references public.reference_list_items (id),
  billing_terms_id uuid references public.reference_list_items (id),
  start_date date not null,
  end_date date,
  auto_renew boolean not null default false,
  value numeric(12, 2),
  notes text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contracts_end_date_after_start_date check (end_date is null or end_date >= start_date)
);

comment on table public.contracts is
  'A business agreement with a client (service contract/maintenance agreement). organization_id is denormalized from clients.organization_id (via client_id) by derive_contract_organization_id, same reasoning as sites/contacts/work_orders. type_id/sla_tier_id/billing_terms_id are reference-list FKs, not hardcoded enums, per docs/ARCHITECTURE.md "Domain completeness". sla_tier_id is a dependent list (parent_list_key=contract_type on the sla_tier list) — its parent_item_id must equal this contract''s own type_id (validated by validate_contract_reference_items).';
comment on column public.contracts.organization_id is
  'Denormalized from clients.organization_id (via client_id). Never client-writable — see derive_contract_organization_id trigger and the column-level grants below.';
comment on column public.contracts.name is
  'Human-readable contract name/number (e.g. "2026 HVAC Maintenance Agreement" or a contract number) — not auto-generated.';
comment on column public.contracts.type_id is
  'FK into reference_list_items for this organization''s contract_type list (Maintenance/Service/Installation/Warranty). Not null; defaults to the org''s default contract_type item when omitted on insert (see derive_contract_organization_id). Validated by validate_contract_reference_items.';
comment on column public.contracts.sla_tier_id is
  'FK into reference_list_items for this organization''s sla_tier list. Nullable. sla_tier is a DEPENDENT list (reference_lists.parent_list_key=''contract_type''): the item''s own parent_item_id must equal this contract''s type_id, validated by validate_contract_reference_items (same cross-field pattern as assets.subtype_id/type_id).';
comment on column public.contracts.billing_terms_id is
  'FK into reference_list_items for this organization''s billing_terms list (Monthly/Quarterly/Annually/Per-visit/One-time). Nullable, standalone (not a dependent list). Validated by validate_contract_reference_items.';
comment on column public.contracts.end_date is
  'Nullable — open-ended contracts are real (no fixed end). When set, must be >= start_date (contracts_end_date_after_start_date check constraint).';
comment on column public.contracts.value is
  'Contract value (e.g. annual price), nullable. numeric(12,2) — same precision as everywhere else money is stored in this schema.';

create index contracts_organization_id_idx on public.contracts (organization_id);
create index contracts_client_id_idx on public.contracts (client_id);
create index contracts_type_id_idx on public.contracts (type_id);
create index contracts_sla_tier_id_idx on public.contracts (sla_tier_id);
create index contracts_billing_terms_id_idx on public.contracts (billing_terms_id);
create index contracts_created_by_idx on public.contracts (created_by);
create index contracts_start_date_idx on public.contracts (start_date);
create index contracts_end_date_idx on public.contracts (end_date);

alter table public.contracts enable row level security;
alter table public.contracts force row level security;

-- Derives organization_id from client_id (blocking cross-organization
-- re-parenting, same as derive_work_order_organization_id), and fills in the
-- organization's default contract_type item when type_id is omitted on
-- insert — folded into this trigger for the same trigger-ordering reason
-- work_orders.status_id's default was folded into
-- derive_work_order_organization_id: organization_id must be known first.
create or replace function public.derive_contract_organization_id()
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
    raise exception 'contracts.client_id % does not reference an existing client', new.client_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a contract to a client in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;

  if new.type_id is null then
    select rli.id into new.type_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rl.organization_id = v_org_id
      and rl.list_key = 'contract_type'
      and rli.is_default
    limit 1;
  end if;

  return new;
end;
$$;

comment on function public.derive_contract_organization_id() is
  'BEFORE INSERT/UPDATE OF client_id trigger on public.contracts: sets organization_id from the referenced client, blocks cross-organization re-parenting, and fills in type_id with the organization''s default contract_type item when the caller omitted it. Runs before validate_contract_reference_items (alphabetically earlier trigger name, same timing), so organization_id and type_id are already final by the time that runs.';

create trigger contracts_derive_organization_id
  before insert or update of client_id on public.contracts
  for each row execute function public.derive_contract_organization_id();

-- Validates that type_id/sla_tier_id/billing_terms_id point at an item from
-- the correct list_key, in the contract's own organization, AND that
-- sla_tier_id's parent_item_id (the dependent-list linkage) equals this
-- contract's own type_id. Same structural style as
-- validate_asset_reference_items's type_id/status_id/subtype_id checks.
create or replace function public.validate_contract_reference_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type_org uuid;
  v_type_key text;
  v_sla_org uuid;
  v_sla_key text;
  v_sla_parent_item_id uuid;
  v_billing_org uuid;
  v_billing_key text;
begin
  if new.type_id is not null then
    select rl.organization_id, rl.list_key into v_type_org, v_type_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.type_id;

    if v_type_org is null then
      raise exception 'contracts.type_id % does not reference an existing reference_list_items row', new.type_id
        using errcode = '23503';
    elsif v_type_key <> 'contract_type' then
      raise exception 'contracts.type_id must reference an item from the contract_type reference list (got list_key=%)', v_type_key
        using errcode = '23514';
    elsif v_type_org <> new.organization_id then
      raise exception 'contracts.type_id must belong to the same organization as the contract'
        using errcode = '23514';
    end if;
  end if;

  if new.sla_tier_id is not null then
    select rl.organization_id, rl.list_key, rli.parent_item_id
    into v_sla_org, v_sla_key, v_sla_parent_item_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.sla_tier_id;

    if v_sla_org is null then
      raise exception 'contracts.sla_tier_id % does not reference an existing reference_list_items row', new.sla_tier_id
        using errcode = '23503';
    elsif v_sla_key <> 'sla_tier' then
      raise exception 'contracts.sla_tier_id must reference an item from the sla_tier reference list (got list_key=%)', v_sla_key
        using errcode = '23514';
    elsif v_sla_org <> new.organization_id then
      raise exception 'contracts.sla_tier_id must belong to the same organization as the contract'
        using errcode = '23514';
    elsif new.type_id is null or v_sla_parent_item_id is distinct from new.type_id then
      raise exception 'contracts.sla_tier_id must be a tier of the contract''s own type_id (the sla_tier item''s parent_item_id must equal contracts.type_id)'
        using errcode = '23514';
    end if;
  end if;

  if new.billing_terms_id is not null then
    select rl.organization_id, rl.list_key into v_billing_org, v_billing_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.billing_terms_id;

    if v_billing_org is null then
      raise exception 'contracts.billing_terms_id % does not reference an existing reference_list_items row', new.billing_terms_id
        using errcode = '23503';
    elsif v_billing_key <> 'billing_terms' then
      raise exception 'contracts.billing_terms_id must reference an item from the billing_terms reference list (got list_key=%)', v_billing_key
        using errcode = '23514';
    elsif v_billing_org <> new.organization_id then
      raise exception 'contracts.billing_terms_id must belong to the same organization as the contract'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_contract_reference_items() is
  'BEFORE INSERT/UPDATE OF type_id, sla_tier_id, billing_terms_id trigger on public.contracts: rejects an item from the wrong list_key or a different organization''s reference list (all three columns alike), and additionally rejects an sla_tier_id whose parent_item_id does not match the contract''s own type_id — the cross-field dependency check that the generic reference_list_items-level trigger (validate_reference_list_item_parent) cannot express on its own. Mirrors validate_asset_reference_items''s subtype_id/type_id check. Runs after contracts_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id (and the default-filled type_id) are already final.';

create trigger contracts_validate_reference_items
  before insert or update of type_id, sla_tier_id, billing_terms_id on public.contracts
  for each row execute function public.validate_contract_reference_items();

create trigger contracts_set_created_by
  before insert on public.contracts
  for each row execute function public.set_created_by();

create trigger contracts_set_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies: contracts — the RBAC matrix's `contracts` row
-- (lib/rbac/permissions.ts):
--   owner:   CRUD, all rows
--   finance: CRUD, all rows
--   planner/engineer/administratie: SELECT only, all rows
-- ---------------------------------------------------------------------------

create policy "contracts_select_member"
on public.contracts
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "contracts_insert_owner_or_finance"
on public.contracts
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

create policy "contracts_update_owner_or_finance"
on public.contracts
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'finance')
)
with check (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

create policy "contracts_delete_owner_or_finance"
on public.contracts
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.contracts from authenticated;

grant select, delete on public.contracts to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_contract_organization_id. created_by intentionally excluded:
-- stamped by set_created_by. `id` IS included in the INSERT grant (see
-- migration header note 5 / the work_orders migration's grant-block
-- comment) since this migration's own RLS test explicitly assigns
-- deterministic fixture ids on insert.
grant insert (
  id, client_id, name, type_id, sla_tier_id, billing_terms_id,
  start_date, end_date, auto_renew, value, notes
) on public.contracts to authenticated;
grant update (
  client_id, name, type_id, sla_tier_id, billing_terms_id,
  start_date, end_date, auto_renew, value, notes
) on public.contracts to authenticated;

-- ---------------------------------------------------------------------------
-- contract_assets: many-to-many join between contracts and assets — the
-- first genuine many-to-many table in this schema (see design note 3 above).
-- organization_id is denormalized from the CONTRACT (not the asset); the
-- asset's own client_id must additionally match the contract's client_id
-- (validate_contract_asset_relations). No UPDATE support (delete + re-insert
-- to change either side).
-- ---------------------------------------------------------------------------
create table public.contract_assets (
  contract_id uuid not null references public.contracts (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (contract_id, asset_id)
);

comment on table public.contract_assets is
  'Many-to-many link between a contract and the assets it covers. The first genuine many-to-many join table in this schema (everything else so far is one-to-many via a denormalized organization_id). Primary key is the natural key (contract_id, asset_id) — also satisfies "unique per pair" without a separate index. organization_id is denormalized from the CONTRACT''s organization_id (via contract_id) by derive_contract_asset_organization_id; the linked asset must additionally resolve to the SAME organization AND the same client_id as the contract (validated by validate_contract_asset_relations) — you cannot link an asset from a different client onto this contract. No UPDATE is supported: to change either side of a link, delete the row and insert a new one.';
comment on column public.contract_assets.organization_id is
  'Denormalized from contracts.organization_id (via contract_id). Never client-writable — see derive_contract_asset_organization_id trigger and the column-level grants below.';

create index contract_assets_organization_id_idx on public.contract_assets (organization_id);
create index contract_assets_asset_id_idx on public.contract_assets (asset_id);
create index contract_assets_created_by_idx on public.contract_assets (created_by);

alter table public.contract_assets enable row level security;
alter table public.contract_assets force row level security;

-- Derives organization_id from contract_id. INSERT-only (no UPDATE support
-- on this table at all — see design note 3), so this only ever needs to run
-- on INSERT.
create or replace function public.derive_contract_asset_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select c.organization_id into v_org_id
  from public.contracts c
  where c.id = new.contract_id;

  if v_org_id is null then
    raise exception 'contract_assets.contract_id % does not reference an existing contract', new.contract_id
      using errcode = '23503';
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_contract_asset_organization_id() is
  'BEFORE INSERT trigger on public.contract_assets: sets organization_id from the referenced contract. No UPDATE branch needed — this table has no UPDATE grant/policy at all (see migration header design note 3).';

create trigger contract_assets_derive_organization_id
  before insert on public.contract_assets
  for each row execute function public.derive_contract_asset_organization_id();

-- Cross-field consistency: the linked asset must resolve to the SAME
-- organization as the contract (defense in depth — RLS already scopes both
-- sides to the caller's own org, but a hostile/buggy caller could otherwise
-- point at a same-org contract and a same-org asset from a DIFFERENT client)
-- AND to the SAME client_id as the contract. SECURITY DEFINER so it can
-- resolve the referenced contract/asset rows regardless of the caller's own
-- RLS visibility (mirrors validate_work_order_relations's reasoning).
create or replace function public.validate_contract_asset_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract_client_id uuid;
  v_asset_org_id uuid;
  v_asset_client_id uuid;
begin
  select client_id into v_contract_client_id
  from public.contracts
  where id = new.contract_id;

  select organization_id, client_id into v_asset_org_id, v_asset_client_id
  from public.assets
  where id = new.asset_id;

  if v_asset_org_id is null then
    raise exception 'contract_assets.asset_id % does not reference an existing asset', new.asset_id
      using errcode = '23503';
  elsif v_asset_org_id <> new.organization_id then
    raise exception 'contract_assets.asset_id must belong to the same organization as the contract'
      using errcode = '23514';
  elsif v_asset_client_id <> v_contract_client_id then
    raise exception 'contract_assets.asset_id must belong to the same client as the contract (the asset''s client_id must match contracts.client_id)'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_contract_asset_relations() is
  'BEFORE INSERT trigger on public.contract_assets: rejects an asset_id from a different organization than the contract, or from a different client than the contract''s own client_id. Runs after contract_assets_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger contract_assets_validate_relations
  before insert on public.contract_assets
  for each row execute function public.validate_contract_asset_relations();

create trigger contract_assets_set_created_by
  before insert on public.contract_assets
  for each row execute function public.set_created_by();

-- ---------------------------------------------------------------------------
-- RLS policies: contract_assets — same owner-or-finance write boundary as
-- contracts itself ("if you can manage the contract, you can manage its
-- asset links"). No UPDATE policy: this table has no UPDATE grant at all.
-- ---------------------------------------------------------------------------

create policy "contract_assets_select_member"
on public.contract_assets
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "contract_assets_insert_owner_or_finance"
on public.contract_assets
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

create policy "contract_assets_delete_owner_or_finance"
on public.contract_assets
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'finance')
);

-- New table: revoke-all-then-grant-back, same as every other new table here.
revoke all on public.contract_assets from authenticated;

grant select, delete on public.contract_assets to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_contract_asset_organization_id. created_by intentionally excluded:
-- stamped by set_created_by. No UPDATE grant at all (see design note 3).
grant insert (contract_id, asset_id) on public.contract_assets to authenticated;

-- ---------------------------------------------------------------------------
-- work_orders.contract_id: deferred from 20260823120000_work_orders_core.sql
-- (design note 5 there) for exactly this. Plain additive column grant on an
-- existing, already-locked-down table — ALTER TABLE ADD COLUMN doesn't
-- inherit the "revoke all on new tables" gotcha (same non-issue as
-- assets.type_id/status_id before it).
-- ---------------------------------------------------------------------------
alter table public.work_orders
  add column contract_id uuid references public.contracts (id) on delete set null;

comment on column public.work_orders.contract_id is
  'Nullable FK into contracts — the contract this work order is being performed under, if any. When set, must belong to the same client_id as the work order (validated by validate_work_order_relations, same cross-field spirit as the existing site_id/asset_id checks).';

create index work_orders_contract_id_idx on public.work_orders (contract_id);

-- Extend (CREATE OR REPLACE, not a parallel trigger) validate_work_order_relations
-- with the contract_id <-> client_id cross-field check, and widen the
-- trigger's column list to include contract_id.
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
  v_contract_client_id uuid;
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

  if new.contract_id is not null then
    select client_id into v_contract_client_id
    from public.contracts
    where id = new.contract_id;

    if v_contract_client_id is null then
      raise exception 'work_orders.contract_id % does not reference an existing contract', new.contract_id
        using errcode = '23503';
    elsif v_contract_client_id <> new.client_id then
      raise exception 'work_orders.contract_id must belong to the same client as the work order'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_work_order_relations() is
  'BEFORE INSERT/UPDATE OF client_id, site_id, asset_id, assigned_to, contract_id trigger on public.work_orders: rejects a site_id/asset_id/contract_id from a different client than the work order''s own client_id, an asset_id from a different site than the work order''s own site_id (when both are set), and an assigned_to user who is not a member of the work order''s own organization. Extended in 20260823150000_contracts_core.sql with the contract_id check. Runs after derive_work_order_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

drop trigger if exists work_orders_validate_relations on public.work_orders;

create trigger work_orders_validate_relations
  before insert or update of client_id, site_id, asset_id, assigned_to, contract_id on public.work_orders
  for each row execute function public.validate_work_order_relations();

grant insert (contract_id) on public.work_orders to authenticated;
grant update (contract_id) on public.work_orders to authenticated;

-- ---------------------------------------------------------------------------
-- Reference lists: contract_type, sla_tier (DEPENDENT on contract_type —
-- the "next dependent list" docs/ARCHITECTURE.md already named), and
-- billing_terms (flat, standalone). Extending seed_default_reference_lists
-- per its documented extension pattern rather than a new seeding mechanism.
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

  -- contract_type: for contracts.type_id (issue #33). Flat list.
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

  -- sla_tier: SECOND pilot of the dependent-list mechanism (issue #33),
  -- parent_list_key = contract_type. A few tiers per contract type. `value`
  -- must be unique per LIST (not per parent group), so each item's slug is
  -- prefixed with its parent type even though several share the same
  -- display label ("Standard"). No item is marked is_default here:
  -- is_default is enforced at most-one-per-LIST (not per parent group,
  -- see enforce_single_default_reference_item), which doesn't map cleanly
  -- onto "one default tier per contract type" — sla_tier_id stays a plain
  -- nullable pick with no auto-fill, unlike contracts.type_id.
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

  -- billing_terms: for contracts.billing_terms_id. Flat, standalone list
  -- (not dependent on contract_type).
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
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Extended in 20260823150000_contracts_core.sql with contract_type (flat), sla_tier (SECOND pilot dependent list, parent_list_key=contract_type), and billing_terms (flat) blocks. Future picklists should extend this function the same way, plus a one-time backfill call in that feature''s own migration.';

-- Backfill: seed the new contract_type/sla_tier/billing_terms lists (and any
-- missing items from earlier blocks) for every organization that already
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
