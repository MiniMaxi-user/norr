-- Fix: seed_default_reference_lists regressed AGAIN — the FOURTH time. PLUS
-- a second, previously-undiagnosed bug in how repeated seed calls interact
-- with is_default, found while fixing the first.
--
-- Found while live-verifying 20260907090000_activities_contract_id.sql
-- (issue #127) against the linked remote database: seeding a fresh test
-- organization and trying to resolve its `activity_type` "afspraak" item
-- returned zero rows.
--
-- BUG 1 — ROOT CAUSE (confirmed via `pg_get_functiondef` against the live
-- database): `20260905100000_contracts_billing_period_line_items_and_
-- article_rules.sql`'s own `create or replace function
-- seed_default_reference_lists` was authored from a stale base (predating
-- BOTH `20260830110000_fix_seed_default_reference_lists_regression.sql` AND
-- `20260830130000_fix_reference_list_defaults_ad_hoc_regression.sql`)
-- instead of the true latest body. It correctly kept `asset_type`/
-- `asset_status`/`contact_role`/`asset_subtype`/`work_order_status`/
-- `work_order_priority`/`contract_type`/`sla_tier`/`billing_terms` and added
-- its own new `billing_period` block, but silently DROPPED `time_entry_type`,
-- `quote_status`, `asset_brand`, `activity_type`, `activity_status`,
-- `article_unit`, `article_manufacturer`, `vat_rate` list_key blocks
-- entirely, AND ALSO dropped the trailing `perform
-- public.ensure_reference_list_defaults(p_organization_id);` self-heal call
-- `20260830130000` had added (see BUG 2) — the exact same failure mode as
-- the three prior list_key-dropping regressions (`20260826160000`,
-- `20260829100000`, each already fixed once). Confirmed live: this project's
-- "Freshfood" organization (created 2026-09-06, after the regression landed
-- and before this fix) has ZERO `activity_type`/`activity_status`/
-- `time_entry_type`/`quote_status`/`asset_brand`/`article_unit`/
-- `article_manufacturer`/`vat_rate` reference_lists rows — creating an
-- Activity, Time Entry, Quote, Asset Model, or Article for that org would
-- fail exactly like the prior incidents' own headers describe.
--
-- BUG 2 — a SEPARATE, previously-misdiagnosed defect, found while
-- live-verifying this fix in a rolled-back transaction: calling
-- `seed_default_reference_lists` a SECOND time for an organization that
-- already has a given list_key's rows fully seeded silently WIPES that
-- list's `is_default` flag back to false on every item, even though every
-- INSERT in this function is guarded by `on conflict (reference_list_id,
-- value) do nothing`. Root cause: for a proposed row that conflicts,
-- Postgres still fires the row's `BEFORE INSERT` trigger BEFORE evaluating
-- the conflict and discarding the row — so
-- `reference_list_items_enforce_single_default`
-- (`enforce_single_default_reference_item()`, `20260822200000_reference_
-- lists.sql`) runs its `UPDATE ... SET is_default = false WHERE
-- reference_list_id = new.reference_list_id AND id <> new.id AND is_default
-- = true` unconditionally for the proposed (about-to-be-discarded) 'open'/
-- 'new'/'draft'/etc. row, unsetting the ALREADY-CORRECT existing default
-- row, and then the INSERT itself is thrown away by `ON CONFLICT DO
-- NOTHING` — net effect: the list ends up with zero default items. This is
-- almost certainly the TRUE root cause `20260830130000_fix_reference_list_
-- defaults_ad_hoc_regression.sql` was chasing (that migration's own header
-- attributed the symptom to "an ad hoc UPDATE run directly against the
-- linked database outside this repo's migrations" — plausible for THAT
-- incident, since no in-repo statement matched the reset timestamps found,
-- but this mechanism shows a fully in-repo, migration-triggered path to the
-- identical symptom exists too: any feature migration's own backfill loop
-- calling `seed_default_reference_lists(r.id)` for an org that already has
-- that list_key seeded will reproduce it). `20260830130000`'s own fix
-- (`ensure_reference_list_defaults`, a separate self-healing UPDATE that
-- only sets `is_default = true` when a list currently has ZERO default
-- items, called at the end of `seed_default_reference_lists`) already fully
-- neutralizes this — it was simply lost by BUG 1's stale-base regression.
-- Restoring the self-heal call (this fix) is sufficient; the
-- `enforce_single_default_reference_item` trigger itself is NOT changed
-- here (out of scope — fixing its "fires before the conflict check" behavior
-- would need its own migration and is a separate, lower-priority hardening
-- task, not blocking activity/quote/work-order creation the way BUG 1 was).
--
-- Standing guidance (repeated because it keeps not being followed): the next
-- `CREATE OR REPLACE FUNCTION seed_default_reference_lists` MUST copy the
-- entire existing function body forward via
-- `pg_get_functiondef('public.seed_default_reference_lists(uuid)'::
-- regprocedure)` run against the LIVE database, never reconstruct it by hand
-- from an earlier migration file — that includes the trailing
-- `ensure_reference_list_defaults` call, which is easy to miss precisely
-- because it's one unassuming line at the very end.
--
-- Fix: full merged body — every block from `20260830130000_fix_reference_
-- list_defaults_ad_hoc_regression.sql` (last fully-correct version, INCLUDING
-- its trailing self-heal call) PLUS `20260905100000`'s own `billing_period`
-- block (re-inserted in its original position, right after `billing_terms`).
-- `ensure_reference_list_defaults` itself is also extended (new
-- `('billing_period', 'monthly')` row) so billing_period gets the same
-- self-healing coverage every other defaulted list already has. Idempotent
-- throughout, plus a backfill loop calling `ensure_reference_list_defaults`
-- (cheaper than re-running `seed_default_reference_lists`' full 17 blocks,
-- same reasoning `20260830130000`'s own backfill gave) for every existing
-- organization — NOT a no-op: "Freshfood" (created 2026-09-06, after the
-- regression) is missing the 8 dropped list_key blocks (restored by this
-- migration's `do` block calling the full `seed_default_reference_lists`,
-- since `ensure_reference_list_defaults` alone can't create missing
-- `reference_lists`/`reference_list_items` rows, only fix `is_default` on
-- rows that already exist).

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
  -- billing_terms) — added by 20260905100000_contracts_billing_period_
  -- line_items_and_article_rules.sql, re-inserted here in its original
  -- position (right after billing_terms).
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
  -- function's control (an ad hoc edit, OR the ON-CONFLICT-DO-NOTHING-still-
  -- fires-the-BEFORE-trigger mechanism BUG 2 in this migration's header
  -- documents) — restored here after 20260905100000's CREATE OR REPLACE
  -- silently dropped this line along with the 8 list_key blocks above it.
  perform public.ensure_reference_list_defaults(p_organization_id);
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout, except activity_type''s icon backfill which uses on conflict do update). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Also calls ensure_reference_list_defaults(p_organization_id) at the end (restored here — see 20260907100000_fix_seed_default_reference_lists_regression_3.sql''s header, BUG 1/BUG 2), so every seed/backfill call self-heals any is_default gap for that organization, not just seeds brand-new list_keys. Restored in 20260907100000_fix_seed_default_reference_lists_regression_3.sql: 20260905100000_contracts_billing_period_line_items_and_article_rules.sql''s own CREATE OR REPLACE had accidentally dropped the time_entry_type/quote_status/asset_brand/activity_type/activity_status/article_unit/article_manufacturer/vat_rate list_key blocks AND the trailing ensure_reference_list_defaults call (the FOURTH time this class of regression has happened — see that fix migration''s design note for the full incident history and the "copy the full live function body forward via pg_get_functiondef, don''t reconstruct by hand" guidance, which keeps not being followed). Future picklists should extend this function the same way (a new list_key block, plus a row in ensure_reference_list_defaults'' values list if it needs a default), plus a one-time backfill call in that feature''s own migration.';

-- ensure_reference_list_defaults: extended with billing_period (issue #122's
-- list, added by 20260905100000, never had self-heal coverage since that
-- migration didn't touch this function) — same self-healing UPDATE
-- introduced by 20260830130000_fix_reference_list_defaults_ad_hoc_
-- regression.sql, unchanged in every other respect.
create or replace function public.ensure_reference_list_defaults(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.reference_list_items i
  set is_default = true
  from public.reference_lists rl
  join (
    values
      ('asset_type', 'other'),
      ('asset_status', 'active'),
      ('contact_role', 'primary'),
      ('work_order_status', 'new'),
      ('work_order_priority', 'normal'),
      ('contract_type', 'maintenance'),
      ('billing_terms', 'monthly'),
      ('billing_period', 'monthly'),
      ('time_entry_type', 'labor'),
      ('quote_status', 'draft'),
      ('asset_brand', 'other_brand'),
      ('activity_status', 'open'),
      ('article_unit', 'stuk'),
      ('article_manufacturer', 'other_manufacturer'),
      ('vat_rate', '21')
  ) as defaults (list_key, default_value)
    on defaults.list_key = rl.list_key
  where rl.id = i.reference_list_id
    and rl.organization_id = p_organization_id
    and i.value = defaults.default_value
    and not exists (
      select 1 from public.reference_list_items d
      where d.reference_list_id = i.reference_list_id and d.is_default
    );
end;
$$;

comment on function public.ensure_reference_list_defaults(uuid) is
  'Idempotent, safe to re-run at any time: for every (list_key, default value) pair a tenant-configurable picklist is meant to have exactly one is_default item for, sets is_default = true on that item IF AND ONLY IF the list currently has zero default items (never clobbers an org''s existing default). Introduced in 20260830130000_fix_reference_list_defaults_ad_hoc_regression.sql; extended in 20260907100000_fix_seed_default_reference_lists_regression_3.sql with billing_period (added by 20260905100000, which never wired it into this function). Called from seed_default_reference_lists (so every future seed/backfill call also self-heals this) and directly in backfill loops. activity_type (deliberately no default) and the dependent lists asset_subtype/sla_tier (no is_default concept) are intentionally absent from the values list here. Extend this list, not a new one-off UPDATE block, when a future picklist needs a default.';

revoke all on function public.ensure_reference_list_defaults(uuid) from public;

-- Backfill: two-part, over every organization that already existed before
-- this migration ran (the organizations_seed_reference_lists trigger only
-- fires for future inserts).
--
-- 1. Full seed_default_reference_lists(r.id): restores any list_key block
--    missing due to BUG 1. NOT a no-op: "Freshfood" (created 2026-09-06,
--    after the regression landed) is confirmed live to be missing the 8
--    dropped blocks and is backfilled here; every older organization already
--    has them from an earlier migration's own backfill (on conflict do
--    nothing makes re-running against them harmless for the list_key
--    blocks) — and the trailing ensure_reference_list_defaults call inside
--    seed_default_reference_lists itself already covers step 2 below too,
--    this explicit second call is just belt-and-suspenders for the
--    billing_period row specifically (added to ensure_reference_list_
--    defaults in this same migration, so it's already covered by step 1's
--    internal call, but spelled out here for clarity/no-op safety).
do $$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform public.seed_default_reference_lists(r.id);
    perform public.ensure_reference_list_defaults(r.id);
  end loop;
end;
$$;
