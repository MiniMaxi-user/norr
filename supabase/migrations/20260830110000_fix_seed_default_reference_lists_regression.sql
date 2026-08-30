-- Fix: seed_default_reference_lists regressed AGAIN — the third time.
--
-- Found while live-verifying 20260830100000_work_order_articles_and_
-- quote_traceability.sql's cross-org triggers against the linked remote
-- database (probing quotes.work_order_id/work_order_articles required
-- creating a fresh test organization + work order + quote, which failed with
-- `null value in column "status_id" of relation "work_orders" violates
-- not-null constraint` — the exact symptom class
-- 20260828100000_fix_missing_reference_list_defaults.sql's header already
-- names).
--
-- Root cause: `20260829100000_articles_core.sql`'s `create or replace
-- function seed_default_reference_lists` redefined the function from a stale
-- base (missing every block added since `20260824090000_quotes_core.sql`)
-- instead of extending the last-known-complete version. It silently DROPPED
-- the `work_order_status`, `work_order_priority`, `contract_type`,
-- `sla_tier`, `billing_terms`, `time_entry_type`, `quote_status`,
-- `activity_type`, and `activity_status` blocks entirely (not just their
-- `is_default` flags — the whole `reference_lists` rows for those keys never
-- get created), while correctly keeping/adding `asset_type`, `asset_status`,
-- `contact_role`, `asset_subtype`, `asset_brand`, `article_unit`,
-- `article_manufacturer`, `vat_rate`. Confirmed live: every organization
-- created between `20260829100000_articles_core.sql` and this fix landing
-- has ZERO `work_order_status`/`work_order_priority`/`contract_type`/
-- `sla_tier`/`billing_terms`/`time_entry_type`/`quote_status`/
-- `activity_type`/`activity_status` reference_lists rows at all — the next
-- work order, quote, contract, or activity insert for such an org (all of
-- which have `not null` status/type columns relying on this seeding for
-- their "fill in the default" trigger behavior) would fail exactly like
-- 20260828100000's own header describes.
--
-- This is the SAME regression class as `20260826160000_asset_brand_and_
-- models.sql`'s CREATE OR REPLACE (fixed by `20260828090000_activities_core.
-- sql`, see that migration's own design note 8) — evidently it happened a
-- second time despite that precedent, because `20260829100000_articles_core.
-- sql` was authored from `20260826160000`'s (pre-fix) function body rather
-- than the true latest. Flagging for whoever picks up the next `CREATE OR
-- REPLACE FUNCTION seed_default_reference_lists`: copy the ENTIRE existing
-- function body forward from `pg_get_functiondef` on the live database (or
-- this migration), don't reconstruct it from an earlier migration file by
-- hand — that's what caused all three regressions so far.
--
-- Fix: full merged body — every block from `20260828090000_activities_core.
-- sql`'s (last fully-correct) version, PLUS `20260829100000_articles_core.
-- sql`'s article_unit/article_manufacturer/vat_rate additions. Idempotent
-- (`on conflict do nothing` throughout, matching every prior version), plus a
-- backfill loop over every existing organization — the
-- `organizations_seed_reference_lists` trigger only fires for future
-- inserts. Live-checked before this fix: every currently-existing
-- organization in this project predates the regression (created before
-- 2026-08-29) and already has all these lists from an earlier migration's
-- own backfill, so this backfill is a no-op today — it exists purely so no
-- FUTURE org created between the regression and this fix (if any slipped in)
-- is left without them, and as the same standing safety net every prior
-- backfill in this file provides.

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
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout, except activity_type''s icon backfill which uses on conflict do update). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Restored in 20260830110000_fix_seed_default_reference_lists_regression.sql: 20260829100000_articles_core.sql''s own CREATE OR REPLACE had accidentally dropped the work_order_status/work_order_priority/contract_type/sla_tier/billing_terms/time_entry_type/quote_status/activity_type/activity_status blocks (the THIRD time this class of regression has happened — see that fix migration''s design note for the full incident history and the "copy the full live function body forward, don''t reconstruct by hand" guidance for next time). Future picklists should extend this function the same way, plus a one-time backfill call in that feature''s own migration.';

-- Backfill: restore any list_key block missing due to the regression, for
-- every organization that already existed before this migration ran — the
-- organizations_seed_reference_lists trigger only fires for future inserts.
-- Live-checked before this migration: every currently-existing organization
-- predates the regression and already has these lists, so this is a no-op
-- today — kept as the standing safety net every prior backfill in this file
-- provides.
do $$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform public.seed_default_reference_lists(r.id);
  end loop;
end;
$$;
