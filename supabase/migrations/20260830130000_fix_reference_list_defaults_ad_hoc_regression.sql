-- Fix (issue #99): "Create Quote" on a Work Order failed with `null value in
-- column "status_id" of relation "quotes" violates not-null constraint`.
--
-- This is the SAME symptom class as
-- `20260828100000_fix_missing_reference_list_defaults.sql` (1st occurrence)
-- and `20260830110000_fix_seed_default_reference_lists_regression.sql` (2nd
-- occurrence) — a THIRD occurrence, but with a genuinely different root
-- cause than either of those two, confirmed live against the linked project
-- (`fxpjzcyeevtaadexnkub`, "norr") rather than assumed from the prior fix
-- migrations' own claims (which is exactly what this issue asked to
-- re-verify, since `20260830110000`'s header explicitly claimed "every
-- currently-existing organization already has all these lists... this
-- backfill is a no-op today" — that claim is what turned out to be false).
--
-- ROOT CAUSE (live evidence, not theory):
--
-- 1. Queried every `reference_list_items` row for all 4 organizations that
--    currently exist in this project (Norr, Jansen Client, LINKIT,
--    mjansen1981's organization). Every single default-bearing flat list —
--    `asset_type`, `asset_status`, `contact_role`, `work_order_status`,
--    `work_order_priority`, `contract_type`, `billing_terms`,
--    `time_entry_type`, `quote_status`, `asset_brand`, `activity_status`,
--    `article_unit`, `article_manufacturer`, `vat_rate` — has ZERO items
--    with `is_default = true`, for EVERY organization. Not just
--    `quote_status`: this is a comprehensive, org-wide, list-wide gap, not
--    an isolated one-list/one-org miss.
--
-- 2. This is NOT the same defect `20260830110000` fixed (a CREATE OR REPLACE
--    that silently dropped entire `reference_lists` rows for several
--    list_keys). Live-checked: every one of the `reference_lists` rows above
--    exists, with its full, correct set of `reference_list_items` rows
--    (right labels, right values, right counts) — only `is_default` is
--    wrong. This is exactly the "list exists, but has zero default-flagged
--    items" failure mode `derive_quote_organization_id` (and its
--    `work_orders`/`contracts`/`assets`/`activities` siblings) can't recover
--    from: `select ... where rli.is_default limit 1` returns no row, leaving
--    `status_id`/`type_id` unset, hence the not-null violation.
--
-- 3. Fetched `pg_get_functiondef('seed_default_reference_lists')` directly
--    from the live database and confirmed it matches this repo's
--    `20260830110000` migration byte-for-byte — so the CURRENT function body
--    is correct and complete (all list_key blocks present, all `is_default`
--    literals correct in the INSERT statements). Also fetched the exact
--    `statements` array `20260828100000` (the first fix migration) recorded
--    in `supabase_migrations.schema_migrations` and confirmed it matches
--    this repo's file byte-for-byte too, with 10 `UPDATE ... SET is_default
--    = true` statements that DID run successfully against this project.
--
-- 4. So `is_default` WAS correctly set to `true` at some point (by
--    `20260828100000`, and by every list's own initial seed INSERT), then
--    was reset to `false` afterward. Evidence for "reset afterward, not
--    never-set": every affected row's `updated_at` is clustered at one of
--    two identical, cross-organization timestamps — all 4 orgs'
--    `asset_status`/`active` rows share the exact same `updated_at`
--    (2026-08-29 20:25:40.846171+00), and all 4 orgs' `quote_status`/`draft`
--    AND `work_order_status`/`new` rows share a second exact same
--    `updated_at` (2026-08-30 06:15:47.084111+00). A single `UPDATE`
--    statement touching many rows at once produces exactly this signature
--    (Postgres bumps `updated_at` via `set_updated_at` on ANY update to a
--    row, even one that leaves other columns unchanged) — it does not match
--    per-org trigger-driven inserts (those would have distinct, per-org
--    creation timestamps, as `created_at` on these same rows does).
--
-- 5. Searched every migration file in this repo for any statement that
--    could explain those two update events: no migration after
--    `20260828100000` contains an `UPDATE ... reference_list_items ...
--    is_default` statement, or an `on conflict ... do update` that touches
--    `is_default` for any of the affected list_keys (the only `do update`
--    clauses in the whole migration history are `asset_type`'s label
--    backfill in `20260822200000` and `activity_type`'s icon-only backfill
--    in `20260828090000`/`20260830110000` — neither touches `is_default`,
--    and neither is one of the affected list_keys' blocks). The app layer
--    was also checked (`lib/reference-lists/actions.ts`,
--    `updateReferenceItem`): its UPDATE payload builder never includes
--    `is_default` in any code path, and no UI in this repo (checked
--    `app/(app)/settings/components/reference-list-manager.tsx`) exposes a
--    way to change it — `is_default` is read-only end-to-end at the
--    application layer today.
--
-- Conclusion: the two reset events did not originate from this repo's
-- migration history or from the application. They match direct/ad hoc SQL
-- executed straight against this linked project outside the migration
-- pipeline — most plausibly a previous live-debugging session (per this
-- project's incident history, `20260830100000`/`20260830110000`'s own
-- headers describe live-probing this exact failure mode against real
-- organizations around the same wall-clock window as the second reset
-- timestamp above) that flipped `is_default` off to reproduce/verify a bug
-- and never restored it — an ad hoc production edit, which is exactly what
-- this file's own house rule ("never edit the database ad hoc") exists to
-- prevent. Flagging for next time: reproducing a bug against live data
-- (which this issue itself also requires, see below) must always be done
-- inside a rolled-back transaction, never a bare committed `UPDATE`.
--
-- LIVE REPRODUCTION (before this fix): confirmed in a rolled-back
-- transaction against a real client in the "Norr" organization —
-- `insert into public.quotes (client_id, name) values (...)` (status_id
-- omitted, as the application always does) raised exactly:
--   `ERROR: 23502: null value in column "status_id" of relation "quotes"
--   violates not-null constraint`
-- and, confirming the sibling-impact concern this issue raised, the
-- identical insert against `public.work_orders` (status_id omitted) raised
-- the same violation on `work_orders.status_id` too — i.e. `contracts` and
-- `activities` are silently exposed to the same failure the next time
-- anyone omits their status/type column, since their default items are
-- equally zeroed out right now.
--
-- FIX:
--
-- 1. `ensure_reference_list_defaults(p_organization_id uuid)`: a new,
--    reusable, idempotent function that re-applies the exact same guarded
--    "set is_default = true where this list currently has zero default
--    items" logic `20260828100000` used, but as a single data-driven UPDATE
--    over a canonical (list_key -> intended default value) table instead of
--    one repeated block per list_key — both because that's genuinely less
--    error-prone to extend (the exact kind of hand-copy mistake that caused
--    `20260830110000`'s regression can't happen here: adding a future
--    picklist's default is one new row in the `values (...)` list, not a
--    new near-identical `update ... where ...` block to get right), and
--    because an ad hoc `is_default` reset happening again (outside this
--    repo's control, per the root cause above) is exactly the scenario this
--    function exists to make trivially recoverable from — one function call
--    per organization, safe to run any time, never clobbers a list that
--    already has a default. `activity_type` (deliberately no default — the
--    type picker always requires an explicit choice, per
--    `20260828090000`'s own design note) and the two dependent lists
--    (`asset_subtype`, `sla_tier` — no `is_default` concept, items are
--    scoped by `parent_item_id` instead) are correctly absent from the
--    defaults table.
--
-- 2. `seed_default_reference_lists` (CREATE OR REPLACE, full body copied
--    forward verbatim from `pg_get_functiondef` on the live database per
--    (3) above — not reconstructed by hand, per the explicit guidance
--    `20260830110000`'s own header left for next time): unchanged except
--    for one new line at the end, `perform
--    public.ensure_reference_list_defaults(p_organization_id);` — so every
--    future new-organization seed (via `organizations_seed_reference_lists`)
--    and every future feature migration's backfill call both also
--    self-heal any pre-existing default gap for that organization, not just
--    seed brand-new list_keys. This does not fix "someone runs ad hoc SQL
--    against production" (nothing at the schema layer can), but it does mean
--    the next time any migration in this codebase calls
--    `seed_default_reference_lists` for any reason, every organization's
--    defaults get re-verified as a side effect, for free.
--
-- 3. Backfill: `ensure_reference_list_defaults(r.id)` for every organization
--    that currently exists — unlike `20260830110000`'s backfill (confirmed
--    live to be a no-op, since it only re-ran `on conflict do nothing`
--    inserts against rows that already existed), THIS backfill actually
--    changes data: it flips `is_default` back to `true` for the correct item
--    in every one of the 14 affected lists, for all 4 currently-existing
--    organizations.
-- ---------------------------------------------------------------------------

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
  'Idempotent, safe to re-run at any time: for every (list_key, default value) pair a tenant-configurable picklist is meant to have exactly one is_default item for, sets is_default = true on that item IF AND ONLY IF the list currently has zero default items (never clobbers an org''s existing default). Introduced in 20260830130000_fix_reference_list_defaults_ad_hoc_regression.sql as the reusable form of 20260828100000''s one-off fix, after live evidence showed every affected list''s is_default flag had been reset to false again post-fix (root cause: an ad hoc UPDATE run directly against the linked database outside this repo''s migrations, NOT a defect in seed_default_reference_lists itself — see that migration''s header for the full live evidence trail). Called from seed_default_reference_lists (so every future seed/backfill call also self-heals this) and directly in this migration''s own backfill loop. activity_type (deliberately no default) and the dependent lists asset_subtype/sla_tier (no is_default concept) are intentionally absent from the values list here. Extend this list, not a new one-off UPDATE block, when a future picklist needs a default.';

revoke all on function public.ensure_reference_list_defaults(uuid) from public;

-- seed_default_reference_lists: full body copied forward verbatim from
-- pg_get_functiondef('public.seed_default_reference_lists(uuid)') on the
-- live database (confirmed byte-identical to 20260830110000's version
-- before this edit), plus one new line at the very end calling
-- ensure_reference_list_defaults — see design note 2 above.
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

  -- Self-heal: re-verify every list above (plus any earlier picklist) still
  -- has its intended default item, in case is_default was reset outside
  -- this function's control (e.g. an ad hoc edit — see design note 2 in this
  -- migration's header). New as of
  -- 20260830130000_fix_reference_list_defaults_ad_hoc_regression.sql.
  perform public.ensure_reference_list_defaults(p_organization_id);
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout, except activity_type''s icon backfill which uses on conflict do update). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. As of 20260830130000_fix_reference_list_defaults_ad_hoc_regression.sql, also calls ensure_reference_list_defaults(p_organization_id) at the end, so every seed/backfill call self-heals any is_default gap for that organization, not just seeds brand-new list_keys. Future picklists should extend this function the same way (a new list_key block, plus a row in ensure_reference_list_defaults'' values list if it needs a default), plus a one-time backfill call in that feature''s own migration.';

-- Backfill: actually restores is_default = true (unlike 20260830110000's
-- backfill, confirmed live to have been a no-op) for every organization that
-- currently exists — the organizations_seed_reference_lists trigger only
-- fires for future inserts, and calling seed_default_reference_lists itself
-- would work too (it now calls ensure_reference_list_defaults internally)
-- but calling ensure_reference_list_defaults directly is cheaper (skips
-- re-running 14 blocks of already-satisfied "on conflict do nothing"
-- inserts) and is exactly what a future incident of this same class should
-- reach for first.
do $$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform public.ensure_reference_list_defaults(r.id);
  end loop;
end;
$$;
