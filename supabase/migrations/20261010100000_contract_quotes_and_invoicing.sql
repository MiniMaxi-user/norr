-- Issues #210 (generate draft quotes from due contracts) and #211 (invoice
-- quotes). Schema only; generation/invoicing/e-mail logic is application-layer.
--
-- Design notes:
--
-- 1. quotes.quote_type is a FIXED SYSTEM ENUM (public.quote_type: 'default',
--    'contract'), not a tenant reference list: application code branches on
--    it. Not null, default 'default' (existing rows backfilled by the default).
--    Client-writable on INSERT only (the contract-quote server action runs
--    under the user's session); NOT in the UPDATE grant, so it is immutable.
-- 2. quotes.contract_id (FK contracts, ON DELETE SET NULL, indexed) and
--    quotes.contract_period_start/_end (the invoiced period). CHECKs require
--    period dates for type 'contract', forbid contract fields on 'default'
--    quotes, and enforce end >= start. Presence of contract_id for a contract
--    quote cannot be a CHECK (ON DELETE SET NULL would violate it later), so
--    the BEFORE INSERT trigger quotes_validate_contract enforces it on insert
--    together with same-organization / same-client validation. It is not
--    re-run on update: none of the contract columns has an UPDATE grant.
-- 3. Partial unique index (contract_id, contract_period_start) for contract
--    quotes with a contract: no duplicate quote for one contract period.
-- 4. quote_status gains the item 'invoiced' (existing orgs backfilled and the
--    seed function extended; newest seed body copied verbatim from
--    20261010090000, only this item added).
-- 5. invoices: pdf_path becomes nullable (PDFs are rendered on demand; column
--    kept for old rows). Invoices become PERMANENT: delete policy and delete
--    grant removed. emailed_to / emailed_at / email_error added and are the
--    only UPDATE-able columns (new update policy, owner/administratie, same
--    scope as insert). Note: deleting a QUOTE still cascades to its invoice
--    (FK unchanged, see invoices_core); invoiced quotes should not be deleted.
-- 6. AFTER INSERT trigger on invoices advances contracts.invoiced_period_count
--    by one for an invoiced contract quote (SECURITY DEFINER, since the
--    counter is not client-writable). contracts_compute_next_invoice_date then
--    advances next_invoice_date. quote_id is unique on invoices, so this runs
--    at most once per quote.
-- 7. invoice_email_settings: one row per organization (PK = organization_id).

-- ---------------------------------------------------------------------------
-- quotes
-- ---------------------------------------------------------------------------
create type public.quote_type as enum ('default', 'contract');

alter table public.quotes
  add column quote_type public.quote_type not null default 'default',
  add column contract_id uuid references public.contracts (id) on delete set null,
  add column contract_period_start date,
  add column contract_period_end date,
  add constraint quotes_contract_period_required
    check (quote_type <> 'contract' or (contract_period_start is not null and contract_period_end is not null)),
  add constraint quotes_contract_fields_only_for_contract_type
    check (quote_type = 'contract' or (contract_id is null and contract_period_start is null and contract_period_end is null)),
  add constraint quotes_contract_period_order
    check (contract_period_start is null or contract_period_end is null or contract_period_end >= contract_period_start);

comment on column public.quotes.quote_type is
  'System enum: default (human/work-order quote) or contract (generated from a due contract, issue #210). Writable on INSERT only; immutable afterwards.';
comment on column public.quotes.contract_id is
  'The contract a contract-type quote was generated for. ON DELETE SET NULL keeps the quote if the contract is deleted. Must belong to the same organization and client as the quote (quotes_validate_contract); required on insert when quote_type = contract.';
comment on column public.quotes.contract_period_start is
  'First day of the contract period this quote invoices. Required for contract quotes.';
comment on column public.quotes.contract_period_end is
  'Last day of the contract period this quote invoices. Required for contract quotes; >= contract_period_start.';

create index quotes_contract_id_idx on public.quotes (contract_id);

create unique index quotes_one_contract_quote_per_period_idx
  on public.quotes (contract_id, contract_period_start)
  where quote_type = 'contract' and contract_id is not null;

create or replace function public.validate_quote_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract_org uuid;
  v_contract_client uuid;
begin
  if new.quote_type = 'contract' and new.contract_id is null then
    raise exception 'quotes.contract_id is required for a contract quote'
      using errcode = '23514';
  end if;

  if new.contract_id is not null then
    select c.organization_id, c.client_id into v_contract_org, v_contract_client
    from public.contracts c
    where c.id = new.contract_id;

    if v_contract_org is null then
      raise exception 'quotes.contract_id % does not reference an existing contract', new.contract_id
        using errcode = '23503';
    elsif v_contract_org <> new.organization_id then
      raise exception 'quotes.contract_id must belong to the same organization as the quote'
        using errcode = '23514';
    elsif v_contract_client <> new.client_id then
      raise exception 'quotes.contract_id must belong to the same client as the quote'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_quote_contract() is
  'BEFORE INSERT trigger on public.quotes (issue #210): contract quotes must carry a contract_id; a contract_id must exist and share the quote''s organization and client. Sorts after quotes_derive_organization_id so new.organization_id is final. INSERT only: ON DELETE SET NULL later nulls contract_id legitimately.';

create trigger quotes_validate_contract
  before insert on public.quotes
  for each row execute function public.validate_quote_contract();

-- INSERT only: immutable afterwards (no UPDATE grant).
grant insert (quote_type, contract_id, contract_period_start, contract_period_end)
  on public.quotes to authenticated;

-- ---------------------------------------------------------------------------
-- quote_status: 'invoiced' item. Seed function = newest body (20261010090000)
-- with only the new item added.
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

  -- invoiced: NEW quote_status item (issues #210/#211) — set on a contract
  -- quote once it has been invoiced. Own insert (not folded into the block
  -- above) so the original five rows stay byte-identical; color applied via
  -- the insert itself, never overwritten on conflict.
  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default, color)
  values
    (v_quote_status_list_id, p_organization_id, 'invoiced', 'Invoiced', 6, false, 'green')
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
  'Idempotent (on conflict do nothing throughout, except activity_type''s icon backfill which uses on conflict do update). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Also calls ensure_reference_list_defaults(p_organization_id) at the end (restored here — see 20260907100000_fix_seed_default_reference_lists_regression_3.sql''s header, BUG 1/BUG 2), so every seed/backfill call self-heals any is_default gap for that organization, not just seeds brand-new list_keys. Restored in 20260907100000_fix_seed_default_reference_lists_regression_3.sql: 20260905100000_contracts_billing_period_line_items_and_article_rules.sql''s own CREATE OR REPLACE had accidentally dropped several list_key blocks AND the trailing ensure_reference_list_defaults call (the FOURTH time this class of regression has happened — see that fix migration''s design note for the full incident history and the "copy the full live function body forward via pg_get_functiondef, don''t reconstruct by hand" guidance). Extended in 20260910090000_reference_list_items_description_active_and_volume_list.sql with a `volume` block (issue #131). Extended in 20260915090000_region_reference_list.sql (issue #164) with a `region` block and a new `inspectie` activity_type item. Extended in 20260918090000_service_area_seed_and_work_regions.sql (issue #192) with a 4th `region` item, `intern_werkplaats`. Extended in 20260919090000_translate_default_reference_list_labels_to_english.sql (issue #196): translated remaining Dutch default labels to English. Extended in 20260920100000_work_order_checkout_status.sql (issue #203, "Checkout workitem naar pwa"): inserted a new `checkout` item into `work_order_status` between `scheduled` and `en_route` (sort_order 3; `en_route`/`in_progress`/`completed`/`invoiced` shifted from 3/4/5/6 to 4/5/6/7). Extended in 20260920110000_work_order_to_review_status.sql: inserted a new `to_review` item into `work_order_status` between `in_progress` and `completed` (sort_order 6; `completed`/`invoiced` shifted from 6/7 to 7/8), label shipped as Dutch (`Te controleren`) at the time. Extended in 20260920120000_work_order_to_review_label_to_english.sql: corrected that `to_review` label from Dutch (`Te controleren`) to English (`To review`), for consistency with every other item in this list and this repo''s "code always English" convention — the earlier "deliberate exception" belief was incorrect; no value slug or sort_order changed. Extended in 20261010090000_contract_next_invoice_date.sql (issue #209): the billing_terms items now carry interval_months (monthly=1, quarterly=3, annually=12, per_visit/one_time null). Extended in 20261010100000_contract_quotes_and_invoicing.sql (issues #210/#211): quote_status gains an `invoiced` item (sort_order 6, color green). Future picklists should extend this function the same way (a new list_key block, plus a row in ensure_reference_list_defaults'' values list if it needs a default), plus a one-time backfill call in that feature''s own migration.';

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
-- invoices
-- ---------------------------------------------------------------------------
alter table public.invoices
  alter column pdf_path drop not null,
  add column emailed_to text,
  add column emailed_at timestamptz,
  add column email_error text;

comment on column public.invoices.pdf_path is
  'Legacy: Storage path of a stored PDF. Nullable since 20261010100000 -- PDFs are now rendered on demand and not stored.';
comment on column public.invoices.emailed_to is 'Recipient the invoice was last e-mailed to (issue #211). Set by the app after sending.';
comment on column public.invoices.emailed_at is 'When the invoice was last e-mailed successfully.';
comment on column public.invoices.email_error is 'Last e-mail sending error, if any.';

-- Invoices are permanent: no delete.
drop policy "invoices_delete_owner_or_administratie" on public.invoices;
revoke delete on public.invoices from authenticated;

create policy "invoices_update_owner_or_administratie"
on public.invoices
for update
to authenticated
using (public.current_member_role(organization_id) in ('owner', 'administratie'))
with check (public.current_member_role(organization_id) in ('owner', 'administratie'));

grant update (emailed_to, emailed_at, email_error) on public.invoices to authenticated;

create or replace function public.advance_contract_on_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract_id uuid;
  v_type public.quote_type;
begin
  select q.contract_id, q.quote_type into v_contract_id, v_type
  from public.quotes q
  where q.id = new.quote_id;

  if v_type = 'contract' and v_contract_id is not null then
    update public.contracts
    set invoiced_period_count = invoiced_period_count + 1
    where id = v_contract_id;
  end if;

  return null;
end;
$$;

comment on function public.advance_contract_on_invoice() is
  'AFTER INSERT trigger on public.invoices (issue #211): increments contracts.invoiced_period_count for an invoiced contract quote; contracts_compute_next_invoice_date then advances next_invoice_date. At most once per quote (invoices.quote_id is unique).';

create trigger invoices_advance_contract_period
  after insert on public.invoices
  for each row execute function public.advance_contract_on_invoice();

-- ---------------------------------------------------------------------------
-- invoice_email_settings: one row per organization.
-- ---------------------------------------------------------------------------
create table public.invoice_email_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  from_email text,
  from_name text,
  cc_email text,
  subject_template text,
  body_template text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_email_settings_from_email_format
    check (from_email is null or from_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint invoice_email_settings_cc_email_format
    check (cc_email is null or cc_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

comment on table public.invoice_email_settings is
  'Per-organization invoice e-mail configuration (issue #211): sender, CC and subject/body templates. One row per organization. owner/administratie only (same boundary as invoices). organization_id is the primary key; RLS WITH CHECK restricts it to organizations where the caller is owner/administratie, and it is not in the UPDATE grant.';

create index invoice_email_settings_created_by_idx on public.invoice_email_settings (created_by);

alter table public.invoice_email_settings enable row level security;
alter table public.invoice_email_settings force row level security;

create trigger invoice_email_settings_set_created_by
  before insert on public.invoice_email_settings
  for each row execute function public.set_created_by();

create trigger invoice_email_settings_set_updated_at
  before update on public.invoice_email_settings
  for each row execute function public.set_updated_at();

create policy "invoice_email_settings_select_owner_or_administratie"
on public.invoice_email_settings
for select
to authenticated
using (public.current_member_role(organization_id) in ('owner', 'administratie'));

create policy "invoice_email_settings_insert_owner_or_administratie"
on public.invoice_email_settings
for insert
to authenticated
with check (public.current_member_role(organization_id) in ('owner', 'administratie'));

create policy "invoice_email_settings_update_owner_or_administratie"
on public.invoice_email_settings
for update
to authenticated
using (public.current_member_role(organization_id) in ('owner', 'administratie'))
with check (public.current_member_role(organization_id) in ('owner', 'administratie'));

revoke all on public.invoice_email_settings from authenticated;
grant select on public.invoice_email_settings to authenticated;
grant insert (organization_id, from_email, from_name, cc_email, subject_template, body_template)
  on public.invoice_email_settings to authenticated;
grant update (from_email, from_name, cc_email, subject_template, body_template)
  on public.invoice_email_settings to authenticated;
