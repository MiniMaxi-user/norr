-- Issue #221 review hardening: validate_asset_volume_reading() is SECURITY
-- DEFINER and runs BEFORE the RLS WITH CHECK, so a non-member who guessed an
-- asset + counter UUID could receive AV002/AV003 with a neighbouring
-- reading's value/timestamp in DETAIL. Reject non-members (42501) right after
-- the asset lookup, before any neighbour data is read. Body otherwise
-- identical to 20261118090000_asset_volumes.sql.

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
