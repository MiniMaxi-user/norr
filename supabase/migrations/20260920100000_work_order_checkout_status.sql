-- Work Order "Checkout" status (issue #203, "Checkout workitem naar pwa").
-- Schema-only prerequisite for locking a scheduled work order against
-- further Planning-board reshuffling once the assigned engineer's PWA has
-- actually pulled its full detail. Two additive pieces:
--
-- 1. A new `checkout` item in the `work_order_status` reference list,
--    inserted between `scheduled` and `en_route` in the lifecycle:
--      New -> Scheduled -> Checkout -> En Route -> In Progress -> Completed -> Invoiced
--    `sort_order` renumbered accordingly (en_route/in_progress/completed/
--    invoiced all shift up by 1), for both `seed_default_reference_lists`
--    (future organizations) and a one-time backfill for every organization
--    that already existed (existing organizations' rows).
-- 2. `public.checkout_work_order_if_scheduled(p_work_order_id uuid)` — a
--    safe, idempotent SECURITY DEFINER transition function: if (and only
--    if) the calling user is that work order's own `assigned_to` AND its
--    current status is exactly `scheduled`, flips `status_id` to the
--    `checkout` item. Every other case (not the assignee, already
--    `checkout` or later, still `new`, dangling id) is a silent no-op —
--    never an exception — since this is meant to be called unconditionally
--    on every GET of a work order's detail.
--
-- Design notes:
--
-- 1. **Seed extension via full-body copy-forward.** Per the standing "copy
--    the full live function body forward, don't reconstruct by hand" rule
--    (see `20260907100000_fix_seed_default_reference_lists_regression_3.sql`'s
--    header, after FOUR prior regression incidents). Confirmed
--    `20260919090000_translate_default_reference_list_labels_to_english.sql`
--    is still the true latest redefinition of `seed_default_reference_lists`
--    by grepping every migration for `create or replace function
--    public.seed_default_reference_lists` and finding no later one. The body
--    below is that migration's full body with exactly one change: the
--    `work_order_status` block's insert values list gets a new `checkout`
--    row inserted in lifecycle position, with `en_route`/`in_progress`/
--    `completed`/`invoiced`'s `sort_order` values shifted from 3/4/5/6 to
--    4/5/6/7. No other list_key block, and no other function logic, was
--    altered.
-- 2. **Existing-organization backfill renumbers `sort_order` too, not just
--    inserts the new item.** Unlike every prior "append a new item at the
--    end of a list" precedent in this codebase (`inspectie` appended to
--    `activity_type` at sort_order 6, `intern_werkplaats` appended to
--    `region` at sort_order 4), `checkout` is inserted in the MIDDLE of an
--    already-seeded, already-ordered lifecycle list, so the backfill loop
--    below explicitly UPDATEs each existing organization's `en_route`/
--    `in_progress`/`completed`/`invoiced` rows to their new `sort_order`
--    (scoped by `value = ... and sort_order = <the exact prior default>`,
--    so — same "never clobber a tenant's own customization" discipline as
--    `ensure_reference_list_defaults`/the English-label backfill — an
--    organization that has already hand-reordered its own `work_order_status`
--    list away from the shipped default is left untouched) before inserting
--    the new `checkout` row at `sort_order = 3`.
-- 3. **`checkout_work_order_if_scheduled` is SECURITY DEFINER by deliberate
--    choice, not RLS necessity.** `work_orders_update_scoped`
--    (`20260823120000_work_orders_core.sql`) already lets an engineer UPDATE
--    their own assigned row, and `status_id` is already in that table's
--    engineer-reachable UPDATE column grant — so a plain RLS-scoped UPDATE
--    from the PWA route's own session would technically work too. This
--    function is used anyway, matching this repo's existing precedent of a
--    single, narrow, auditable SECURITY DEFINER mutation path for one
--    specific transition (`resolve_billing_rate`, `compute_rounded_minutes`,
--    `next_invoice_number`) rather than relying on the general UPDATE grant:
--    the row's `assigned_to`/current-status checks happen once, inside the
--    function, instead of being re-derived by every caller: silent no-op
--    on wrong caller, wrong status, or a dangling id — this is called
--    unconditionally on every single GET of a work order's detail (including
--    ones already `checkout` or later, or still `new`), so it must never
--    raise.
-- 4. **Not this migration's job (flagged for the follow-up passes named in
--    the header of design note 3 above):**
--    a. `api-backend-engineer`: the PWA's `GET /api/work-orders/[id]` route
--       (`apps/pwa/app/api/work-orders/[id]/route.ts`) should call
--       `select public.checkout_work_order_if_scheduled($1)` (passing the
--       work order id) on every fetch, under the caller's own session —
--       unconditionally, before or after the existing read, since the
--       function is a no-op whenever it doesn't apply.
--    b. `api-backend-engineer`: `scheduleWorkOrder`/`unscheduleWorkOrder`
--       (`app/(app)/work-orders/planning-actions.ts`) and
--       `updateWorkOrder`/`deleteWorkOrder` (`app/(app)/work-orders/actions.ts`)
--       need an application-layer guard that rejects the action with a clear
--       message when the target work order's CURRENT status has a
--       `sort_order >= ` the org's `work_order_status` list's `checkout`
--       item's `sort_order` — not just an exact string match on `checkout` —
--       so `en_route`/`in_progress`/`completed`/`invoiced` are covered too,
--       not just the exact `checkout` state.
--    c. `frontend-ui-engineer`: the Planning board's lock icon/drag-still-
--       allowed-but-drop-rejected UX (reusing `planning-screen.tsx`'s
--       existing optimistic-revert-plus-inline-error pattern for rejected
--       drops), and the work order detail page's read-only-when-locked
--       treatment for "Create quote", Edit buttons, and Travel/Work/Articles
--       editing/Delete.
--    None of (a)/(b)/(c) are touched by this migration.
-- 5. **NULL-safe `auth.uid()` guard, plus an explicit `anon` revoke.**
--    Confirmed live (via `information_schema.routine_privileges`) that this
--    project's `public` schema grants `EXECUTE` to `anon` automatically on
--    every newly created function — the exact same "grants ALL to
--    authenticated/anon by default on new objects" gotcha this codebase has
--    repeatedly hit for TABLES (see the two `fix_*_column_grants`
--    migrations), just not previously noticed for functions because
--    `resolve_billing_rate`/`next_invoice_number` don't gate solely on
--    `auth.uid()` the way this function does. `revoke all ... from public`
--    does NOT remove it (that revokes the PUBLIC pseudo-role's grant, not
--    `anon`'s own separate direct grant) — so `anon` is revoked explicitly
--    below, defense-in-depth. More importantly, an anonymous caller has
--    `auth.uid() is null`, and a naive `v_assigned_to is null or
--    v_assigned_to <> auth.uid()` guard evaluates to SQL NULL (not TRUE) in
--    that case — and `IF NULL THEN` is treated as FALSE in plpgsql, silently
--    skipping the intended `return`, not blocking it. Confirmed live before
--    shipping (a throwaway CASE expression against `gen_random_uuid() <>
--    null::uuid` evaluated to the "bypassed" branch). Fixed by checking
--    `auth.uid() is null` first, then using `is distinct from` (NULL-safe,
--    never itself evaluates to NULL) for the assignee comparison.

-- ---------------------------------------------------------------------------
-- Part 1: seed_default_reference_lists — `checkout` inserted into
-- `work_order_status` at lifecycle position 3 (design note 1 above). Full
-- body copied forward from
-- 20260919090000_translate_default_reference_list_labels_to_english.sql
-- verbatim, with only the `work_order_status` block's insert values list
-- changed.
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
  -- lifecycle: New (default) -> Scheduled -> Checkout -> En Route ->
  -- In Progress -> Completed -> Invoiced. `checkout` added by issue #203
  -- ("Checkout workitem naar pwa") — the assigned engineer's PWA fetching
  -- this specific work order's full detail while it's still `scheduled`
  -- transitions it here (see checkout_work_order_if_scheduled below), after
  -- which the Planning board can no longer reshuffle it.
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
    (v_work_order_status_list_id, p_organization_id, 'completed', 'Completed', 6, false),
    (v_work_order_status_list_id, p_organization_id, 'invoiced', 'Invoiced', 7, false)
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
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_billing_terms_list_id, p_organization_id, 'monthly', 'Monthly', 1, true),
    (v_billing_terms_list_id, p_organization_id, 'quarterly', 'Quarterly', 2, false),
    (v_billing_terms_list_id, p_organization_id, 'annually', 'Annually', 3, false),
    (v_billing_terms_list_id, p_organization_id, 'per_visit', 'Per-visit', 4, false),
    (v_billing_terms_list_id, p_organization_id, 'one_time', 'One-time', 5, false)
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
  -- (default) -> Sent -> Accepted / Rejected / Expired.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'quote_status', 'Quote Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_quote_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'quote_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_quote_status_list_id, p_organization_id, 'draft', 'Draft', 1, true),
    (v_quote_status_list_id, p_organization_id, 'sent', 'Sent', 2, false),
    (v_quote_status_list_id, p_organization_id, 'accepted', 'Accepted', 3, false),
    (v_quote_status_list_id, p_organization_id, 'rejected', 'Rejected', 4, false),
    (v_quote_status_list_id, p_organization_id, 'expired', 'Expired', 5, false)
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
    (reference_list_id, organization_id, value, label, sort_order, is_default, icon)
  values
    (v_activity_type_list_id, p_organization_id, 'bel_activiteit', 'Call activity', 1, false, 'Phone'),
    (v_activity_type_list_id, p_organization_id, 'storing', 'Breakdown', 2, false, 'AlertTriangle'),
    (v_activity_type_list_id, p_organization_id, 'onderhoud', 'Maintenance', 3, false, 'Settings'),
    (v_activity_type_list_id, p_organization_id, 'afspraak', 'Appointment', 4, false, 'CalendarDays'),
    (v_activity_type_list_id, p_organization_id, 'email_opvolging', 'Email follow-up', 5, false, 'Mail')
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
    (reference_list_id, organization_id, value, label, sort_order, icon)
  values
    (v_activity_type_list_id, p_organization_id, 'inspectie', 'Inspection', 6, 'Search')
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

  -- Self-heal: re-verify every list above (plus any earlier picklist) still
  -- has its intended default item, in case is_default was reset outside this
  -- function's control (see 20260907100000_fix_seed_default_reference_lists_
  -- regression_3.sql's header for the full mechanism). Preserved verbatim —
  -- region/volume have no is_default concept, so neither needs an entry here
  -- (same as asset_subtype/sla_tier).
  perform public.ensure_reference_list_defaults(p_organization_id);
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout, except activity_type''s icon backfill which uses on conflict do update). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Also calls ensure_reference_list_defaults(p_organization_id) at the end (restored here — see 20260907100000_fix_seed_default_reference_lists_regression_3.sql''s header, BUG 1/BUG 2), so every seed/backfill call self-heals any is_default gap for that organization, not just seeds brand-new list_keys. Restored in 20260907100000_fix_seed_default_reference_lists_regression_3.sql: 20260905100000_contracts_billing_period_line_items_and_article_rules.sql''s own CREATE OR REPLACE had accidentally dropped several list_key blocks AND the trailing ensure_reference_list_defaults call (the FOURTH time this class of regression has happened — see that fix migration''s design note for the full incident history and the "copy the full live function body forward via pg_get_functiondef, don''t reconstruct by hand" guidance). Extended in 20260910090000_reference_list_items_description_active_and_volume_list.sql with a `volume` block (issue #131). Extended in 20260915090000_region_reference_list.sql (issue #164) with a `region` block and a new `inspectie` activity_type item. Extended in 20260918090000_service_area_seed_and_work_regions.sql (issue #192) with a 4th `region` item, `intern_werkplaats`. Extended in 20260919090000_translate_default_reference_list_labels_to_english.sql (issue #196): translated remaining Dutch default labels to English. Extended in 20260920100000_work_order_checkout_status.sql (issue #203, "Checkout workitem naar pwa"): inserted a new `checkout` item into `work_order_status` between `scheduled` and `en_route` (sort_order 3; `en_route`/`in_progress`/`completed`/`invoiced` shifted from 3/4/5/6 to 4/5/6/7) — the assigned engineer''s PWA fetching a `scheduled` work order''s full detail transitions it here (checkout_work_order_if_scheduled), after which the Planning board can no longer reshuffle it (application-layer guard, a follow-up outside this migration). Future picklists should extend this function the same way (a new list_key block, plus a row in ensure_reference_list_defaults'' values list if it needs a default), plus a one-time backfill call in that feature''s own migration.';

-- ---------------------------------------------------------------------------
-- Backfill, part A: seed the `checkout` item (and self-heal any is_default
-- gap, via the function's own trailing call) for every organization that
-- already existed before this migration ran — the
-- organizations_seed_reference_lists trigger only fires for future inserts.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform public.seed_default_reference_lists(r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill, part B: renumber sort_order on every existing organization's
-- ALREADY-SEEDED work_order_status items to make room for `checkout` at
-- position 3 (design note 2 above). Each UPDATE is scoped by
-- (value, OLD sort_order) so an organization that has already hand-reordered
-- this list away from the shipped default is left untouched — same
-- "never clobber a tenant's own customization" discipline as
-- ensure_reference_list_defaults / the English-label backfill migration.
-- Must run AFTER part A (so every organization's work_order_status list is
-- guaranteed to already contain the new `checkout` row by the time this
-- runs, even though these UPDATEs don't themselves touch that row).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_status_list_id uuid;
begin
  for r in select id from public.organizations loop
    select id into v_status_list_id
    from public.reference_lists
    where organization_id = r.id and list_key = 'work_order_status';

    if v_status_list_id is not null then
      update public.reference_list_items
      set sort_order = 7
      where reference_list_id = v_status_list_id
        and value = 'invoiced'
        and sort_order = 6;

      update public.reference_list_items
      set sort_order = 6
      where reference_list_id = v_status_list_id
        and value = 'completed'
        and sort_order = 5;

      update public.reference_list_items
      set sort_order = 5
      where reference_list_id = v_status_list_id
        and value = 'in_progress'
        and sort_order = 4;

      update public.reference_list_items
      set sort_order = 4
      where reference_list_id = v_status_list_id
        and value = 'en_route'
        and sort_order = 3;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Part 2: checkout_work_order_if_scheduled (design note 3 above). Called
-- unconditionally by the PWA's GET /api/work-orders/[id] route (follow-up,
-- design note 4a) on every fetch of a work order's full detail.
-- ---------------------------------------------------------------------------
create or replace function public.checkout_work_order_if_scheduled(p_work_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_assigned_to uuid;
  v_status_id uuid;
  v_status_value text;
  v_checkout_item_id uuid;
begin
  select organization_id, assigned_to, status_id
  into v_org_id, v_assigned_to, v_status_id
  from public.work_orders
  where id = p_work_order_id;

  -- Dangling/unknown work order id: silent no-op (never raise — this is
  -- called unconditionally from the PWA route on every GET).
  if v_org_id is null then
    return;
  end if;

  -- No authenticated caller at all (e.g. an anon-role call — see design note
  -- 5 in this migration's header for why anon can reach this function's
  -- EXECUTE grant despite the explicit revoke below): silent no-op.
  if auth.uid() is null then
    return;
  end if;

  -- Not this work order's own assignee: silent no-op. Deliberately not an
  -- error, since this must never become a way for one engineer to poke
  -- another's work order by guessing/enumerating ids. `is distinct from`
  -- (not `<>`) is required here, NULL-safe by construction — see design
  -- note 5.
  if v_assigned_to is distinct from auth.uid() then
    return;
  end if;

  select value into v_status_value
  from public.reference_list_items
  where id = v_status_id;

  -- Only a currently-`scheduled` work order transitions. Anything else
  -- (still `new`, or already `checkout`/`en_route`/`in_progress`/
  -- `completed`/`invoiced`) is a no-op — idempotent, safe to call on every
  -- single GET regardless of the work order's current lifecycle position.
  if v_status_value is distinct from 'scheduled' then
    return;
  end if;

  select rli.id into v_checkout_item_id
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rl.organization_id = v_org_id
    and rl.list_key = 'work_order_status'
    and rli.value = 'checkout';

  -- Defensive: should always exist after seed_default_reference_lists, but
  -- never raise from this path if it's somehow missing.
  if v_checkout_item_id is null then
    return;
  end if;

  update public.work_orders
  set status_id = v_checkout_item_id
  where id = p_work_order_id;
end;
$$;

comment on function public.checkout_work_order_if_scheduled(uuid) is
  'Issue #203 ("Checkout workitem naar pwa"): SECURITY DEFINER, idempotent transition — flips a work order''s status_id from `scheduled` to `checkout` (work_order_status reference list) if and only if the calling user (auth.uid()) is that row''s own assigned_to AND its current status is exactly `scheduled`; every other case (not the assignee, dangling id, already checkout-or-later, still new) is a silent no-op, never an exception. SECURITY DEFINER by deliberate choice (not strict RLS necessity — work_orders_update_scoped + the engineer UPDATE column grant already allow status_id on the caller''s own assigned row), matching this repo''s existing precedent of a single, narrow, auditable SECURITY DEFINER mutation path (resolve_billing_rate, compute_rounded_minutes, next_invoice_number) rather than relying on the general UPDATE grant. Intended caller: the PWA''s GET /api/work-orders/[id] route, unconditionally on every fetch (a follow-up outside this migration — see this migration''s header design note 4a).';

-- `revoke all ... from public` alone does not strip `anon`'s own separate
-- direct EXECUTE grant (this project's schema auto-grants EXECUTE to `anon`
-- on new functions, same gotcha as tables — see design note 5 above) —
-- revoked explicitly, defense-in-depth on top of the NULL-safe auth.uid()
-- guard inside the function body itself.
revoke all on function public.checkout_work_order_if_scheduled(uuid) from public;
revoke all on function public.checkout_work_order_if_scheduled(uuid) from anon;
grant execute on function public.checkout_work_order_if_scheduled(uuid) to authenticated;
