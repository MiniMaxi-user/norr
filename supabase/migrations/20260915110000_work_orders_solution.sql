-- `work_orders.solution` — free-text resolution/fix field, written by the
-- field engineer on the Sign-off tab when finishing a work order via the PWA
-- (`apps/pwa`), then surfaced read-only on the work order in the main
-- desktop web app. Exact same shape/reasoning as `activities.solution`
-- (`20260905090000_activity_solution_and_quote_created_event.sql`) — nullable
-- `text`, no CHECK constraint (app-layer length cap only), same
-- grant-insert/grant-update pattern — but this is the WORK-ORDER-level
-- equivalent, not a reuse of `activities.solution`: not every work order has
-- a `source_activity_id` (see `20260829090000_work_orders_source_activity_
-- id.sql`, nullable FK), so a work order created without a source activity
-- would have nowhere to store its own solution if this only lived on
-- `activities`.
--
-- No RLS change: `work_orders_update_scoped` (existing policy,
-- `20260823120000_work_orders_core.sql`) already restricts writes to the
-- caller's own assigned/organization-scoped row; this column only needs the
-- column-level grant below to be writable at all, same as every other
-- `work_orders` column.
alter table public.work_orders
  add column solution text;

comment on column public.work_orders.solution is
  'Free-text record of how this work order was resolved/fixed, written by the field engineer on the Sign-off tab when finishing the work order via the PWA. Nullable, OPTIONAL (no not-null, no check constraint): a work order starts without a solution and only gets one once completed. Length capped at the application layer only, matching the activities.solution precedent (20260905090000_activity_solution_and_quote_created_event.sql). This is the work-order-level equivalent of activities.solution, not a reuse of it — not every work order has a source_activity_id.';

-- Full re-issue of work_orders'' current INSERT/UPDATE column-level grants
-- (same "re-issue the full list" pattern used by every prior migration that
-- added a writable column to this locked-down table, most recently
-- 20260915100000_work_orders_type_and_duration.sql) with `solution` added.
grant insert (
  id, client_id, site_id, asset_id, assigned_to, title, description, notes,
  status_id, priority_id, type_id, scheduled_at, completed_at,
  duration_minutes, contract_id, source_quote_id, source_activity_id,
  solution
) on public.work_orders to authenticated;
grant update (
  client_id, site_id, asset_id, assigned_to, title, description, notes,
  status_id, priority_id, type_id, scheduled_at, completed_at,
  duration_minutes, contract_id, source_quote_id, source_activity_id,
  solution
) on public.work_orders to authenticated;
