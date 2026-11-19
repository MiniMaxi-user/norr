-- Engineer-created work orders from the PWA (issue #223).
--
-- Engineers have no INSERT policy on work_orders (owner/planner only) and their
-- SELECT is scoped to assigned_to = auth.uid(), so a direct insert path would
-- be both forbidden and unreadable for unassigned rows. Instead a single
-- SECURITY DEFINER function is the ONLY engineer create path. RLS policies are
-- untouched.
--
-- Design notes:
-- 1. organization_id is derived from p_client_id; caller must be an `engineer`
--    member of that org (owner/planner use the web UI; others rejected). A
--    cross-org client therefore fails the membership check (42501) and leaks
--    nothing about the client.
-- 2. Client, site and asset are all required; site must belong to the client,
--    asset to the site. Type must be an active activity_type item of the org
--    with value storing/onderhoud/inspectie.
-- 3. Creates the source activity (open, reported_by/action_holder = caller) and
--    the work order linked via source_activity_id, atomically. external_reference
--    = type label, mirroring the activity -> work order web flow.
-- 4. p_assign_to_self: assigned_to = caller, scheduled_at = now() floored to
--    the half hour (planning slots), status = 'scheduled'. Otherwise unassigned,
--    unscheduled, default status ('new'). Number/duration/priority are filled by
--    the existing BEFORE INSERT triggers.
-- 5. The function runs as its owner (bypasses RLS), but auth.uid() is still the
--    caller, so created_by/reported_by stamping triggers and the approved_at
--    guard behave normally (approved_at is never set here).
-- 6. Error codes: 42501 permission/not-authenticated; 22023 validation.

create or replace function public.create_field_work_order(
  p_client_id uuid,
  p_site_id uuid,
  p_asset_id uuid,
  p_type_id uuid,
  p_description text,
  p_assign_to_self boolean default false
)
returns table (work_order_id uuid, work_order_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_role public.membership_role;
  v_desc text := btrim(coalesce(p_description, ''));
  v_type_value text;
  v_type_label text;
  v_activity_id uuid;
  v_activity_status_id uuid;
  v_wo_status_id uuid;
  v_wo_id uuid;
  v_wo_number text;
  v_scheduled_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_client_id is null or p_site_id is null or p_asset_id is null or p_type_id is null then
    raise exception 'Client, site, asset and type are required' using errcode = '22023';
  end if;

  select c.organization_id into v_org_id from public.clients c where c.id = p_client_id;

  select m.role into v_role
  from public.memberships m
  where m.user_id = v_uid and m.organization_id = v_org_id;

  if v_org_id is null or v_role is null then
    raise exception 'You do not have access to this client' using errcode = '42501';
  end if;
  if v_role::text <> 'engineer' then
    raise exception 'Only engineers can create work orders this way' using errcode = '42501';
  end if;

  if v_desc = '' then
    raise exception 'Description is required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.sites s where s.id = p_site_id and s.client_id = p_client_id) then
    raise exception 'Site does not belong to this client' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.assets a
    where a.id = p_asset_id and a.site_id = p_site_id and a.client_id = p_client_id
  ) then
    raise exception 'Asset does not belong to this site' using errcode = '22023';
  end if;

  select rli.value, rli.label into v_type_value, v_type_label
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rli.id = p_type_id
    and rl.organization_id = v_org_id
    and rl.list_key = 'activity_type'
    and rli.is_active;

  if v_type_value is null or v_type_value not in ('storing', 'onderhoud', 'inspectie') then
    raise exception 'Invalid work order type (must be an active Storing, Onderhoud or Inspectie type)'
      using errcode = '22023';
  end if;

  select rli.id into v_activity_status_id
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rl.organization_id = v_org_id and rl.list_key = 'activity_status' and rli.value = 'open';
  -- null falls through to the activities default-status trigger.

  insert into public.activities (
    client_id, asset_id, type_id, status_id, description, action_holder_id, reported_at
  ) values (
    p_client_id, p_asset_id, p_type_id, v_activity_status_id, v_desc, v_uid, now()
  )
  returning activities.id into v_activity_id;

  if p_assign_to_self then
    v_scheduled_at := to_timestamp(floor(extract(epoch from now()) / 1800) * 1800);
    select rli.id into v_wo_status_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rl.organization_id = v_org_id and rl.list_key = 'work_order_status' and rli.value = 'scheduled';
    -- null falls through to the default status trigger.
  end if;

  insert into public.work_orders (
    client_id, site_id, asset_id, type_id, description, external_reference,
    source_activity_id, assigned_to, scheduled_at, status_id
  ) values (
    p_client_id, p_site_id, p_asset_id, p_type_id, v_desc, v_type_label,
    v_activity_id,
    case when p_assign_to_self then v_uid end,
    v_scheduled_at,
    v_wo_status_id
  )
  returning work_orders.id, work_orders.work_order_number into v_wo_id, v_wo_number;

  work_order_id := v_wo_id;
  work_order_number := v_wo_number;
  return next;
end;
$$;

comment on function public.create_field_work_order(uuid, uuid, uuid, uuid, text, boolean) is
  'Issue #223: the only engineer path to create a work order (PWA). SECURITY DEFINER; caller must be an engineer member of the client''s org. Requires client+site+asset+type (type value storing/onderhoud/inspectie, active) and a non-empty description. Atomically creates an open activity (reported_by/action_holder = caller) and a linked work order; p_assign_to_self assigns it to the caller, scheduled at now() floored to the half hour with status scheduled, otherwise unassigned/unscheduled/default status. Errors: 42501 permission, 22023 validation.';

revoke all on function public.create_field_work_order(uuid, uuid, uuid, uuid, text, boolean) from public, anon;
grant execute on function public.create_field_work_order(uuid, uuid, uuid, uuid, text, boolean) to authenticated;
