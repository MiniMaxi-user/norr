-- "Volume" reference list (issue #131, "Beheren 'Volume'"). Schema layer
-- only — no app/UI changes here (those are api-backend-engineer/
-- frontend-ui-engineer's follow-up passes).
--
-- Background: `contract_line_items.is_volume` (issue #129,
-- `20260909100000_contract_line_items_volume_and_purchase_price.sql`)
-- introduced the "Volume" checkbox as a standalone boolean and explicitly
-- deferred building a real tenant-configurable reference list for the
-- concept to THIS issue (#131) — see that migration's design note 2 and
-- `contract_line_items.is_volume`'s own column comment. This migration does
-- NOT touch `contract_line_items`/`is_volume` at all (no new FK column added
-- to it here — that repurposing, if it happens, is `is_volume`'s own future
-- migration, not this one); it only builds the tenant-configurable "Volume"
-- LIST itself as a Settings-managed picklist, per issue #131's own
-- acceptance criteria (confirmed final term: "Volume", NOT the issue text's
-- placeholder "Volume of Quota").
--
-- Two things in this migration:
--
-- 1. Two new GENERIC columns on `reference_list_items` — `description`
--    (free text) and `is_active` (on/off) — reused by ANY list the same way
--    `color`/`icon` already are optional-per-list columns every list gets,
--    whether it uses them or not. Not Volume-specific, even though Volume is
--    their first real consumer (same precedent `icon` set: it was added
--    generically in `20260828090000_activities_core.sql` for `activity_type`,
--    then nothing else has used it since — that's expected, not a sign the
--    column was miscategorized).
--
-- 2. A new `volume` list container, added to `seed_default_reference_lists`
--    per its documented extension pattern, with `parent_list_key =
--    'article_unit'` (the dependent-list mechanism from
--    `20260823090000_contacts_dependent_reference_lists.sql` — reused as-is,
--    nothing new invented here). UNLIKE every other list this function
--    seeds, `volume` gets ZERO seeded items — a Volume value ("10,000 cups
--    of coffee per year", "1000 B/W prints") is fully bespoke per tenant,
--    there is no universal-across-tenants default that makes sense the way
--    "HVAC"/"Active"/"Monthly" etc. do for other lists. The owner ("Tenant
--    beheerder", confirmed to map onto the existing `owner` role/
--    `is_org_owner()` — no new role/RBAC entry needed) creates their own
--    items from an empty list via Settings, same `reference_list_items`
--    owner-only write boundary every other list already has — no RLS
--    policy change in this migration at all.
--
-- Per the standing guidance repeated in
-- `20260907100000_fix_seed_default_reference_lists_regression_3.sql` (after
-- FOUR prior incidents of `CREATE OR REPLACE FUNCTION
-- seed_default_reference_lists` silently dropping earlier list_key blocks):
-- the function body below is the FULL body of that migration's version
-- (the true latest as of this migration — confirmed by grepping every
-- migration file for `create or replace function public.
-- seed_default_reference_lists` and taking the highest-timestamped one)
-- with exactly one new block appended (`volume`, placed right after
-- `article_unit` since it depends on it) and the trailing
-- `ensure_reference_list_defaults` self-heal call preserved verbatim. No
-- earlier list_key block, and no other function logic, was altered.

-- ---------------------------------------------------------------------------
-- 1. reference_list_items.description / is_active: new generic, reusable
--    columns (design note 1 above). Additive grant only — ALTER TABLE ADD
--    COLUMN does not re-trigger this project's "grant ALL to authenticated
--    by default on new TABLES" behavior (that only fires at table-creation
--    time), same reasoning already documented next to
--    assets.type_id/status_id's grants in 20260822200000_reference_lists.sql
--    — but per this table's existing INSERT/UPDATE column-grant statements
--    already covering several columns, both are re-issued here IN FULL
--    (matching the pattern 20260909100000_contract_line_items_volume_and_
--    purchase_price.sql used for contract_line_items), not as a bare
--    additive delta, so the complete, current column set is always visible
--    in one place per migration rather than split across several.
-- ---------------------------------------------------------------------------
alter table public.reference_list_items
  add column description text,
  add column is_active boolean not null default true;

comment on column public.reference_list_items.description is
  'Optional free-text description for reference list items that need one (first real consumer: issue #131''s Volume list, e.g. "10,000 cups of coffee per year", "1000 B/W prints"). Nullable and generic/reusable, like color/icon: most reference lists (asset_type, asset_status, etc.) have no description and this column simply stays null for their items.';

comment on column public.reference_list_items.is_active is
  'Generic active/inactive toggle for reference list items that need one (first real consumer: issue #131''s Volume list, so a tenant can retire a Volume item without deleting its history/breaking existing references to it). not null default true, so every pre-existing row across every pre-existing list becomes active with zero migration-time backfill needed. Generic and reusable, like color/icon/description: most reference lists never expose this in their own UI and every item on them simply stays true.';

revoke all on public.reference_list_items from authenticated;

grant select, delete on public.reference_list_items to authenticated;
-- Full re-issue of the INSERT/UPDATE column-level grants (organization_id
-- excluded throughout: derived by derive_reference_list_item_org.
-- reference_list_id is INSERT-only, still excluded from UPDATE — see design
-- note 4 in 20260822200000_reference_lists.sql, unchanged by this
-- migration).
grant insert (
  reference_list_id, value, label, color, icon, sort_order, is_default,
  parent_item_id, description, is_active
) on public.reference_list_items to authenticated;

grant update (
  value, label, color, icon, sort_order, is_default, parent_item_id,
  description, is_active
) on public.reference_list_items to authenticated;

-- ---------------------------------------------------------------------------
-- 2. seed_default_reference_lists: full latest body (from
--    20260907100000_fix_seed_default_reference_lists_regression_3.sql) plus
--    one new `volume` block (dependent on `article_unit`, zero seeded
--    items), plus the preserved trailing self-heal call.
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

  -- activity_type: for activities.type_id. Flat list, 5 items, each carrying
  -- an icon. No item is marked is_default — the type picker always requires
  -- an explicit choice.
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

  -- volume: for the new Settings-managed "Volume" list (issue #131,
  -- "Beheren 'Volume'" — final chosen term is "Volume", NOT the issue text's
  -- placeholder "Volume of Quota"). Dependent list, parent_list_key =
  -- article_unit (every Volume item is measured in one of the tenant's own
  -- article_unit values, e.g. "Piece"). Deliberately seeds ZERO items,
  -- unlike every list above: a Volume value ("10,000 cups of coffee per
  -- year", "1000 B/W prints") is fully bespoke per tenant — there is no
  -- universal-across-tenants default the way "HVAC"/"Active"/"Monthly" etc.
  -- have for other lists. The owner creates their own items from this empty
  -- list via Settings; no is_default concept here either (same as
  -- asset_subtype/sla_tier).
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

  -- Self-heal: re-verify every list above (plus any earlier picklist) still
  -- has its intended default item, in case is_default was reset outside this
  -- function's control (see 20260907100000_fix_seed_default_reference_lists_
  -- regression_3.sql's header for the full mechanism). Preserved verbatim —
  -- volume has no is_default concept, so it needs no entry here (same as
  -- asset_subtype/sla_tier).
  perform public.ensure_reference_list_defaults(p_organization_id);
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout, except activity_type''s icon backfill which uses on conflict do update). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Also calls ensure_reference_list_defaults(p_organization_id) at the end (restored here — see 20260907100000_fix_seed_default_reference_lists_regression_3.sql''s header, BUG 1/BUG 2), so every seed/backfill call self-heals any is_default gap for that organization, not just seeds brand-new list_keys. Restored in 20260907100000_fix_seed_default_reference_lists_regression_3.sql: 20260905100000_contracts_billing_period_line_items_and_article_rules.sql''s own CREATE OR REPLACE had accidentally dropped the time_entry_type/quote_status/asset_brand/activity_type/activity_status/article_unit/article_manufacturer/vat_rate list_key blocks AND the trailing ensure_reference_list_defaults call (the FOURTH time this class of regression has happened — see that fix migration''s design note for the full incident history and the "copy the full live function body forward via pg_get_functiondef, don''t reconstruct by hand" guidance, which keeps not being followed). Extended in 20260910090000_reference_list_items_description_active_and_volume_list.sql with a `volume` block (issue #131, "Beheren ''Volume''" — dependent list, parent_list_key=article_unit, deliberately ZERO seeded items since Volume values are fully bespoke per tenant with no sensible universal default, unlike every earlier block). Future picklists should extend this function the same way (a new list_key block, plus a row in ensure_reference_list_defaults'' values list if it needs a default), plus a one-time backfill call in that feature''s own migration.';

-- ---------------------------------------------------------------------------
-- Backfill: seed the new `volume` list (and self-heal any is_default gap,
-- via the function's own trailing call) for every organization that already
-- existed before this migration ran — the organizations_seed_reference_lists
-- trigger only fires for future inserts. Same do $$ ... perform public.
-- seed_default_reference_lists(r.id); ... $$ block every prior list-adding
-- migration includes for itself.
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
