-- Issue #225: offline-entered meter readings that violate the chronological
-- monotonic check at sync time are stored anyway, flagged for office review.
--
-- * needs_review: client-settable request ("accept even if non-monotonic").
-- * review_reason: trigger-only ('below_previous' | 'above_next').
-- The trigger only keeps needs_review = true when the row really violates a
-- neighbour; otherwise both columns are reset, so the flag cannot be used to
-- mark arbitrary readings. All other checks (org, membership, volume list,
-- work order org, counter configured) still apply to flagged rows.
-- Flagged readings still count as readings: asset_volume_latest_readings keeps
-- selecting by read_at regardless of the flag (it just exposes the flag).

alter table public.asset_volume_readings
  add column needs_review boolean not null default false,
  add column review_reason text;

alter table public.asset_volume_readings
  add constraint asset_volume_readings_review_reason_check
  check (review_reason is null or review_reason in ('below_previous', 'above_next')),
  add constraint asset_volume_readings_review_consistency_check
  check ((needs_review and review_reason is not null) or (not needs_review and review_reason is null));

comment on column public.asset_volume_readings.needs_review is
  'True when the reading (typically entered offline) violates the chronological monotonic check against a neighbouring reading but was accepted for office review. Client may request it on INSERT; the trigger resets it to false if the reading is actually consistent.';
comment on column public.asset_volume_readings.review_reason is
  'Set by validate_asset_volume_reading when needs_review is true: below_previous or above_next. Trigger-only (no client insert grant).';

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
  v_want_review boolean := coalesce(new.needs_review, false);
begin
  -- review_reason is trigger-only; always recomputed below.
  new.needs_review := v_want_review;
  new.review_reason := null;

  select a.organization_id, a.model_id into v_asset_org, v_model_id
  from public.assets a where a.id = new.asset_id;

  if v_asset_org is null then
    raise exception 'asset_volume_readings.asset_id % does not reference an existing asset', new.asset_id
      using errcode = '23503';
  end if;
  new.organization_id := v_asset_org;

  -- auth.uid() is null for service-role/maintenance inserts; those bypass RLS anyway.
  if auth.uid() is not null and not public.is_member_of_org(v_asset_org) then
    raise exception 'not a member of the asset''s organization'
      using errcode = '42501';
  end if;

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
    if not v_want_review then
      raise exception 'asset_volume_value_below_previous'
        using errcode = 'AV002',
              detail = format('previous_value=%s; previous_read_at=%s', v_prev_value, v_prev_at),
              hint = 'Value is lower than the previous reading; delete that reading first if it is wrong.';
    end if;
    new.review_reason := 'below_previous';
  end if;

  select r.value, r.read_at into v_next_value, v_next_at
  from public.asset_volume_readings r
  where r.asset_id = new.asset_id and r.volume_item_id = new.volume_item_id
    and r.read_at > new.read_at
  order by r.read_at asc
  limit 1;

  if v_next_at is not null and new.value > v_next_value then
    if not v_want_review then
      raise exception 'asset_volume_value_above_next'
        using errcode = 'AV003',
              detail = format('next_value=%s; next_read_at=%s', v_next_value, v_next_at),
              hint = 'Value is higher than the next reading; delete that reading first if it is wrong.';
    end if;
    -- below_previous wins when both neighbours are violated.
    new.review_reason := coalesce(new.review_reason, 'above_next');
  end if;

  -- The flag only survives when a neighbour is actually violated.
  new.needs_review := new.review_reason is not null;

  return new;
end;
$$;

comment on function public.validate_asset_volume_reading() is
  'BEFORE INSERT trigger on public.asset_volume_readings: derives organization_id from the asset; checks volume item list/org and work order org; requires the counter to be configured on the asset''s current model (AV001); enforces chronological monotonicity under a per-(asset,counter) advisory lock (AV002 below previous, AV003 above next). When needs_review = true the two monotonic checks are skipped and review_reason is computed (below_previous | above_next); if no neighbour is violated the flag is reset to false. SECURITY DEFINER so neighbour lookups ignore RLS.';

-- Grants: re-issue the full insert column list (review_reason deliberately absent).
revoke insert on public.asset_volume_readings from authenticated;
grant insert (id, asset_id, volume_item_id, value, read_at, notes, work_order_id, needs_review)
  on public.asset_volume_readings to authenticated;

-- Latest-reading view: flagged readings still count. Expose the flag so the UI
-- can show it. New columns are appended at the end so CREATE OR REPLACE is valid.
create or replace view public.asset_volume_latest_readings
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
  a.model_id,
  r.needs_review,
  r.review_reason
from public.asset_volume_readings r
join public.assets a on a.id = r.asset_id
order by r.asset_id, r.volume_item_id, r.read_at desc;

-- Office review queue lookup.
create index asset_volume_readings_needs_review_idx
  on public.asset_volume_readings (organization_id)
  where needs_review;
