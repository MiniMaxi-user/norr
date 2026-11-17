-- Asset volumes (issue #221): counters/meters per asset model + meter readings
-- per asset.
--
-- Domain: a "volume" is a counter (e.g. "B/W prints", "Color prints", "Cups of
-- coffee"). The master list of counters is the existing tenant reference list
-- list_key = 'volume' (20260910090000_reference_list_items_description_active_
-- and_volume_list.sql) -- its structure is NOT touched here. Counters are
-- configured per asset MODEL (asset_model_volumes, many-to-many); readings are
-- recorded per asset per counter with a date-time (asset_volume_readings).
-- Linking a counter to a contract line item is a follow-up story.
--
-- Design notes
-- 1. FK on delete behaviour. asset_model_volumes.volume_item_id is ON DELETE
--    CASCADE: it is pure configuration, so removing a counter from the master
--    list simply un-configures it. asset_volume_readings.volume_item_id is
--    ON DELETE RESTRICT (like every other reference_list_items FK in this
--    schema): a counter with recorded history cannot be deleted; deactivate it
--    (is_active=false) instead.
-- 2. organization_id is derived by trigger (from the model / the asset), never
--    client-writable -- same as asset_components / work_order_articles.
-- 3. Readings are immutable: select/insert/delete grants only. Correction =
--    delete + re-add.
-- 4. RLS. Select: any org member (assets are readable by every member; the
--    engineer needs previous readings to enter a valid next one).
--    asset_model_volumes write: owner only (mirrors asset_models).
--    asset_volume_readings insert: owner/planner/engineer; delete:
--    owner/planner any row, engineer only rows with created_by = auth.uid().
--    finance/administratie: read only. Consistent with the `asset_volumes`
--    module in packages/rbac (engineer create_own/delete_own).
--
-- Reading validation error codes (BEFORE INSERT trigger
-- validate_asset_volume_reading). The app should map by SQLSTATE; the message
-- is a stable machine key, DETAIL carries the data of the conflicting
-- neighbour, HINT the suggested action.
--   AV001  asset_volume_counter_not_configured
--            the asset has no model, or the counter is not configured on the
--            asset's current model via asset_model_volumes
--   AV002  asset_volume_value_below_previous
--            value < the reading with the greatest read_at before new.read_at
--            (DETAIL: 'previous_value=<v>; previous_read_at=<ts>')
--   AV003  asset_volume_value_above_next
--            value > the reading with the smallest read_at after new.read_at
--            (DETAIL: 'next_value=<v>; next_read_at=<ts>')
--   23514  volume_item_id not an item of this org's `volume` list, work order
--            of another org, or value < 0 (asset_volume_readings_value_nonnegative)
--   23505  duplicate (asset_id, volume_item_id, read_at)

-- ---------------------------------------------------------------------------
-- asset_model_volumes
-- ---------------------------------------------------------------------------
create table public.asset_model_volumes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  asset_model_id uuid not null references public.asset_models (id) on delete cascade,
  volume_item_id uuid not null references public.reference_list_items (id) on delete cascade,
  sort_order integer not null default 0,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (asset_model_id, volume_item_id)
);

comment on table public.asset_model_volumes is
  'Counters (items of the tenant''s `volume` reference list) configured on an asset model. Many-to-many join; readings on an asset are only allowed for counters configured on the asset''s current model.';

create index asset_model_volumes_organization_id_idx on public.asset_model_volumes (organization_id);
create index asset_model_volumes_volume_item_id_idx on public.asset_model_volumes (volume_item_id);
create index asset_model_volumes_created_by_idx on public.asset_model_volumes (created_by);

alter table public.asset_model_volumes enable row level security;
alter table public.asset_model_volumes force row level security;

create or replace function public.validate_asset_model_volume()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model_org uuid;
  v_item_org uuid;
  v_item_key text;
begin
  select organization_id into v_model_org
  from public.asset_models where id = new.asset_model_id;

  if v_model_org is null then
    raise exception 'asset_model_volumes.asset_model_id % does not reference an existing asset model', new.asset_model_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_model_org then
    raise exception 'Cannot move an asset model volume to a model in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_model_org;

  select rl.organization_id, rl.list_key into v_item_org, v_item_key
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rli.id = new.volume_item_id;

  if v_item_org is null then
    raise exception 'asset_model_volumes.volume_item_id % does not reference an existing reference_list_items row', new.volume_item_id
      using errcode = '23503';
  elsif v_item_key <> 'volume' then
    raise exception 'asset_model_volumes.volume_item_id must reference an item from the volume reference list (got list_key=%)', v_item_key
      using errcode = '23514';
  elsif v_item_org <> new.organization_id then
    raise exception 'asset_model_volumes.volume_item_id must belong to the same organization as the asset model'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_asset_model_volume() is
  'BEFORE INSERT/UPDATE OF asset_model_id, volume_item_id trigger on public.asset_model_volumes: derives organization_id from the asset model (blocking cross-org re-parenting) and requires volume_item_id to be an item of this organization''s `volume` list.';

create trigger asset_model_volumes_validate
  before insert or update of asset_model_id, volume_item_id on public.asset_model_volumes
  for each row execute function public.validate_asset_model_volume();

create trigger asset_model_volumes_set_created_by
  before insert on public.asset_model_volumes
  for each row execute function public.set_created_by();

create policy "asset_model_volumes_select_member"
on public.asset_model_volumes
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "asset_model_volumes_insert_owner"
on public.asset_model_volumes
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "asset_model_volumes_update_owner"
on public.asset_model_volumes
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "asset_model_volumes_delete_owner"
on public.asset_model_volumes
for delete
to authenticated
using (public.is_org_owner(organization_id));

revoke all on public.asset_model_volumes from authenticated;
grant select, delete on public.asset_model_volumes to authenticated;
grant insert (id, asset_model_id, volume_item_id, sort_order) on public.asset_model_volumes to authenticated;
grant update (sort_order) on public.asset_model_volumes to authenticated;

-- ---------------------------------------------------------------------------
-- asset_volume_readings
-- ---------------------------------------------------------------------------
create table public.asset_volume_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  volume_item_id uuid not null references public.reference_list_items (id) on delete restrict,
  value numeric(15, 3) not null,
  read_at timestamptz not null default now(),
  notes text,
  work_order_id uuid references public.work_orders (id) on delete set null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint asset_volume_readings_value_nonnegative check (value >= 0),
  unique (asset_id, volume_item_id, read_at)
);

comment on table public.asset_volume_readings is
  'Immutable meter readings per asset per counter (volume item). Chronologically monotonic per (asset_id, volume_item_id), enforced by validate_asset_volume_reading; backdating is allowed while it stays consistent with neighbouring readings. Correction = delete + re-add (no UPDATE grant).';
comment on column public.asset_volume_readings.value is
  'numeric(15,3): counters are mostly integers, three decimals allow e.g. operating hours.';
comment on column public.asset_volume_readings.work_order_id is
  'Set when the reading was entered from the PWA on a work order; on delete set null so removing the work order keeps the reading.';
comment on column public.asset_volume_readings.created_by is
  'Stamped from auth.uid() by set_created_by (not client-writable); the RLS "own row" column for engineer deletes.';

-- The unique (asset_id, volume_item_id, read_at) index also serves the
-- latest/neighbouring-reading lookups (backward index scan), so no separate
-- read_at desc index is needed.
create index asset_volume_readings_organization_id_idx on public.asset_volume_readings (organization_id);
create index asset_volume_readings_volume_item_id_idx on public.asset_volume_readings (volume_item_id);
create index asset_volume_readings_work_order_id_idx on public.asset_volume_readings (work_order_id) where work_order_id is not null;
create index asset_volume_readings_created_by_idx on public.asset_volume_readings (created_by);

alter table public.asset_volume_readings enable row level security;
alter table public.asset_volume_readings force row level security;

create or replace function public.validate_asset_volume_reading()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_org uuid;
  v_model_id uuid;
  v_item_org uuid;
  v_item_key text;
  v_wo_org uuid;
  v_prev_value numeric;
  v_prev_at timestamptz;
  v_next_value numeric;
  v_next_at timestamptz;
begin
  select a.organization_id, a.model_id into v_asset_org, v_model_id
  from public.assets a where a.id = new.asset_id;

  if v_asset_org is null then
    raise exception 'asset_volume_readings.asset_id % does not reference an existing asset', new.asset_id
      using errcode = '23503';
  end if;
  new.organization_id := v_asset_org;

  select rl.organization_id, rl.list_key into v_item_org, v_item_key
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rli.id = new.volume_item_id;

  if v_item_org is null then
    raise exception 'asset_volume_readings.volume_item_id % does not reference an existing reference_list_items row', new.volume_item_id
      using errcode = '23503';
  elsif v_item_key <> 'volume' then
    raise exception 'asset_volume_readings.volume_item_id must reference an item from the volume reference list (got list_key=%)', v_item_key
      using errcode = '23514';
  elsif v_item_org <> new.organization_id then
    raise exception 'asset_volume_readings.volume_item_id must belong to the same organization as the asset'
      using errcode = '23514';
  end if;

  if new.work_order_id is not null then
    select organization_id into v_wo_org from public.work_orders where id = new.work_order_id;
    if v_wo_org is null then
      raise exception 'asset_volume_readings.work_order_id % does not reference an existing work order', new.work_order_id
        using errcode = '23503';
    elsif v_wo_org <> new.organization_id then
      raise exception 'asset_volume_readings.work_order_id must belong to the same organization as the asset'
        using errcode = '23514';
    end if;
  end if;

  -- The counter must be configured on the asset's CURRENT model.
  if v_model_id is null or not exists (
    select 1 from public.asset_model_volumes amv
    where amv.asset_model_id = v_model_id and amv.volume_item_id = new.volume_item_id
  ) then
    raise exception 'asset_volume_counter_not_configured'
      using errcode = 'AV001',
            detail = 'The counter is not configured on this asset''s model (or the asset has no model).',
            hint = 'Configure the counter on the asset model first.';
  end if;

  -- Chronological monotonicity, serialized per (asset, counter).
  perform pg_advisory_xact_lock(hashtextextended(new.asset_id::text || ':' || new.volume_item_id::text, 0));

  select r.value, r.read_at into v_prev_value, v_prev_at
  from public.asset_volume_readings r
  where r.asset_id = new.asset_id and r.volume_item_id = new.volume_item_id
    and r.read_at < new.read_at
  order by r.read_at desc
  limit 1;

  if v_prev_at is not null and new.value < v_prev_value then
    raise exception 'asset_volume_value_below_previous'
      using errcode = 'AV002',
            detail = format('previous_value=%s; previous_read_at=%s', v_prev_value, v_prev_at),
            hint = 'Value is lower than the previous reading; delete that reading first if it is wrong.';
  end if;

  select r.value, r.read_at into v_next_value, v_next_at
  from public.asset_volume_readings r
  where r.asset_id = new.asset_id and r.volume_item_id = new.volume_item_id
    and r.read_at > new.read_at
  order by r.read_at asc
  limit 1;

  if v_next_at is not null and new.value > v_next_value then
    raise exception 'asset_volume_value_above_next'
      using errcode = 'AV003',
            detail = format('next_value=%s; next_read_at=%s', v_next_value, v_next_at),
            hint = 'Value is higher than the next reading; delete that reading first if it is wrong.';
  end if;

  return new;
end;
$$;

comment on function public.validate_asset_volume_reading() is
  'BEFORE INSERT trigger on public.asset_volume_readings: derives organization_id from the asset; checks volume item list/org and work order org; requires the counter to be configured on the asset''s current model (AV001); enforces chronological monotonicity under a per-(asset,counter) advisory lock (AV002 below previous, AV003 above next). SECURITY DEFINER so neighbour lookups ignore RLS.';

create trigger asset_volume_readings_set_created_by
  before insert on public.asset_volume_readings
  for each row execute function public.set_created_by();

create trigger asset_volume_readings_validate
  before insert on public.asset_volume_readings
  for each row execute function public.validate_asset_volume_reading();

create policy "asset_volume_readings_select_member"
on public.asset_volume_readings
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "asset_volume_readings_insert_scoped"
on public.asset_volume_readings
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'planner', 'engineer')
);

create policy "asset_volume_readings_delete_scoped"
on public.asset_volume_readings
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and created_by = auth.uid()
  )
);

revoke all on public.asset_volume_readings from authenticated;
grant select, delete on public.asset_volume_readings to authenticated;
grant insert (id, asset_id, volume_item_id, value, read_at, notes, work_order_id)
  on public.asset_volume_readings to authenticated;

-- ---------------------------------------------------------------------------
-- Latest reading per asset per counter (client totals read path).
-- security_invoker: RLS of the underlying tables applies to the caller.
-- ---------------------------------------------------------------------------
create view public.asset_volume_latest_readings
with (security_invoker = true) as
select distinct on (r.asset_id, r.volume_item_id)
  r.id as reading_id,
  r.organization_id,
  r.asset_id,
  r.volume_item_id,
  r.value,
  r.read_at,
  r.work_order_id,
  r.created_by,
  a.client_id,
  a.site_id,
  a.model_id
from public.asset_volume_readings r
join public.assets a on a.id = r.asset_id
order by r.asset_id, r.volume_item_id, r.read_at desc;

comment on view public.asset_volume_latest_readings is
  'Latest reading per (asset, counter) with the asset''s client_id/site_id/model_id. security_invoker, so RLS on asset_volume_readings and assets applies. Client totals: select client_id, volume_item_id, sum(value) group by client_id, volume_item_id.';

revoke all on public.asset_volume_latest_readings from anon, authenticated;
grant select on public.asset_volume_latest_readings to authenticated;
