-- Planning module schema prerequisite, part 2 of 2 (issue #164, "Planning" —
-- drag-and-drop scheduler). Adds `work_orders.type_id` and
-- `work_orders.duration_minutes`, both denormalized onto Work Orders the
-- same way `status_id`/`priority_id` already are, so the scheduler board can
-- read/filter/render a work order's type and block-length directly off the
-- `work_orders` row with no join. See `20260915090000_region_reference_
-- list.sql` for part 1 (`region` reference list, `sites`/`memberships.
-- region_id`).
--
-- Design decisions:
--
-- 1. **`type_id` reuses the EXISTING `activity_type` reference list**, not a
--    new `work_order_type` list. A work order's type is meant to mirror the
--    Activity/Melding type it originated from (`bel_activiteit`/`storing`/
--    `onderhoud`/`afspraak`/`email_opvolging`/the new `inspectie`, added by
--    `20260915090000_region_reference_list.sql`) — one tenant-configurable
--    taxonomy for "kind of job," reused across both entities, not two
--    parallel lists that could drift apart. Validated by extending
--    `validate_work_order_reference_items` with a `type_id` check identical
--    in shape to its existing `status_id`/`priority_id` checks.
-- 2. **`duration_minutes integer`**, nullable, `>= 0` when set (no `NOT
--    NULL`, no "required" CHECK) — the scheduler block length in minutes.
--    Staying nullable/unenforced at the DB layer is deliberate: "duration
--    required before scheduling" (if the product ever wants that) is an
--    application-layer rule for a later story, not this schema
--    prerequisite's job.
-- 3. **Auto-fill, folded into `derive_work_order_organization_id`** (not a
--    new trigger) — same trigger-ordering reason every other
--    `work_orders` default-fill (e.g. `status_id`) is folded into this
--    trigger: `organization_id` must be known first, and this trigger
--    already runs before `validate_work_order_reference_items`/`validate_
--    work_order_relations` (alphabetically earlier name, same BEFORE INSERT
--    OR UPDATE OF client_id timing).
--      - `type_id`, when omitted, is copied from the linked
--        `source_activity_id`'s own `type_id` (a work order created from an
--        Activity inherits its type by default).
--      - `duration_minutes`, when omitted AND `type_id` is known (whether
--        supplied directly or just auto-filled above), is copied from that
--        type's own `reference_list_items.default_duration_minutes` (issue
--        #165, `20260914090000_reference_list_items_default_duration_
--        minutes.sql`).
--    Both fills only ever run when their OWN target column is still null —
--    same "fill only if absent" guard `status_id`'s existing fill already
--    uses. This trigger's firing column list stays `OF client_id` only (NOT
--    widened to `type_id`/`duration_minutes`/`source_activity_id`) — a
--    column-specific BEFORE trigger fires unconditionally on every INSERT
--    regardless of its `OF <column>` list (that clause only matters for
--    UPDATE), so both fills still run at creation time; a later, standalone
--    `UPDATE ... SET type_id = ...` or `UPDATE ... SET duration_minutes =
--    ...` (not touching `client_id`) does NOT re-fire this trigger at all,
--    so both fields stay independently, silently-non-overwritten editable
--    after creation, per the acceptance criteria.
-- 4. **Grants**: `work_orders` already has column-level INSERT/UPDATE grant
--    lockdown (`20260823120000_work_orders_core.sql`) — the full current
--    grant lists are re-issued below with `type_id`/`duration_minutes`
--    added, same "re-issue the full list" pattern used whenever a
--    locked-down table gains new writable columns.
-- 5. `duration_minutes` deliberately stays nullable with no required-ness
--    CHECK (design note 2) — enforced at the application layer in a later
--    step, not here.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.work_orders
  add column type_id uuid references public.reference_list_items(id),
  add column duration_minutes integer,
  add constraint work_orders_duration_minutes_non_negative
    check (duration_minutes is null or duration_minutes >= 0);

comment on column public.work_orders.type_id is
  'Nullable FK into reference_list_items, reusing the SAME activity_type reference list as activities.type_id (not a separate work_order_type list) — issue #164, Planning module. When omitted on insert, auto-filled from the linked source_activity_id''s own type_id (derive_work_order_organization_id); freely editable afterward without being silently re-derived. Validated by validate_work_order_reference_items to belong to the work order''s own organization_id and the activity_type list_key.';
comment on column public.work_orders.duration_minutes is
  'Nullable, >= 0 when set (work_orders_duration_minutes_non_negative) — the scheduler block length in minutes (issue #164, Planning module). When omitted on insert and type_id is known (supplied or auto-filled), auto-filled from that type''s reference_list_items.default_duration_minutes (issue #165); freely editable afterward without being silently re-derived. No NOT NULL / required-ness CHECK — "duration required before scheduling," if ever needed, is an application-layer rule for a later story.';

create index work_orders_type_id_idx on public.work_orders (type_id);

-- Full re-issue of work_orders' current INSERT/UPDATE column-level grants
-- (design note 4 above) with type_id/duration_minutes added. `id` remains in
-- the INSERT list per 20260823120000_work_orders_core.sql's own documented
-- reasoning (explicit column lists require privilege on that column even
-- when the value matches the DEFAULT). organization_id/created_by remain
-- excluded (derived/stamped by trigger, never client-writable).
grant insert (
  id, client_id, site_id, asset_id, assigned_to, title, description, notes,
  status_id, priority_id, type_id, scheduled_at, completed_at,
  duration_minutes, contract_id, source_quote_id, source_activity_id
) on public.work_orders to authenticated;
grant update (
  client_id, site_id, asset_id, assigned_to, title, description, notes,
  status_id, priority_id, type_id, scheduled_at, completed_at,
  duration_minutes, contract_id, source_quote_id, source_activity_id
) on public.work_orders to authenticated;

-- ---------------------------------------------------------------------------
-- 2. validate_work_order_reference_items: extend with a type_id check,
--    identical in shape to the existing status_id/priority_id checks. Full
--    body copied forward from 20260823120000_work_orders_core.sql (the only
--    migration that has ever defined this function — confirmed by grepping
--    every migration for `create or replace function public.validate_work_
--    order_reference_items`), with the new check and declarations added and
--    every existing check preserved verbatim.
-- ---------------------------------------------------------------------------
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
  v_type_org uuid;
  v_type_key text;
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

  if new.type_id is not null then
    select rl.organization_id, rl.list_key into v_type_org, v_type_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.type_id;

    if v_type_org is null then
      raise exception 'work_orders.type_id % does not reference an existing reference_list_items row', new.type_id
        using errcode = '23503';
    elsif v_type_key <> 'activity_type' then
      raise exception 'work_orders.type_id must reference an item from the activity_type reference list (got list_key=%)', v_type_key
        using errcode = '23514';
    elsif v_type_org <> new.organization_id then
      raise exception 'work_orders.type_id must belong to the same organization as the work order'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_work_order_reference_items() is
  'BEFORE INSERT/UPDATE OF status_id, priority_id, type_id trigger on public.work_orders: rejects an item from the wrong list_key or a different organization''s reference list. Extended in 20260915100000_work_orders_type_and_duration.sql (issue #164, Planning module) with the type_id check — type_id deliberately reuses the existing activity_type reference list (not a new work_order_type list), the same list type_id is auto-filled from (via source_activity_id) by derive_work_order_organization_id. Runs after derive_work_order_organization_id (alphabetically later trigger name, same timing), so new.organization_id (and the default-filled status_id/type_id) are already final.';

drop trigger if exists work_orders_validate_reference_items on public.work_orders;

create trigger work_orders_validate_reference_items
  before insert or update of status_id, priority_id, type_id on public.work_orders
  for each row execute function public.validate_work_order_reference_items();

-- ---------------------------------------------------------------------------
-- 3. derive_work_order_organization_id: extend with the type_id/
--    duration_minutes auto-fill (design note 3 above). Full body copied
--    forward from 20260823120000_work_orders_core.sql (the only migration
--    that has ever defined this function — confirmed by grepping every
--    migration for `create or replace function public.derive_work_order_
--    organization_id`, including 20260829090000_work_orders_source_
--    activity_id.sql, which added source_activity_id but only extended
--    validate_work_order_relations, not this function). Trigger's own `OF
--    client_id` firing-column list is UNCHANGED (see design note 3 — an
--    INSERT-time-only effective widening, not a real column-list widening).
-- ---------------------------------------------------------------------------
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

  if new.type_id is null and new.source_activity_id is not null then
    select a.type_id into new.type_id from public.activities a where a.id = new.source_activity_id;
  end if;

  if new.duration_minutes is null and new.type_id is not null then
    select rli.default_duration_minutes into new.duration_minutes
    from public.reference_list_items rli where rli.id = new.type_id;
  end if;

  return new;
end;
$$;

comment on function public.derive_work_order_organization_id() is
  'BEFORE INSERT/UPDATE OF client_id trigger on public.work_orders: sets organization_id from the referenced client, blocks cross-organization re-parenting, fills in status_id with the organization''s default work_order_status item when the caller omitted it, and (issue #164, Planning module, 20260915100000_work_orders_type_and_duration.sql) fills in type_id from the linked source_activity_id''s own type_id when omitted, then fills in duration_minutes from that (possibly just-filled) type''s reference_list_items.default_duration_minutes when omitted. The type_id/duration_minutes fills are effectively INSERT-only in practice: this trigger''s firing column list (OF client_id) means a bare UPDATE of type_id/duration_minutes/source_activity_id alone does not re-fire it, and both fill conditions additionally require their own target column to still be null — so both fields remain independently, silently-non-overwritten editable after creation. Runs before validate_work_order_relations/validate_work_order_reference_items (alphabetically earlier trigger name, same timing), so organization_id, status_id, type_id, and duration_minutes are already final by the time those run.';
