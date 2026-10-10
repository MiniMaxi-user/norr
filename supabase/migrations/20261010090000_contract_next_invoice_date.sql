-- Issue #209: contracts get a "next invoice date".
--
-- Design notes:
--
-- 1. The invoice interval comes from contracts.billing_terms_id (reference
--    list `billing_terms`), NOT billing_period_id. To make it tenant-
--    configurable, reference_list_items gets a generic nullable attribute
--    `interval_months integer` (check > 0 when set), same precedent as
--    default_duration_minutes
--    (20260914090000_reference_list_items_default_duration_minutes.sql).
--    Existing orgs' billing_terms items are backfilled: monthly=1,
--    quarterly=3, annually=12; per_visit/one_time stay null (non-recurring).
--    Column grants on reference_list_items are re-issued in full, copying the
--    newest grant lists (default_duration_minutes migration; no later
--    migration re-grants this table) plus interval_months.
-- 2. contracts gets two columns, neither client-writable (excluded from the
--    column grants; SELECT works via the table-level select grant):
--      invoiced_period_count integer not null default 0 check (>= 0)
--        -- advanced by a future invoicing story (no advance function here).
--      next_invoice_date date null
--        -- always derived by the contracts_compute_next_invoice_date BEFORE
--        -- INSERT OR UPDATE trigger (compute_contract_next_invoice_date()):
--        --   interval null  -> start_date if invoiced_period_count = 0, else null
--        --   interval set   -> start_date + count * interval months
--        --   end_date set and next > end_date -> null (fully invoiced)
--    A CHECK (contracts_next_invoice_date_within_end_date) enforces that the
--    date is never after end_date.
-- 3. Recompute on config change: an AFTER UPDATE OF interval_months trigger on
--    reference_list_items touches the contracts using that item. The reasoning
--    that led 20260921100000 to drop the coverage resync triggers (prices
--    frozen at write time must not be recalculated retroactively) does not
--    apply: next_invoice_date is a derived scheduling value, not a frozen
--    historical amount, and must follow the tenant's interval setting.
--    contracts.billing_terms_id is already indexed
--    (contracts_billing_terms_id_idx), so the touch is cheap.
-- 4. No new tables, no RLS change: existing contracts/reference_list_items
--    policies cover the new columns.

alter table public.reference_list_items
  add column interval_months integer,
  add constraint reference_list_items_interval_months_positive
    check (interval_months is null or interval_months > 0);

comment on column public.reference_list_items.interval_months is
  'Generic optional per-item attribute: recurrence interval in months. Currently used by the billing_terms list (issue #209): contracts.next_invoice_date advances by this many months per invoiced period. Null means non-recurring (per_visit, one_time). When set, must be > 0.';

revoke all on public.reference_list_items from authenticated;
grant select, delete on public.reference_list_items to authenticated;
grant insert (
  reference_list_id, value, label, color, icon, sort_order, is_default,
  parent_item_id, description, is_active, default_duration_minutes,
  interval_months
) on public.reference_list_items to authenticated;
grant update (
  value, label, color, icon, sort_order, is_default, parent_item_id,
  description, is_active, default_duration_minutes, interval_months
) on public.reference_list_items to authenticated;

-- Backfill existing organizations' billing_terms items.
update public.reference_list_items i
set interval_months = case i.value
  when 'monthly' then 1
  when 'quarterly' then 3
  when 'annually' then 12
end
from public.reference_lists rl
where rl.id = i.reference_list_id
  and rl.list_key = 'billing_terms'
  and i.value in ('monthly', 'quarterly', 'annually')
  and i.interval_months is null;

-- Seed function: newest definition (20260920120000) copied verbatim; only the
-- billing_terms inserts gain interval_months.
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
  'Idempotent (on conflict do nothing throughout, except activity_type''s icon backfill which uses on conflict do update). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Also calls ensure_reference_list_defaults(p_organization_id) at the end (restored here — see 20260907100000_fix_seed_default_reference_lists_regression_3.sql''s header, BUG 1/BUG 2), so every seed/backfill call self-heals any is_default gap for that organization, not just seeds brand-new list_keys. Restored in 20260907100000_fix_seed_default_reference_lists_regression_3.sql: 20260905100000_contracts_billing_period_line_items_and_article_rules.sql''s own CREATE OR REPLACE had accidentally dropped several list_key blocks AND the trailing ensure_reference_list_defaults call (the FOURTH time this class of regression has happened — see that fix migration''s design note for the full incident history and the "copy the full live function body forward via pg_get_functiondef, don''t reconstruct by hand" guidance). Extended in 20260910090000_reference_list_items_description_active_and_volume_list.sql with a `volume` block (issue #131). Extended in 20260915090000_region_reference_list.sql (issue #164) with a `region` block and a new `inspectie` activity_type item. Extended in 20260918090000_service_area_seed_and_work_regions.sql (issue #192) with a 4th `region` item, `intern_werkplaats`. Extended in 20260919090000_translate_default_reference_list_labels_to_english.sql (issue #196): translated remaining Dutch default labels to English. Extended in 20260920100000_work_order_checkout_status.sql (issue #203, "Checkout workitem naar pwa"): inserted a new `checkout` item into `work_order_status` between `scheduled` and `en_route` (sort_order 3; `en_route`/`in_progress`/`completed`/`invoiced` shifted from 3/4/5/6 to 4/5/6/7). Extended in 20260920110000_work_order_to_review_status.sql: inserted a new `to_review` item into `work_order_status` between `in_progress` and `completed` (sort_order 6; `completed`/`invoiced` shifted from 6/7 to 7/8), label shipped as Dutch (`Te controleren`) at the time. Extended in 20260920120000_work_order_to_review_label_to_english.sql: corrected that `to_review` label from Dutch (`Te controleren`) to English (`To review`), for consistency with every other item in this list and this repo''s "code always English" convention — the earlier "deliberate exception" belief was incorrect; no value slug or sort_order changed. Extended in 20261010090000_contract_next_invoice_date.sql (issue #209): the billing_terms items now carry interval_months (monthly=1, quarterly=3, annually=12, per_visit/one_time null). Future picklists should extend this function the same way (a new list_key block, plus a row in ensure_reference_list_defaults'' values list if it needs a default), plus a one-time backfill call in that feature''s own migration.';
-- ---------------------------------------------------------------------------
-- contracts columns
-- ---------------------------------------------------------------------------
alter table public.contracts
  add column invoiced_period_count integer not null default 0,
  add column next_invoice_date date,
  add constraint contracts_invoiced_period_count_non_negative
    check (invoiced_period_count >= 0);

comment on column public.contracts.invoiced_period_count is
  'Number of billing periods already invoiced. Not client-writable; advanced by the (future) invoicing flow.';
comment on column public.contracts.next_invoice_date is
  'Derived by compute_contract_next_invoice_date() (BEFORE INSERT OR UPDATE): start_date + invoiced_period_count * billing_terms interval_months; start_date if the terms have no interval and nothing is invoiced yet; null when fully invoiced or beyond end_date. Never client-writable.';

create index contracts_org_next_invoice_date_idx
  on public.contracts (organization_id, next_invoice_date)
  where next_invoice_date is not null;

create or replace function public.compute_contract_next_invoice_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_interval integer;
  v_next date;
begin
  if new.billing_terms_id is not null then
    select interval_months into v_interval
    from public.reference_list_items
    where id = new.billing_terms_id;
  end if;

  if v_interval is null then
    v_next := case when new.invoiced_period_count = 0 then new.start_date else null end;
  else
    v_next := (new.start_date + make_interval(months => new.invoiced_period_count * v_interval))::date;
  end if;

  if new.end_date is not null and v_next is not null and v_next > new.end_date then
    v_next := null;
  end if;

  new.next_invoice_date := v_next;
  return new;
end;
$fn$;

comment on function public.compute_contract_next_invoice_date() is
  'BEFORE INSERT OR UPDATE trigger on public.contracts (issue #209): derives next_invoice_date from start_date, end_date, billing_terms_id (its reference item''s interval_months) and invoiced_period_count. See the migration header.';

create trigger contracts_compute_next_invoice_date
  before insert or update of start_date, end_date, billing_terms_id, invoiced_period_count, next_invoice_date
  on public.contracts
  for each row execute function public.compute_contract_next_invoice_date();

alter table public.contracts
  add constraint contracts_next_invoice_date_within_end_date
    check (end_date is null or next_invoice_date is null or next_invoice_date <= end_date);

-- Grants: contracts' INSERT/UPDATE column lists (contracts_core + the
-- billing_period_id addition in 20260905100000) are unchanged; the new
-- columns are deliberately not added, so they remain non-writable by
-- authenticated (ADD COLUMN never extends column-level grants). SELECT is
-- table-level, so the new columns are readable.

-- Backfill existing contracts (fires the trigger on every row).
update public.contracts set start_date = start_date;

-- ---------------------------------------------------------------------------
-- Recompute contracts when a billing_terms item's interval changes.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_contracts_on_interval_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.contracts
  set billing_terms_id = billing_terms_id
  where billing_terms_id = new.id;
  return null;
end;
$fn$;

comment on function public.recompute_contracts_on_interval_change() is
  'AFTER UPDATE OF interval_months trigger on public.reference_list_items (issue #209): touches contracts using that item so compute_contract_next_invoice_date() re-derives next_invoice_date.';

create trigger reference_list_items_recompute_contracts
  after update of interval_months on public.reference_list_items
  for each row
  when (old.interval_months is distinct from new.interval_months)
  execute function public.recompute_contracts_on_interval_change();
