-- Issue #274: an asset never moves to another client. It is made INACTIVE
-- (tenant-configurable flag on asset_status items) and a successor asset is
-- created at the new client (previous_asset_id); serial numbers are unique per
-- organization + model among assets in use; removing an asset from an Active
-- contract keeps the link as history (removed_on) and requires a closing
-- reading per counter. Builds on #269/#270/#271 (contract_covered_assets,
-- complete_contract_end) and #273 (sites.client_id immutable).
--
-- Design notes:
--
-- 1. reference_list_items.is_inactive is a generic boolean attribute (same
--    precedent as planning_default: no cross-list refusal) that only has a
--    meaning for the asset_status list. Backfilled true for every
--    'decommissioned' item; seeded true for new organizations.
-- 2. assets.is_inactive is a denormalized, never client-writable copy of the
--    status item's flag (a partial unique index can only look at its own row).
--    Maintained by assets_sync_is_inactive (BEFORE INSERT/UPDATE OF status_id)
--    and by an AFTER UPDATE OF is_inactive trigger on reference_list_items.
--    Switching a status back to "in use" can hit the serial unique index; that
--    surfaces as 23505 with a clear message. Making a status inactive while
--    assets of that status sit on a Draft/Active contract is refused by the
--    guard below (23514).
-- 3. Inactive guard (assets_validate_inactive_contracts, BEFORE UPDATE): the
--    flag may only go false -> true when neither the asset nor any
--    asset_components descendant has an open (removed_on is null) contract_assets
--    row on a draft or active contract. The trigger name sorts AFTER
--    assets_sync_is_inactive on purpose (same-timing triggers fire in name
--    order, the guard needs the synced value). NEW links to an inactive asset
--    are refused on contract_assets (validate_contract_asset_relations),
--    work_orders.asset_id, activities.asset_id and
--    asset_components.component_asset_id (generic reject_inactive_asset_link,
--    only on insert / when the column changes, so existing rows stay valid).
--    quote_line_items.asset_id is deliberately NOT guarded: auto-draft quote
--    sync inserts lines for the work order's existing asset, which may have
--    become inactive since; guarding it would block completing history.
--    Grandfathering: pre-existing inactive assets on open contracts (none in
--    production today) are not touched by this migration.
-- 4. assets' client is immutable: derive_asset_org_and_client (latest body
--    20260822200000) raises 23514 on UPDATE when the new site belongs to
--    another client. Moving to another site of the same client stays allowed.
-- 5. assets.previous_asset_id (successor link): on delete set null; same
--    organization, not self, no cycle, previous asset must be inactive (checked
--    only when the column changes); unique partial index = at most one
--    successor per asset.
-- 6. Unique serial per (organization, model, lower(btrim(serial))) among
--    assets that are not inactive; the migration refuses to run while such
--    duplicates exist and lists them.
-- 7. contract_assets: surrogate id PK, partial unique (contract_id, asset_id)
--    where removed_on is null (an asset can be added again after removal as a
--    new coverage row), removed_on (LAST covered day, inclusive) / removed_at /
--    removed_by (not client-writable). Direct DELETE of a link on a non-draft
--    contract is refused (guard trigger); removal goes through the SECURITY
--    DEFINER RPC remove_contract_asset (owner/finance, like the table policies):
--    draft = plain delete, ended = refused, active = removed_on + REQUIRED
--    closing reading per counter on that date.
-- 8. contract_covered_assets returns one row per coverage WINDOW (adds
--    coverage_end + contract_asset_id; removed windows stay so settlement can
--    count them up to coverage_end). The baseline check only looks at open
--    windows. Helper asset_covered_by_contract_on(contract, asset, date) says
--    whether a work order dated <date> is still covered (open window, or date
--    <= removed_on); the DB itself never resolves coverage per work-order asset
--    (work_orders.contract_id is chosen by the app), so the app uses this helper.
--
-- NOTE: writes reference data directly (is_inactive backfill + seed) ->
-- REFERENCE_DATA_CACHE_VERSION in lib/cache/reference-data.ts is bumped in the
-- same change.

-- ===========================================================================
-- A. reference_list_items.is_inactive
-- ===========================================================================
alter table public.reference_list_items
  add column is_inactive boolean not null default false;

comment on column public.reference_list_items.is_inactive is
  'Generic optional per-item flag, only meaningful for the asset_status list (issue #274): an asset with an inactive status is out of use (hidden from pickers, frees its serial number, cannot be on a Draft/Active contract). Defaults to false; true for the seeded Decommissioned status.';

revoke all on public.reference_list_items from authenticated;
grant select, delete on public.reference_list_items to authenticated;
grant insert (
  reference_list_id, value, label, color, icon, sort_order, is_default,
  parent_item_id, description, is_active, default_duration_minutes,
  interval_months, planning_default, is_inactive
) on public.reference_list_items to authenticated;
grant update (
  value, label, color, icon, sort_order, is_default, parent_item_id,
  description, is_active, default_duration_minutes, interval_months,
  planning_default, is_inactive
) on public.reference_list_items to authenticated;

update public.reference_list_items i
set is_inactive = true
from public.reference_lists rl
where rl.id = i.reference_list_id
  and rl.list_key = 'asset_status'
  and i.value = 'decommissioned';

-- ===========================================================================
-- B. assets.is_inactive (denormalized) + previous_asset_id
-- ===========================================================================
alter table public.assets
  add column is_inactive boolean not null default false,
  add column previous_asset_id uuid references public.assets (id) on delete set null;

comment on column public.assets.is_inactive is
  'Denormalized from the status item''s is_inactive flag (issue #274), kept in sync by assets_sync_is_inactive / the reference_list_items resync trigger. Never client-writable. Inactive assets are out of use: hidden from pickers, excluded from the unique serial index, never on a Draft/Active contract.';
comment on column public.assets.previous_asset_id is
  'Successor link (issue #274): the inactive asset this asset replaces, typically at another client (an asset never changes client). Same organization, not self, must be inactive; at most one successor per asset (unique partial index). ON DELETE SET NULL.';

-- Backfill (before the triggers exist; updated_at is left alone).
alter table public.assets disable trigger assets_set_updated_at;
update public.assets a
set is_inactive = true
from public.reference_list_items i
where i.id = a.status_id and i.is_inactive and not a.is_inactive;
alter table public.assets enable trigger assets_set_updated_at;

create or replace function public.sync_asset_is_inactive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.is_inactive := coalesce(
    (select i.is_inactive from public.reference_list_items i where i.id = new.status_id),
    false
  );
  return new;
end;
$$;

comment on function public.sync_asset_is_inactive() is
  'BEFORE INSERT/UPDATE OF status_id trigger on public.assets (issue #274): assets.is_inactive := the status item''s is_inactive. Fires after assets_derive_org_and_client (name order) so the default status is already filled in.';

revoke all on function public.sync_asset_is_inactive() from public, anon, authenticated;

create trigger assets_sync_is_inactive
  before insert or update of status_id on public.assets
  for each row execute function public.sync_asset_is_inactive();

-- Status item flag changes re-sync the assets of that status.
create or replace function public.resync_assets_on_status_inactive_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.assets
    set is_inactive = new.is_inactive
    where status_id = new.id and is_inactive is distinct from new.is_inactive;
  exception when unique_violation then
    raise exception 'This status cannot be put back in use: an asset with this status has the same serial number and model as an asset that is in use. Resolve the duplicate serial numbers first.'
      using errcode = '23505';
  end;
  return null;
end;
$$;

comment on function public.resync_assets_on_status_inactive_change() is
  'AFTER UPDATE OF is_inactive trigger on public.reference_list_items (issue #274): re-syncs assets.is_inactive of the assets with that status. 23505 with a clear message when putting a status back in use collides with the unique serial index; 23514 (Remove the asset from contract ... first) when an asset on a Draft/Active contract would become inactive.';

revoke all on function public.resync_assets_on_status_inactive_change() from public, anon, authenticated;

create trigger reference_list_items_resync_assets_on_inactive_change
  after update of is_inactive on public.reference_list_items
  for each row
  when (old.is_inactive is distinct from new.is_inactive)
  execute function public.resync_assets_on_status_inactive_change();

-- ---------------------------------------------------------------------------
-- Inactive guard: no Draft/Active contract link on the asset or a descendant.
-- ---------------------------------------------------------------------------
create or replace function public.guard_asset_inactive_contracts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_numbers text;
begin
  if new.is_inactive and not old.is_inactive then
    with recursive tree(id) as (
      select new.id
      union
      select ac.component_asset_id
      from public.asset_components ac
      join tree t on ac.parent_asset_id = t.id
    )
    select string_agg(distinct c.contract_number, ', ' order by c.contract_number)
      into v_numbers
    from public.contract_assets ca
    join public.contracts c on c.id = ca.contract_id
    where ca.asset_id in (select id from tree)
      and ca.removed_on is null
      and c.status in ('draft', 'active');

    if v_numbers is not null then
      raise exception 'Remove the asset from contract % first', v_numbers
        using errcode = '23514',
              detail = format('asset=%s', new.name),
              hint = 'The asset, or one of its components, is linked to a draft or active contract.';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.guard_asset_inactive_contracts() is
  'BEFORE UPDATE trigger on public.assets (issue #274): refuses (23514, message ''Remove the asset from contract <numbers> first'', detail asset=<name>) when is_inactive goes false -> true while the asset or any asset_components descendant has an open contract_assets row on a draft or active contract. Named to fire after assets_sync_is_inactive.';

revoke all on function public.guard_asset_inactive_contracts() from public, anon, authenticated;

create trigger assets_validate_inactive_contracts
  before update on public.assets
  for each row execute function public.guard_asset_inactive_contracts();

-- ---------------------------------------------------------------------------
-- NEW links to an inactive asset are refused (insert, or when the column changes).
-- ---------------------------------------------------------------------------
create or replace function public.reject_inactive_asset_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col text := tg_argv[0];
  v_new uuid := nullif(to_jsonb(new) ->> v_col, '')::uuid;
begin
  if v_new is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and v_new is not distinct from nullif(to_jsonb(old) ->> v_col, '')::uuid then
    return new;
  end if;
  if exists (select 1 from public.assets a where a.id = v_new and a.is_inactive) then
    raise exception 'An inactive asset cannot be linked (%.%)', tg_table_name, v_col
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.reject_inactive_asset_link() is
  'Generic BEFORE INSERT/UPDATE OF <column> trigger (issue #274), TG_ARGV[0] = the asset column: refuses (23514) a NEW link to an inactive asset. Existing rows stay valid (only checked on insert or when the column changes).';

revoke all on function public.reject_inactive_asset_link() from public, anon, authenticated;

create trigger work_orders_reject_inactive_asset
  before insert or update of asset_id on public.work_orders
  for each row execute function public.reject_inactive_asset_link('asset_id');

create trigger activities_reject_inactive_asset
  before insert or update of asset_id on public.activities
  for each row execute function public.reject_inactive_asset_link('asset_id');

create trigger asset_components_reject_inactive_asset
  before insert or update of component_asset_id on public.asset_components
  for each row execute function public.reject_inactive_asset_link('component_asset_id');

-- ===========================================================================
-- C. Client immutability: derive_asset_org_and_client (latest body
--    20260822200000_reference_lists.sql) + client check on UPDATE.
-- ===========================================================================
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

  if tg_op = 'UPDATE' and old.client_id is distinct from v_client_id then
    raise exception 'An asset can''t move to another client. Make it inactive and create a new asset at the new client.'
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
  'BEFORE INSERT/UPDATE OF site_id trigger on public.assets: sets client_id and organization_id from the referenced site, blocks cross-organization re-parenting, fills in status_id with the organization''s default asset_status item when omitted, and (issue #274) refuses (23514) a site of ANOTHER client on UPDATE: an asset never changes client (make it inactive and create a new asset). Moving to another site of the same client is allowed.';

-- ===========================================================================
-- D. Successor link
-- ===========================================================================
create unique index assets_previous_asset_id_unique_idx
  on public.assets (previous_asset_id)
  where previous_asset_id is not null;

create or replace function public.validate_asset_previous_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_inactive boolean;
  v_cycle boolean;
begin
  if new.previous_asset_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.previous_asset_id is not distinct from old.previous_asset_id then
    return new;
  end if;

  if new.previous_asset_id = new.id then
    raise exception 'An asset cannot be its own previous asset'
      using errcode = '23514';
  end if;

  select a.organization_id, a.is_inactive into v_org, v_inactive
  from public.assets a
  where a.id = new.previous_asset_id;

  if v_org is null then
    raise exception 'assets.previous_asset_id % does not reference an existing asset', new.previous_asset_id
      using errcode = '23503';
  elsif v_org <> new.organization_id then
    raise exception 'The previous asset must belong to the same organization'
      using errcode = '23514';
  elsif not v_inactive then
    raise exception 'The previous asset must be inactive'
      using errcode = '23514';
  end if;

  with recursive chain(id, depth) as (
    select new.previous_asset_id, 0
    union all
    select a.previous_asset_id, c.depth + 1
    from public.assets a
    join chain c on a.id = c.id
    where a.previous_asset_id is not null and c.depth < 1000
  )
  select exists (select 1 from chain where id = new.id) into v_cycle;
  if v_cycle then
    raise exception 'The previous asset chain would form a cycle'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_asset_previous_asset() is
  'BEFORE INSERT/UPDATE OF previous_asset_id trigger on public.assets (issue #274): same organization, not self, no cycle, previous asset must be inactive (23514). Only checked when the column changes. Runs after assets_derive_org_and_client (name order).';

revoke all on function public.validate_asset_previous_asset() from public, anon, authenticated;

create trigger assets_validate_previous_asset
  before insert or update of previous_asset_id on public.assets
  for each row execute function public.validate_asset_previous_asset();

grant insert (previous_asset_id) on public.assets to authenticated;
grant update (previous_asset_id) on public.assets to authenticated;

-- ===========================================================================
-- E. Unique serial per organization + model among assets in use
-- ===========================================================================
do $$
declare
  v_dups text;
begin
  select string_agg(
           format('organization %s / model %s / serial %L: %s', d.organization_id, d.model_id, d.serial, d.names),
           E'\n' order by d.organization_id, d.model_id, d.serial)
    into v_dups
  from (
    select a.organization_id, a.model_id, lower(btrim(a.serial_number)) as serial,
           string_agg(a.name, ', ' order by a.name) as names
    from public.assets a
    where not a.is_inactive
      and a.model_id is not null
      and a.serial_number is not null
      and btrim(a.serial_number) <> ''
    group by a.organization_id, a.model_id, lower(btrim(a.serial_number))
    having count(*) > 1
  ) d;

  if v_dups is not null then
    raise exception E'Duplicate serial numbers among assets in use must be cleaned up before applying this migration:\n%', v_dups;
  end if;
end;
$$;

create unique index assets_unique_serial_per_model_idx
  on public.assets (organization_id, model_id, lower(btrim(serial_number)))
  where not is_inactive
    and model_id is not null
    and serial_number is not null
    and btrim(serial_number) <> '';

comment on index public.assets_unique_serial_per_model_idx is
  'Issue #274: a serial number (case/whitespace-insensitive) is unique per organization and model among assets that are not inactive. Blank serials and assets without a model are not constrained.';

-- ===========================================================================
-- F. contract_assets: id PK, removal columns, guards
-- ===========================================================================
alter table public.contract_assets
  add column id uuid not null default gen_random_uuid(),
  add column removed_on date,
  add column removed_at timestamptz,
  add column removed_by uuid references public.users (id) on delete set null;

alter table public.contract_assets drop constraint contract_assets_pkey;
alter table public.contract_assets add constraint contract_assets_pkey primary key (id);

alter table public.contract_assets
  add constraint contract_assets_removal_consistent
    check ((removed_on is null) = (removed_at is null));

create unique index contract_assets_open_unique_idx
  on public.contract_assets (contract_id, asset_id)
  where removed_on is null;
create index contract_assets_contract_id_idx on public.contract_assets (contract_id);
create index contract_assets_removed_by_idx on public.contract_assets (removed_by);

comment on column public.contract_assets.id is
  'Surrogate key (issue #274): an asset can be linked again after removal as a NEW coverage row, so (contract_id, asset_id) is only unique among open rows (contract_assets_open_unique_idx).';
comment on column public.contract_assets.removed_on is
  'LAST covered day (inclusive) of an asset removed from an Active contract (issue #274); null = still covered. Set only by remove_contract_asset (no UPDATE grant). The closing readings are on this date.';
comment on column public.contract_assets.removed_at is
  'When the removal was recorded (set with removed_on).';
comment on column public.contract_assets.removed_by is
  'Who removed the asset (auth.uid() in remove_contract_asset).';
comment on table public.contract_assets is
  'Many-to-many link between a contract and the assets it covers; organization_id is denormalized from the contract (derive_contract_asset_organization_id) and the asset must be in the same organization and client as the contract and not inactive (validate_contract_asset_relations). Surrogate id PK; (contract_id, asset_id) unique only while open (removed_on is null). Draft contract: removing deletes the row; Active contract: remove_contract_asset keeps it with removed_on/removed_at/removed_by (history, settlement counts the window up to removed_on); direct DELETE on a non-draft contract is refused. No UPDATE grant.';

-- validate_contract_asset_relations: body copied from 20260823150000 (no later
-- redefinition) + the inactive-asset check.
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
  v_asset_inactive boolean;
begin
  select client_id into v_contract_client_id
  from public.contracts
  where id = new.contract_id;

  select organization_id, client_id, is_inactive
    into v_asset_org_id, v_asset_client_id, v_asset_inactive
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
  elsif v_asset_inactive then
    raise exception 'An inactive asset cannot be added to a contract'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_contract_asset_relations() is
  'BEFORE INSERT trigger on public.contract_assets: rejects an asset_id from a different organization or client than the contract, and (issue #274) an inactive asset (23514). Runs after contract_assets_derive_organization_id (name order).';

create or replace function public.guard_contract_asset_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select c.status into v_status from public.contracts c where c.id = old.contract_id;
  -- Contract already gone (ON DELETE CASCADE) => v_status is null => allowed.
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Assets are removed from a non-draft contract through remove_contract_asset'
      using errcode = '23514';
  end if;
  return old;
end;
$$;

comment on function public.guard_contract_asset_delete() is
  'BEFORE DELETE trigger on public.contract_assets (issue #274): a link on an active or ended contract is never hard-deleted directly (23514); use remove_contract_asset. Allowed on draft contracts and when the whole contract is being deleted (cascade).';

revoke all on function public.guard_contract_asset_delete() from public, anon, authenticated;

create trigger contract_assets_guard_delete
  before delete on public.contract_assets
  for each row execute function public.guard_contract_asset_delete();

-- ===========================================================================
-- G. contract_covered_assets: one row per coverage window
-- ===========================================================================
drop function public.contract_covered_assets(uuid);

create or replace function public.contract_covered_assets(p_contract_id uuid)
returns table (
  asset_id uuid,
  root_asset_id uuid,
  coverage_start date,
  coverage_end date,
  contract_asset_id uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive cov(asset_id, root_asset_id, coverage_start, coverage_end, contract_asset_id) as (
    select ca.asset_id, ca.asset_id,
           greatest(k.start_date, coalesce(ca.added_on, k.start_date)),
           ca.removed_on, ca.id
      from public.contract_assets ca
      join public.contracts k on k.id = ca.contract_id
      where ca.contract_id = p_contract_id
    union all
    select ac.component_asset_id, cov.root_asset_id, cov.coverage_start, cov.coverage_end, cov.contract_asset_id
      from public.asset_components ac
      join cov on ac.parent_asset_id = cov.asset_id
  )
  select cov.asset_id, cov.root_asset_id, cov.coverage_start, cov.coverage_end, cov.contract_asset_id
    from cov
    order by cov.asset_id, cov.coverage_start, cov.contract_asset_id;
$$;

comment on function public.contract_covered_assets(uuid) is
  'Issues #269/#270/#274: one row per coverage WINDOW of the contract: every directly linked asset (open or removed, one row per contract_assets row) plus all asset_components descendants (inheriting the root link''s window), with the covered root asset, coverage_start (contract start date, or the date the root was added to a non-draft contract) and coverage_end (= removed_on, the last covered day; null = still covered) and the contract_assets row id. An asset re-added after removal appears once per window. SECURITY INVOKER, stable.';

revoke all on function public.contract_covered_assets(uuid) from public, anon;
grant execute on function public.contract_covered_assets(uuid) to authenticated;

-- contract_missing_baseline_readings_at: body copied from 20261123120000 (no
-- later redefinition), restricted to open windows (a removed asset needs no
-- baseline any more).
create or replace function public.contract_missing_baseline_readings_at(
  p_contract_id uuid,
  p_start_date date
)
returns table (asset_id uuid, asset_name text, volume_item_id uuid, counter_label text)
language sql
stable
security invoker
set search_path = public
as $$
  select a.id, a.name, amv.volume_item_id, rli.label
    from (select distinct cv.asset_id from public.contract_covered_assets(p_contract_id) cv
           where cv.coverage_end is null) cov
    join public.assets a on a.id = cov.asset_id
    join public.asset_model_volumes amv on amv.asset_model_id = a.model_id
    join public.reference_list_items rli on rli.id = amv.volume_item_id
    where exists (
        select 1 from public.contract_line_items cl
        where cl.contract_id = p_contract_id
          and cl.is_volume
          and cl.volume_item_id = amv.volume_item_id
      )
      and not exists (
        select 1 from public.asset_volume_readings r
        where r.asset_id = a.id
          and r.volume_item_id = amv.volume_item_id
          and not r.needs_review
          and r.read_at <= (((p_start_date + 1)::timestamp at time zone 'UTC') - interval '1 millisecond')
      )
    order by a.name, rli.label;
$$;

comment on function public.contract_missing_baseline_readings_at(uuid, date) is
  'Issue #270 internal variant of contract_missing_baseline_readings taking the start date explicitly (the activation trigger must use the NEW start_date). Day boundary is UTC (end of the start date, 23:59:59.999Z), like the app. Only open coverage windows (issue #274). SECURITY INVOKER, stable.';

revoke all on function public.contract_missing_baseline_readings_at(uuid, date) from public, anon;
grant execute on function public.contract_missing_baseline_readings_at(uuid, date) to authenticated;

-- Helper for work-order coverage: is the asset still covered on that date?
create or replace function public.asset_covered_by_contract_on(
  p_contract_id uuid,
  p_asset_id uuid,
  p_date date
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.contract_covered_assets(p_contract_id) cv
    where cv.asset_id = p_asset_id
      and (cv.coverage_end is null or p_date <= cv.coverage_end)
  );
$$;

comment on function public.asset_covered_by_contract_on(uuid, uuid, date) is
  'Issue #274: true when the asset (directly or as a component) is on the contract through an open coverage window, or through a removed one whose coverage_end (removed_on) is on or after p_date. Ignores coverage_start and the contract status. SECURITY INVOKER, stable.';

revoke all on function public.asset_covered_by_contract_on(uuid, uuid, date) from public, anon;
grant execute on function public.asset_covered_by_contract_on(uuid, uuid, date) to authenticated;

-- ===========================================================================
-- H. remove_contract_asset RPC
-- ===========================================================================
create or replace function public.remove_contract_asset(
  p_contract_id uuid,
  p_asset_id uuid,
  p_removed_on date,
  p_readings jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract public.contracts%rowtype;
  v_link public.contract_assets%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
  v_cov_start date;
  v_settled date;
  v_read_at timestamptz;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_missing text;
  r record;
begin
  select * into v_contract from public.contracts where id = p_contract_id for update;
  if not found then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;

  if auth.uid() is null
     or coalesce(public.current_member_role(v_contract.organization_id) not in ('owner', 'finance'), true) then
    raise exception 'Only an owner or finance member can remove an asset from a contract.' using errcode = '42501';
  end if;

  if v_contract.status = 'ended' then
    raise exception 'An asset cannot be removed from an ended contract.' using errcode = '23514';
  end if;

  select * into v_link
  from public.contract_assets ca
  where ca.contract_id = p_contract_id and ca.asset_id = p_asset_id and ca.removed_on is null;
  if not found then
    raise exception 'This asset is not linked to the contract.' using errcode = 'P0002';
  end if;

  if v_contract.status = 'draft' then
    delete from public.contract_assets where id = v_link.id;
    return;
  end if;

  -- Active contract.
  if p_removed_on is null then
    raise exception 'A removal date is required.' using errcode = '23514';
  end if;

  v_cov_start := greatest(v_contract.start_date, coalesce(v_link.added_on, v_contract.start_date));
  if p_removed_on < v_cov_start or p_removed_on > v_today then
    raise exception 'The removal date must be between the coverage start (%) and today (%).', v_cov_start, v_today
      using errcode = '23514';
  end if;

  select max(cs.period_end) into v_settled
  from public.contract_counter_settlements cs
  where cs.contract_id = p_contract_id;
  if v_settled is not null and p_removed_on <= v_settled then
    raise exception 'The removal date must be after the last settled counter period (ending %).', v_settled
      using errcode = '23514';
  end if;

  v_read_at := (p_removed_on::timestamp + interval '12 hours') at time zone 'UTC';
  v_day_start := p_removed_on::timestamp at time zone 'UTC';
  v_day_end := (p_removed_on + 1)::timestamp at time zone 'UTC';

  -- Closing readings supplied by the caller.
  for r in
    select (e ->> 'asset_id')::uuid as asset_id,
           (e ->> 'volume_item_id')::uuid as volume_item_id,
           (e ->> 'value')::numeric as value
    from jsonb_array_elements(coalesce(p_readings, '[]'::jsonb)) e
  loop
    if r.asset_id is null or r.volume_item_id is null or r.value is null then
      raise exception 'Every closing reading needs asset_id, volume_item_id and value.' using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.contract_covered_assets(p_contract_id) cv
      join public.assets a on a.id = cv.asset_id
      join public.asset_model_volumes amv on amv.asset_model_id = a.model_id
      where cv.contract_asset_id = v_link.id
        and cv.asset_id = r.asset_id
        and amv.volume_item_id = r.volume_item_id
        and exists (
          select 1 from public.contract_line_items cl
          where cl.contract_id = p_contract_id and cl.is_volume and cl.volume_item_id = r.volume_item_id
        )
    ) then
      raise exception 'Asset % / counter % is not a counter reading required for this removal.', r.asset_id, r.volume_item_id
        using errcode = '23514';
    end if;

    if not exists (
      select 1 from public.asset_volume_readings x
      where x.asset_id = r.asset_id and x.volume_item_id = r.volume_item_id
        and not x.needs_review and x.read_at >= v_day_start and x.read_at < v_day_end
    ) then
      insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at, needs_review)
      values (r.asset_id, r.volume_item_id, r.value, v_read_at, false);
    end if;
  end loop;

  -- Every (covered asset incl. components x counter of a volume line) needs an
  -- accepted reading on the removal date.
  select string_agg(a.name || ' – ' || rli.label, ', ' order by a.name, rli.label)
    into v_missing
  from public.contract_covered_assets(p_contract_id) cv
  join public.assets a on a.id = cv.asset_id
  join public.asset_model_volumes amv on amv.asset_model_id = a.model_id
  join public.reference_list_items rli on rli.id = amv.volume_item_id
  where cv.contract_asset_id = v_link.id
    and exists (
      select 1 from public.contract_line_items cl
      where cl.contract_id = p_contract_id and cl.is_volume and cl.volume_item_id = amv.volume_item_id
    )
    and not exists (
      select 1 from public.asset_volume_readings x
      where x.asset_id = a.id and x.volume_item_id = amv.volume_item_id
        and not x.needs_review and x.read_at >= v_day_start and x.read_at < v_day_end
    );

  if v_missing is not null then
    raise exception 'Missing closing readings: %', v_missing using errcode = '23514';
  end if;

  update public.contract_assets
  set removed_on = p_removed_on,
      removed_at = now(),
      removed_by = auth.uid()
  where id = v_link.id;
end;
$$;

comment on function public.remove_contract_asset(uuid, uuid, date, jsonb) is
  'Issue #274: removes an asset from a contract. SECURITY DEFINER; owner/finance only (42501); P0002 contract not found / asset not linked (open link). Draft: plain delete of the open link (date and readings ignored). Ended: 23514 ''An asset cannot be removed from an ended contract.'' Active: p_removed_on (LAST covered day) must lie between the link''s coverage start and today (UTC) and after the last settled counter window (23514); a closing reading is REQUIRED on that date for every covered asset (incl. components) x counter of a volume line the model has: either already an accepted reading that day or one in p_readings [{asset_id, volume_item_id, value}] (inserted at noon UTC through the normal reading triggers); else 23514 ''Missing closing readings: <asset> – <counter>, ...''. Then sets removed_on/removed_at/removed_by. Returns void.';

revoke all on function public.remove_contract_asset(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.remove_contract_asset(uuid, uuid, date, jsonb) to authenticated;

-- ===========================================================================
-- I. seed_default_reference_lists: live body (20261121090000) + Decommissioned
--    seeded with is_inactive = true.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.seed_default_reference_lists(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_billing_period_list_id uuid;
  v_maintenance_id uuid;
  v_service_id uuid;
  v_installation_id uuid;
  v_warranty_id uuid;
  v_time_entry_type_list_id uuid;
  v_quote_status_list_id uuid;
  v_asset_brand_list_id uuid;
  v_activity_type_list_id uuid;
  v_activity_status_list_id uuid;
  v_article_unit_list_id uuid;
  v_article_manufacturer_list_id uuid;
  v_vat_rate_list_id uuid;
  v_region_list_id uuid;
  v_payment_method_list_id uuid;
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
    (reference_list_id, organization_id, value, label, sort_order, is_default, color, is_inactive)
  values
    (v_asset_status_list_id, p_organization_id, 'active', 'Active', 1, true, 'green', false),
    (v_asset_status_list_id, p_organization_id, 'in_repair', 'In Repair', 2, false, 'amber', false),
    (v_asset_status_list_id, p_organization_id, 'decommissioned', 'Decommissioned', 3, false, 'gray', true)
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
  -- lifecycle: New (default) -> Scheduled -> Checkout -> En Route ->
  -- In Progress -> To review -> Completed -> Invoiced. `to_review` label
  -- corrected to English (`To review`) by this migration — see header;
  -- previously shipped as Dutch (`Te controleren`) by
  -- 20260920110000_work_order_to_review_status.sql.
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
    (v_work_order_status_list_id, p_organization_id, 'checkout', 'Checked out', 3, false),
    (v_work_order_status_list_id, p_organization_id, 'en_route', 'En Route', 4, false),
    (v_work_order_status_list_id, p_organization_id, 'in_progress', 'In Progress', 5, false),
    (v_work_order_status_list_id, p_organization_id, 'to_review', 'To review', 6, false),
    (v_work_order_status_list_id, p_organization_id, 'completed', 'Completed', 7, false),
    (v_work_order_status_list_id, p_organization_id, 'invoiced', 'Invoiced', 8, false)
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
  -- per contract type. `value` must be unique per LIST (not per parent
  -- group), so each item's slug is prefixed with its parent type.
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
    (reference_list_id, organization_id, value, label, sort_order, is_default, interval_months)
  values
    (v_billing_terms_list_id, p_organization_id, 'monthly', 'Monthly', 1, true, 1),
    (v_billing_terms_list_id, p_organization_id, 'quarterly', 'Quarterly', 2, false, 3),
    (v_billing_terms_list_id, p_organization_id, 'annually', 'Annually', 3, false, 12),
    (v_billing_terms_list_id, p_organization_id, 'per_visit', 'Per-visit', 4, false, null),
    (v_billing_terms_list_id, p_organization_id, 'one_time', 'One-time', 5, false, null)
  on conflict (reference_list_id, value) do nothing;

  -- billing_period: for contracts.billing_period_id (issue #122). Flat,
  -- standalone list (not dependent on contract_type, not a repurposing of
  -- billing_terms).
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'billing_period', 'Billing Period')
  on conflict (organization_id, list_key) do nothing;

  select id into v_billing_period_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'billing_period';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_billing_period_list_id, p_organization_id, 'monthly', 'Monthly', 1, true),
    (v_billing_period_list_id, p_organization_id, 'quarterly', 'Quarterly', 2, false),
    (v_billing_period_list_id, p_organization_id, 'annually', 'Annually', 3, false)
  on conflict (reference_list_id, value) do nothing;

  -- time_entry_type: for time_entries.entry_type_id. Flat list.
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

  -- quote_status: for quotes.status_id. Flat list, ordered lifecycle: Draft
  -- (default) -> Invoiced.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'quote_status', 'Quote Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_quote_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'quote_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_quote_status_list_id, p_organization_id, 'draft', 'Draft', 1, true)
  on conflict (reference_list_id, value) do nothing;

  -- invoiced: NEW quote_status item (issues #210/#211) — set on a contract
  -- quote once it has been invoiced. Own insert (not folded into the block
  -- above) so the original five rows stay byte-identical; color applied via
  -- the insert itself, never overwritten on conflict.
  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default, color)
  values
    (v_quote_status_list_id, p_organization_id, 'invoiced', 'Invoiced', 2, false, 'green')
  on conflict (reference_list_id, value) do nothing;

  -- asset_brand: for asset_models.brand_item_id. Flat, like
  -- asset_type/asset_status/contact_role — not dependent on anything.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'asset_brand', 'Brand')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_brand_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_brand';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_asset_brand_list_id, p_organization_id, 'kyocera', 'Kyocera', 1, false),
    (v_asset_brand_list_id, p_organization_id, 'canon', 'Canon', 2, false),
    (v_asset_brand_list_id, p_organization_id, 'ricoh', 'Ricoh', 3, false),
    (v_asset_brand_list_id, p_organization_id, 'xerox', 'Xerox', 4, false),
    (v_asset_brand_list_id, p_organization_id, 'other_brand', 'Other', 5, true)
  on conflict (reference_list_id, value) do nothing;

  -- activity_type: for activities.type_id. Flat list. No item is marked
  -- is_default — the type picker always requires an explicit choice.
  -- Labels translated to English by 20260919090000_translate_default_
  -- reference_list_labels_to_english.sql (issue #196): value slugs
  -- (bel_activiteit/storing/onderhoud/afspraak/email_opvolging) are
  -- UNCHANGED — application code (e.g.
  -- app/(app)/activities/actions.ts) compares against them directly.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'activity_type', 'Activity Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_activity_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'activity_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default, icon, planning_default)
  values
    (v_activity_type_list_id, p_organization_id, 'bel_activiteit', 'Call activity', 1, false, 'Phone', false),
    (v_activity_type_list_id, p_organization_id, 'storing', 'Breakdown', 2, false, 'AlertTriangle', true),
    (v_activity_type_list_id, p_organization_id, 'onderhoud', 'Maintenance', 3, false, 'Settings', true),
    (v_activity_type_list_id, p_organization_id, 'afspraak', 'Appointment', 4, false, 'CalendarDays', false),
    (v_activity_type_list_id, p_organization_id, 'email_opvolging', 'Email follow-up', 5, false, 'Mail', false)
  on conflict (reference_list_id, value) do update set icon = excluded.icon;

  -- inspectie: NEW activity_type item (issue #164, Planning module). Own
  -- `on conflict do nothing` clause — deliberately NOT folded into the
  -- `on conflict do update set icon = excluded.icon` clause above (see
  -- 20260915090000_region_reference_list.sql's header design note 3: that
  -- clause exists only to re-assert icon on the 5 pre-existing rows across
  -- repeated seed runs; widening it to this row too risks clobbering a
  -- tenant's own edited icon on it if this function is ever re-run oddly).
  -- Label translated to English (issue #196) — value slug `inspectie`
  -- unchanged.
  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, icon, planning_default)
  values
    (v_activity_type_list_id, p_organization_id, 'inspectie', 'Inspection', 6, 'Search', true)
  on conflict (reference_list_id, value) do nothing;

  -- Set inspectie's color to green (matching the design mockup) — scoped so
  -- it only ever touches this one new row, and only while still unset (never
  -- overwrites a tenant's own edit).
  update public.reference_list_items
  set color = 'green'
  where reference_list_id = v_activity_type_list_id
    and value = 'inspectie'
    and color is null;

  -- activity_status: for activities.status_id. Flat list, ordered lifecycle:
  -- Open (default) -> In Progress -> Completed. Labels translated to English
  -- (issue #196) — value slugs (open/in_progress/completed) unchanged.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'activity_status', 'Activity Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_activity_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'activity_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_activity_status_list_id, p_organization_id, 'open', 'Open', 1, true),
    (v_activity_status_list_id, p_organization_id, 'in_progress', 'In Progress', 2, false),
    (v_activity_status_list_id, p_organization_id, 'completed', 'Completed', 3, false)
  on conflict (reference_list_id, value) do nothing;

  -- article_unit: for articles.unit_item_id. Flat. Piece is the sensible
  -- tenant default (most articles in an FSM parts catalog are discrete
  -- units, not bulk liquid/weight). Label translated to English (issue
  -- #196) — value slug `stuk` unchanged; `liter`/`kg` labels were already
  -- plain English/international units, left as-is.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'article_unit', 'Article Unit')
  on conflict (organization_id, list_key) do nothing;

  select id into v_article_unit_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'article_unit';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_article_unit_list_id, p_organization_id, 'stuk', 'Piece', 1, true),
    (v_article_unit_list_id, p_organization_id, 'liter', 'Liter', 2, false),
    (v_article_unit_list_id, p_organization_id, 'kg', 'Kg', 3, false)
  on conflict (reference_list_id, value) do nothing;

  -- volume: for the Settings-managed "Volume" list (issue #131, "Beheren
  -- 'Volume'"). Dependent list, parent_list_key = article_unit. Deliberately
  -- seeds ZERO items — a Volume value is fully bespoke per tenant, unlike
  -- every list above.
  insert into public.reference_lists (organization_id, list_key, name, parent_list_key)
  values (p_organization_id, 'volume', 'Volume', 'article_unit')
  on conflict (organization_id, list_key) do nothing;

  -- article_manufacturer: for articles.manufacturer_item_id. Flat.
  -- Deliberately minimal (unlike asset_brand's printer-vertical seed) — a
  -- tenant's parts manufacturers are genuinely open-ended and specific to
  -- what they stock, so a single "Other" catch-all default is the honest
  -- starting point; the owner adds their own real manufacturers via
  -- Settings.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'article_manufacturer', 'Manufacturer')
  on conflict (organization_id, list_key) do nothing;

  select id into v_article_manufacturer_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'article_manufacturer';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_article_manufacturer_list_id, p_organization_id, 'other_manufacturer', 'Other', 1, true)
  on conflict (reference_list_id, value) do nothing;

  -- vat_rate: for articles.vat_rate_item_id. Flat. `value` is the literal
  -- numeric percentage as text ('0'/'9'/'21'), not a slug, so application
  -- code can do Number(item.value) directly for tax math instead of
  -- maintaining a separate mapping. 21% (the Dutch standard rate) is the
  -- default.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'vat_rate', 'VAT Rate')
  on conflict (organization_id, list_key) do nothing;

  select id into v_vat_rate_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'vat_rate';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_vat_rate_list_id, p_organization_id, '0', '0%', 1, false),
    (v_vat_rate_list_id, p_organization_id, '9', '9%', 2, false),
    (v_vat_rate_list_id, p_organization_id, '21', '21%', 3, true)
  on conflict (reference_list_id, value) do nothing;

  -- region: for sites.region_id / memberships.region_id (issue #164,
  -- Planning module; user-facing label is "Service Area" per issue #192, the
  -- internal list_key stays `region`). Flat, root-level list, like
  -- asset_type/contact_role — not dependent on anything. Each item's
  -- province grouping lives in the generic `description` column, not a
  -- second list level (see 20260915090000_region_reference_list.sql's header
  -- design note 2) — those description values are real Dutch province names,
  -- not translatable UI copy, and are left as-is. Item labels translated to
  -- English (issue #196) — value slugs (regio_noord/regio_midden/regio_zuid/
  -- intern_werkplaats) unchanged.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'region', 'Region')
  on conflict (organization_id, list_key) do nothing;

  select id into v_region_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'region';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, description, sort_order)
  values
    (v_region_list_id, p_organization_id, 'regio_noord', 'North Region', 'Groningen · Friesland · Drenthe', 1),
    (v_region_list_id, p_organization_id, 'regio_midden', 'Central Region', 'Utrecht · Gelderland', 2),
    (v_region_list_id, p_organization_id, 'regio_zuid', 'South Region', 'Brabant · Limburg', 3),
    (v_region_list_id, p_organization_id, 'intern_werkplaats', 'Internal / Workshop', null, 4)
  on conflict (reference_list_id, value) do nothing;

  -- payment_method: for invoice_payments.method_id (issue #235). Flat,
  -- tenant-configurable list; bank transfer is the default. Value slugs are
  -- referenced by the app (offset = settled against another document).
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'payment_method', 'Payment Method')
  on conflict (organization_id, list_key) do nothing;

  select id into v_payment_method_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'payment_method';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_payment_method_list_id, p_organization_id, 'bank_transfer', 'Bank transfer', 1, true),
    (v_payment_method_list_id, p_organization_id, 'pin', 'Card (PIN)', 2, false),
    (v_payment_method_list_id, p_organization_id, 'cash', 'Cash', 3, false),
    (v_payment_method_list_id, p_organization_id, 'offset', 'Offset', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- Self-heal: re-verify every list above (plus any earlier picklist) still
  -- has its intended default item, in case is_default was reset outside this
  -- function's control (see 20260907100000_fix_seed_default_reference_lists_
  -- regression_3.sql's header for the full mechanism). Preserved verbatim —
  -- region/volume have no is_default concept, so neither needs an entry here
  -- (same as asset_subtype/sla_tier).
  perform public.ensure_reference_list_defaults(p_organization_id);
end;
$function$
;

do $$
begin
  execute format(
    'comment on function public.seed_default_reference_lists(uuid) is %L',
    obj_description('public.seed_default_reference_lists(uuid)'::regprocedure, 'pg_proc')
      || ' Extended in 20261126090000_asset_inactive_successor_serial_contract_removal.sql (issue #274): the asset_status Decommissioned item is seeded with is_inactive = true; copied forward from the live body.'
  );
end;
$$;
