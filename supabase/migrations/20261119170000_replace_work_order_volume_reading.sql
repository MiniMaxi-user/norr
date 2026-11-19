-- Issue #230 follow-up: atomic replace of a work order's volume reading.
--
-- Replacing a reading used to be a client-side delete + insert with a
-- best-effort restore, which could lose data (failed restore, lost
-- needs_review/created_by, AV002/AV003 rejecting the restore, concurrent saves
-- creating duplicates). This function does it in ONE transaction: any error
-- (trigger AV00x, RLS) rolls everything back, so the old reading stays intact.
--
-- SECURITY INVOKER on purpose: RLS and the existing BEFORE INSERT trigger apply
-- as the caller. The delete only removes what the caller may delete (engineer =
-- own readings, owner/planner = all); the insert needs the insert policy
-- (owner/planner/engineer), so finance is rejected (42501) and the whole call
-- rolls back.

create or replace function public.replace_work_order_volume_reading(
  p_work_order_id uuid,
  p_volume_item_id uuid,
  p_value numeric,
  p_read_at timestamptz,
  p_reading_id uuid default null,
  p_needs_review boolean default false,
  p_notes text default null
)
returns public.asset_volume_readings
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_asset_id uuid;
  v_existing public.asset_volume_readings;
  v_row public.asset_volume_readings;
begin
  if p_value is null or p_value <> trunc(p_value) then
    raise exception 'Value must be a whole number.' using errcode = '22023';
  end if;

  -- RLS hides work orders the caller cannot see (e.g. unassigned to an engineer).
  select wo.asset_id into v_asset_id
  from public.work_orders wo
  where wo.id = p_work_order_id;

  if not found then
    raise exception 'Work order not found.' using errcode = 'P0002';
  end if;
  if v_asset_id is null then
    raise exception 'This work order has no asset.' using errcode = '22023';
  end if;

  -- Same key as validate_asset_volume_reading(): serializes concurrent saves
  -- per (asset, counter) from before the delete until commit.
  perform pg_advisory_xact_lock(hashtextextended(v_asset_id::text || ':' || p_volume_item_id::text, 0));

  -- Idempotent retry (offline queue): the reading already exists.
  if p_reading_id is not null then
    select * into v_existing from public.asset_volume_readings r where r.id = p_reading_id;
    if found then
      if v_existing.work_order_id is distinct from p_work_order_id
         or v_existing.volume_item_id <> p_volume_item_id then
        raise exception 'Reading id already in use.' using errcode = '23505';
      end if;
      return v_existing;
    end if;
  end if;

  delete from public.asset_volume_readings r
  where r.work_order_id = p_work_order_id
    and r.volume_item_id = p_volume_item_id;

  insert into public.asset_volume_readings
    (id, work_order_id, asset_id, volume_item_id, value, read_at, notes, needs_review)
  values
    (coalesce(p_reading_id, gen_random_uuid()), p_work_order_id, v_asset_id, p_volume_item_id,
     p_value, p_read_at, p_notes, coalesce(p_needs_review, false))
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.replace_work_order_volume_reading(uuid, uuid, numeric, timestamptz, uuid, boolean, text) is
  'Atomically replaces the caller-deletable readings of one counter on a work order with a new reading (whole-number value). SECURITY INVOKER: RLS and validate_asset_volume_reading apply as the caller; any error rolls back so the old reading survives. p_reading_id makes retries idempotent (existing id on the same work order + counter is returned as-is). p_needs_review=true stores a non-monotonic value flagged instead of rejecting it (AV002/AV003).';

revoke all on function public.replace_work_order_volume_reading(uuid, uuid, numeric, timestamptz, uuid, boolean, text) from public;
revoke all on function public.replace_work_order_volume_reading(uuid, uuid, numeric, timestamptz, uuid, boolean, text) from anon;
grant execute on function public.replace_work_order_volume_reading(uuid, uuid, numeric, timestamptz, uuid, boolean, text) to authenticated;
