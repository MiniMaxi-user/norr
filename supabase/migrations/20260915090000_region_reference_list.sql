-- Planning module schema prerequisite, part 1 of 2 (issue #164, "Planning" —
-- drag-and-drop scheduler). This migration adds the tenant-configurable
-- `region` reference list (for filtering/grouping Sites and Engineers by
-- geography on the scheduler board), a new `Inspectie` activity_type item
-- (design mockup calls for a green-badged inspection type), and
-- `region_id` FK columns on `public.sites` and `public.memberships` (an
-- "engineer" is a membership row with `role = 'engineer'`, same convention
-- `20260830090000_engineer_client_rate_overrides.sql` already established).
-- See `20260915100000_work_orders_type_and_duration.sql` for part 2
-- (`work_orders.type_id`/`duration_minutes`).
--
-- Design decisions:
--
-- 1. **`region` is a plain ROOT-LEVEL (flat) reference list** — same shape as
--    `asset_type`/`contact_role`, no `parent_list_key`. Not dependent on
--    anything: a region ("Regio Noord") is a standalone geographic grouping,
--    not scoped by some other list's value the way Asset Sub-type is scoped
--    by Asset Type.
-- 2. **Province subtitle uses the existing generic `description` column**
--    (added by `20260910090000_reference_list_items_description_active_and_
--    volume_list.sql`) rather than a new column or a second list level — the
--    province grouping is informational display copy on each region item,
--    not something `sites`/`memberships` need to query or filter by
--    independently.
-- 3. **`Inspectie` activity_type item — own `on conflict do nothing`
--    clause, NOT folded into the block's existing `on conflict (...) do
--    update set icon = excluded.icon` clause.** That existing clause exists
--    only to re-assert the icon on the 5 pre-existing rows across repeated
--    seed runs; widening it to cover a new row risks clobbering a tenant's
--    own edited icon on this row too, if this function is ever re-run
--    oddly. Its green color (matching the design mockup) is set by a
--    separate, narrowly-scoped `update ... where ... and color is null`
--    statement immediately after, not baked into the insert's column list —
--    so it only ever touches this one new row, and only while still unset
--    (never overwrites a tenant's own edit).
-- 4. **`sites.region_id`**: plain nullable FK into `reference_list_items`.
--    `sites` already has column-level INSERT/UPDATE grant lockdown
--    (`20260822193000_fix_clients_sites_assets_column_grants.sql`), so the
--    full current column-level grant lists are re-issued below with
--    `region_id` added — same "re-issue the full list" pattern used
--    whenever a locked-down table gains a new writable column (e.g.
--    `reference_list_items` in `20260910090000`/`20260914090000`).
-- 5. **`memberships.region_id`**: same shape, but `memberships` has NEVER
--    had column-level INSERT/UPDATE lockdown — confirmed by reading
--    `20260822150910_organizations_memberships_baseline_rls.sql` (a single
--    unrestricted `grant select, insert, update, delete on
--    public.memberships to authenticated;`, no column list) and reconfirmed
--    by `20260830090000_engineer_client_rate_overrides.sql`'s own design
--    note 4 for the same table. A table-level grant already covers every
--    column added later by `ALTER TABLE ADD COLUMN`, including this one —
--    **no new GRANT statement is added here**, flagged explicitly below so
--    this pre-existing, deliberate scope difference isn't "fixed" by
--    mistake later.
-- 6. **Shared validation trigger**: `validate_region_reference_item()`
--    (SECURITY DEFINER), one function attached to both `sites` and
--    `memberships` — both tables have the identical `(organization_id,
--    region_id)` shape this check needs, so one generic function covers
--    both, same "one function, many tables" reuse as
--    `validate_rate_override_articles`/`set_created_by`/`set_updated_at`,
--    not a per-table copy. Uses `tg_table_name` for error messages.
-- 7. **No RLS policy changes.** Confirmed by reading both tables' current
--    policies: `sites_update_owner`
--    (`20260822190000_clients_sites_assets.sql`) and `memberships_update_
--    owner` (`20260822150910_organizations_memberships_baseline_rls.sql`)
--    both key entirely on `is_org_owner(organization_id)` — no
--    column-specific predicate on either. A new nullable FK column on an
--    already-RLS'd, owner-scoped table needs no new policy, same reasoning
--    already documented for every prior `sites` column addition
--    (`20260826130000_sites_phone.sql`, `20260826150000_sites_contact_
--    persons.sql`).
--
-- Per the standing "copy the full live function body forward, don't
-- reconstruct by hand" guidance in `20260907100000_fix_seed_default_
-- reference_lists_regression_3.sql` (after FOUR prior incidents of `CREATE
-- OR REPLACE FUNCTION seed_default_reference_lists` silently dropping
-- earlier list_key blocks): the function body below is the full body of
-- `20260910090000_reference_list_items_description_active_and_volume_list.
-- sql` (confirmed the true latest by grepping every migration for `create
-- or replace function public.seed_default_reference_lists` and taking the
-- highest-timestamped one) with exactly two changes — the new `inspectie`
-- activity_type item (+ its own color update statement) and the new
-- `region` block appended at the end — and the trailing `ensure_reference_
-- list_defaults` self-heal call preserved verbatim. No earlier list_key
-- block, and no other function logic, was altered.

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
  -- lifecycle: New (default) -> Scheduled -> En Route -> In Progress ->
  -- Completed -> Invoiced.
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
    (v_work_order_status_list_id, p_organization_id, 'en_route', 'En Route', 3, false),
    (v_work_order_status_list_id, p_organization_id, 'in_progress', 'In Progress', 4, false),
    (v_work_order_status_list_id, p_organization_id, 'completed', 'Completed', 5, false),
    (v_work_order_status_list_id, p_organization_id, 'invoiced', 'Invoiced', 6, false)
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
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'activity_type', 'Activity Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_activity_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'activity_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default, icon)
  values
    (v_activity_type_list_id, p_organization_id, 'bel_activiteit', 'Bel activiteit', 1, false, 'Phone'),
    (v_activity_type_list_id, p_organization_id, 'storing', 'Storing', 2, false, 'AlertTriangle'),
    (v_activity_type_list_id, p_organization_id, 'onderhoud', 'Onderhoud', 3, false, 'Settings'),
    (v_activity_type_list_id, p_organization_id, 'afspraak', 'Afspraak', 4, false, 'CalendarDays'),
    (v_activity_type_list_id, p_organization_id, 'email_opvolging', 'E-mail opvolging', 5, false, 'Mail')
  on conflict (reference_list_id, value) do update set icon = excluded.icon;

  -- inspectie: NEW activity_type item (issue #164, Planning module). Own
  -- `on conflict do nothing` clause — deliberately NOT folded into the
  -- `on conflict do update set icon = excluded.icon` clause above (see
  -- migration header design note 3: that clause exists only to re-assert
  -- icon on the 5 pre-existing rows across repeated seed runs; widening it
  -- to this row too risks clobbering a tenant's own edited icon on it if
  -- this function is ever re-run oddly).
  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, icon)
  values
    (v_activity_type_list_id, p_organization_id, 'inspectie', 'Inspectie', 6, 'Search')
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
  -- Open (default) -> In behandeling -> Afgerond.
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
    (v_activity_status_list_id, p_organization_id, 'in_progress', 'In behandeling', 2, false),
    (v_activity_status_list_id, p_organization_id, 'completed', 'Afgerond', 3, false)
  on conflict (reference_list_id, value) do nothing;

  -- article_unit: for articles.unit_item_id. Flat. Stuk is the sensible
  -- tenant default (most articles in an FSM parts catalog are discrete
  -- units, not bulk liquid/weight).
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'article_unit', 'Article Unit')
  on conflict (organization_id, list_key) do nothing;

  select id into v_article_unit_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'article_unit';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_article_unit_list_id, p_organization_id, 'stuk', 'Stuk', 1, true),
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
  -- Planning module). Flat, root-level list, like asset_type/contact_role —
  -- not dependent on anything. Each item's province grouping lives in the
  -- generic `description` column, not a second list level (see migration
  -- header design note 2).
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'region', 'Region')
  on conflict (organization_id, list_key) do nothing;

  select id into v_region_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'region';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, description, sort_order)
  values
    (v_region_list_id, p_organization_id, 'regio_noord', 'Regio Noord', 'Groningen · Friesland · Drenthe', 1),
    (v_region_list_id, p_organization_id, 'regio_midden', 'Regio Midden', 'Utrecht · Gelderland', 2),
    (v_region_list_id, p_organization_id, 'regio_zuid', 'Regio Zuid', 'Brabant · Limburg', 3)
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
  'Idempotent (on conflict do nothing throughout, except activity_type''s icon backfill which uses on conflict do update). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Also calls ensure_reference_list_defaults(p_organization_id) at the end (restored here — see 20260907100000_fix_seed_default_reference_lists_regression_3.sql''s header, BUG 1/BUG 2), so every seed/backfill call self-heals any is_default gap for that organization, not just seeds brand-new list_keys. Restored in 20260907100000_fix_seed_default_reference_lists_regression_3.sql: 20260905100000_contracts_billing_period_line_items_and_article_rules.sql''s own CREATE OR REPLACE had accidentally dropped the time_entry_type/quote_status/asset_brand/activity_type/activity_status/article_unit/article_manufacturer/vat_rate list_key blocks AND the trailing ensure_reference_list_defaults call (the FOURTH time this class of regression has happened — see that fix migration''s design note for the full incident history and the "copy the full live function body forward via pg_get_functiondef, don''t reconstruct by hand" guidance, which keeps not being followed). Extended in 20260910090000_reference_list_items_description_active_and_volume_list.sql with a `volume` block (issue #131). Extended in 20260915090000_region_reference_list.sql (issue #164, Planning module) with a new root-level `region` block (province grouping stored in the generic `description` column, not a second list level) and a new `inspectie` activity_type item (own on conflict do nothing clause, plus a separately-scoped color backfill — see that migration''s header design note 3 for why it is not folded into the pre-existing icon on-conflict-do-update clause). Future picklists should extend this function the same way (a new list_key block, plus a row in ensure_reference_list_defaults'' values list if it needs a default), plus a one-time backfill call in that feature''s own migration.';

-- ---------------------------------------------------------------------------
-- Backfill: seed the new `region` list and `inspectie` item (and self-heal
-- any is_default gap, via the function's own trailing call) for every
-- organization that already existed before this migration ran — the
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
-- sites.region_id (design note 4 above).
-- ---------------------------------------------------------------------------
alter table public.sites
  add column region_id uuid references public.reference_list_items(id);

comment on column public.sites.region_id is
  'Nullable FK into reference_list_items (region list, issue #164, Planning module) — the geographic region this site belongs to, for filtering/grouping on the scheduler board. Validated by validate_region_reference_item to belong to this site''s own organization_id and the region list_key.';

create index sites_region_id_idx on public.sites (region_id);

-- Full re-issue of sites' current INSERT/UPDATE column-level grants (see
-- migration header design note 4) with region_id added. Plain `grant` (not
-- `revoke all` + `grant`) is sufficient — extending an existing column-level
-- grant list by addition, not correcting a prior over-broad table-wide grant
-- (that correction already happened once, in 20260822193000_fix_clients_
-- sites_assets_column_grants.sql). organization_id intentionally excluded:
-- derived by derive_site_organization_id.
grant insert (
  client_id, phone, region_id,
  address_line1, address_line2, postal_code, city, country,
  latitude, longitude, notes,
  is_visit_address, is_invoice_address, is_delivery_address,
  is_primary, geocoded_at,
  visit_contact_id, delivery_contact_id, invoice_contact_id
) on public.sites to authenticated;
grant update (
  client_id, phone, region_id,
  address_line1, address_line2, postal_code, city, country,
  latitude, longitude, notes,
  is_visit_address, is_invoice_address, is_delivery_address,
  is_primary, geocoded_at,
  visit_contact_id, delivery_contact_id, invoice_contact_id
) on public.sites to authenticated;

-- ---------------------------------------------------------------------------
-- memberships.region_id (design note 5 above).
-- ---------------------------------------------------------------------------
alter table public.memberships
  add column region_id uuid references public.reference_list_items(id);

comment on column public.memberships.region_id is
  'Nullable FK into reference_list_items (region list, issue #164, Planning module) — the geographic region this member (typically an engineer) is assigned to, for filtering/grouping on the scheduler board. Validated by validate_region_reference_item to belong to this membership''s own organization_id and the region list_key. NOTE: memberships has NEVER had column-level INSERT/UPDATE lockdown (see 20260830090000_engineer_client_rate_overrides.sql design note 4, reconfirmed here) — its baseline grant is a single unrestricted `grant select, insert, update, delete on public.memberships to authenticated;` (table-level, no column list), which already covers this new column automatically. Deliberately NO new GRANT statement was added for this column — do not "fix" this by adding one later; it would be redundant with the existing table-level grant, not a bug.';

create index memberships_region_id_idx on public.memberships (region_id);

-- ---------------------------------------------------------------------------
-- Shared validation trigger (design note 6 above): one function, attached to
-- both public.sites and public.memberships — both tables share the identical
-- (organization_id, region_id) shape this check needs.
-- ---------------------------------------------------------------------------
create or replace function public.validate_region_reference_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_region_org uuid;
  v_region_key text;
begin
  if new.region_id is not null then
    select rl.organization_id, rl.list_key into v_region_org, v_region_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.region_id;

    if v_region_org is null then
      raise exception '%.region_id % does not reference an existing reference_list_items row', tg_table_name, new.region_id
        using errcode = '23503';
    elsif v_region_key <> 'region' then
      raise exception '%.region_id must reference an item from the region reference list (got list_key=%)', tg_table_name, v_region_key
        using errcode = '23514';
    elsif v_region_org <> new.organization_id then
      raise exception '%.region_id must belong to the same organization as the row', tg_table_name
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_region_reference_item() is
  'BEFORE INSERT/UPDATE OF region_id trigger, shared by public.sites and public.memberships (issue #164, Planning module): rejects a region_id that does not exist, does not belong to the region list_key, or belongs to a different organization than the row itself. One shared function since both tables have the identical (organization_id, region_id) column shape needed here — same "one generic function, many tables" reuse as validate_rate_override_articles/set_created_by/set_updated_at, not a per-table copy. Uses tg_table_name for error messages so a single function definition serves both tables clearly.';

create trigger sites_validate_region
  before insert or update of region_id on public.sites
  for each row execute function public.validate_region_reference_item();

create trigger memberships_validate_region
  before insert or update of region_id on public.memberships
  for each row execute function public.validate_region_reference_item();

-- ---------------------------------------------------------------------------
-- RLS: no policy changes (design note 7 above). Confirmed by reading both
-- tables' current policies:
--   sites_update_owner (20260822190000_clients_sites_assets.sql):
--     using/with check (is_org_owner(organization_id)) — no column predicate.
--   memberships_update_owner (20260822150910_organizations_memberships_
--     baseline_rls.sql): using/with check (is_org_owner(organization_id)) —
--     no column predicate.
-- A new nullable FK column on either already-RLS'd, owner-scoped table needs
-- no new policy.
-- ---------------------------------------------------------------------------
