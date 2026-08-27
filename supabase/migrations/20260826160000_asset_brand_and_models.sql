-- Asset reference data: Brand + Model (issue #54, "Als gebruiker wil ik
-- referentietabellen kunnen beheren voor Assets"). Extends both mechanisms
-- documented in 20260822200000_reference_lists.sql (generic reference-list
-- pattern) and 20260823090000_contacts_dependent_reference_lists.sql
-- (parent_list_key/parent_item_id single-parent dependent-list mechanism) —
-- read those two migrations' header comments before touching this one.
--
-- Two things in this migration:
--
-- 1. `asset_brand` — a new FLAT reference list (no `parent_list_key`), same
--    shape as `asset_type`/`asset_status`. Extends `seed_default_reference_lists`
--    per its documented extension pattern, seeded with a small realistic set
--    of MFP/printer-industry brands (this story's own acceptance criteria are
--    entirely about Kyocera MFP testdata — the seed choice mirrors that
--    vertical the same way `asset_type`'s own defaults picked a realistic
--    general set, not because every tenant sells printers), plus a one-time
--    backfill call for organizations that already existed. "Brand" (this
--    story) and "Manufacturer" (issue #53, not built here) are the same
--    underlying concept under two labels from the product owner — this list
--    is named `asset_brand`, matching this codebase's `asset_type`/
--    `asset_status`/`asset_subtype` naming (concept_qualifier, not the raw
--    product-owner label).
--
-- 2. `asset_models` — a genuinely new, DEDICATED table, NOT another
--    `reference_list_items` row. A Model needs three simultaneous
--    associations (Brand + Type + Sub-type) plus its own structured field
--    (`default_warranty_months`); the dependent-list mechanism from (2) in
--    the contacts migration is single-parent only (one `parent_list_key` per
--    list), and `reference_list_items`' generic shape (value/label/color/
--    sort_order/is_default) has nowhere to hang a second/third relationship
--    or an extra typed column without polluting that shared table for every
--    other `list_key` that doesn't need any of it. Same RLS/grant-lockdown
--    shape as every other tenant-scoped table in this schema (owner
--    configures, any member reads), `organization_id` supplied directly on
--    insert (checked by RLS) rather than derived from a single parent FK —
--    same as `reference_lists.organization_id` and `clients.organization_id`,
--    since a model has no single unambiguous parent row to derive it from
--    (it has three: brand/type/subtype, each already organization-scoped
--    reference-list items in their own right).
--
--    Cascade integrity (the story's "Bij een model kan je een Type en een
--    subtype selecteren" requirement) is enforced at the DB layer, not just
--    left to the UI's cascading dropdown: `validate_asset_model_reference_items`
--    (same structural style as `validate_asset_reference_items`/
--    `validate_contact_role_item`) rejects a `brand_item_id`/`type_item_id`
--    from the wrong `list_key` or a different organization, AND rejects a
--    `subtype_item_id` whose own `parent_item_id` does not equal this row's
--    `type_item_id` — the same cross-field check
--    `validate_asset_reference_items` already does for `assets.subtype_id`/
--    `assets.type_id`, applied here to `asset_models` instead.
--
-- 3. One-time Kyocera MFP testdata (the story's own acceptance criterion:
--    "Er zijn een aantal voorbeelden voor Kyocera MFP machines in de
--    database gevuld als testdata"): a `Printer / MFP` asset_type item, three
--    asset_subtype items under it (Color MFP / Mono MFP / Wide Format), and
--    six real Kyocera model rows (mixed warranty periods, not all left at the
--    24-month default). Seeded ONCE, directly in this migration, for every
--    organization that exists TODAY — deliberately NOT folded into
--    `seed_default_reference_lists`'s automatic new-org trigger path, since
--    this is demo/test data for one vertical, not a universal new-org
--    default (same "backfill existing, don't auto-seed forever" distinction
--    20260822200000_reference_lists.sql already draws for its own historical
--    backfill block).

-- ---------------------------------------------------------------------------
-- 1. asset_brand: extend seed_default_reference_lists with a new flat list.
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
  v_asset_brand_list_id uuid;
  v_hvac_id uuid;
  v_electrical_id uuid;
  v_plumbing_id uuid;
  v_generator_id uuid;
  v_other_id uuid;
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

  -- contact_role: for contacts.role_item_id (issue #26). Not a dependent
  -- list — flat, like asset_type/asset_status.
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

  -- asset_subtype: pilot dependent list (issue #26), parent_list_key =
  -- asset_type. Each item's parent_item_id points at the matching
  -- asset_type item just seeded/looked-up above, in this same organization.
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

  -- asset_brand: for asset_models.brand_item_id (issue #54). Flat, like
  -- asset_type/asset_status/contact_role — not dependent on anything.
  -- Default set is a realistic MFP/printer-industry brand list (this
  -- story's own testdata requirement is Kyocera MFPs specifically; Canon/
  -- Ricoh/Xerox round it out as comparable real vendors in the same
  -- vertical, the same "realistic default set for the vertical this story
  -- exercises" reasoning asset_type's own HVAC/Electrical/Plumbing/Generator
  -- defaults already used).
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
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Extended in 20260826160000_asset_brand_and_models.sql with an asset_brand (flat) block for asset_models.brand_item_id. Future picklists should extend this function the same way, plus a one-time backfill call in that feature''s own migration.';

-- Backfill: seed the new asset_brand list (and any missing items from
-- earlier list_key blocks) for every organization that already existed
-- before this migration ran — the organizations_seed_reference_lists
-- trigger only fires for future inserts.
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
-- 2. asset_models: dedicated table (see header comment for why this isn't a
--    reference_list_items row). organization_id is supplied directly on
--    insert (checked by RLS), same as reference_lists.organization_id /
--    clients.organization_id — a model has three independent
--    organization-scoped parents (brand/type/subtype), not one unambiguous
--    FK to derive organization_id from.
-- ---------------------------------------------------------------------------
create table public.asset_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  brand_item_id uuid not null references public.reference_list_items (id),
  type_item_id uuid not null references public.reference_list_items (id),
  subtype_item_id uuid references public.reference_list_items (id),
  name text not null,
  default_warranty_months integer not null default 24,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, brand_item_id, name),
  constraint asset_models_default_warranty_months_positive check (default_warranty_months > 0)
);

comment on table public.asset_models is
  'A configurable equipment model (e.g. "TASKalfa 3554ci"), tied to a Brand + Type and optionally a Sub-type, with a default warranty period in months. Dedicated table, not a reference_list_items row — see the design note at the top of 20260826160000_asset_brand_and_models.sql for why (three simultaneous list associations plus a typed default_warranty_months column, neither of which the generic reference_list_items shape can hang cleanly). RLS/grant shape mirrors reference_lists/checklist_templates exactly: any org member reads, owner configures.';
comment on column public.asset_models.organization_id is
  'Supplied directly on insert, checked by RLS (is_org_owner), same as reference_lists.organization_id / clients.organization_id — not derived from a single parent FK because brand_item_id/type_item_id/subtype_item_id are each already independent, organization-scoped reference_list_items rows, not one unambiguous parent to denormalize from.';
comment on column public.asset_models.brand_item_id is
  'FK into reference_list_items for this organization''s asset_brand reference list. Required (Brand is verplicht per issue #54''s acceptance criteria) — enforced at the column level (not null) since exactly one brand is always meaningful, unlike the nullable subtype_item_id. Validated (list_key + organization match) by validate_asset_model_reference_items.';
comment on column public.asset_models.type_item_id is
  'FK into reference_list_items for this organization''s asset_type reference list. Required. Validated (list_key + organization match) by validate_asset_model_reference_items.';
comment on column public.asset_models.subtype_item_id is
  'FK into reference_list_items for this organization''s asset_subtype reference list. Nullable — not every type has meaningful subtypes. Validated by validate_asset_model_reference_items: must be an asset_subtype item in this row''s own organization AND its parent_item_id must equal this row''s own type_item_id — the DB-level cascade-integrity backstop for the story''s "Bij een model kan je een Type en een subtype selecteren" requirement (a subtype from under a different type can never be attached to a model whose type doesn''t match it), mirroring assets.subtype_id/type_id''s exact cross-field check in validate_asset_reference_items.';
comment on column public.asset_models.default_warranty_months is
  'Standard warranty period, in months, applied by default when this model is used on an asset. Not not-null-defaulted-and-forgotten — a real per-model, tenant-configurable field (default 24, per issue #54''s acceptance criteria), independently overridable per model (e.g. 12 or 36 for a different product tier).';

create index asset_models_organization_id_idx on public.asset_models (organization_id);
create index asset_models_brand_item_id_idx on public.asset_models (brand_item_id);
create index asset_models_type_item_id_idx on public.asset_models (type_item_id);
create index asset_models_subtype_item_id_idx on public.asset_models (subtype_item_id);
create index asset_models_created_by_idx on public.asset_models (created_by);

alter table public.asset_models enable row level security;
alter table public.asset_models force row level security;

-- Validates that brand_item_id/type_item_id/subtype_item_id each point at an
-- item from the correct list_key, in this row's own organization — same
-- structural style as validate_asset_reference_items/validate_contact_role_item
-- — plus the subtype/type cascade cross-field check (mirrors
-- assets.subtype_id/type_id in validate_asset_reference_items exactly).
create or replace function public.validate_asset_model_reference_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand_org uuid;
  v_brand_key text;
  v_type_org uuid;
  v_type_key text;
  v_subtype_org uuid;
  v_subtype_key text;
  v_subtype_parent_item_id uuid;
begin
  select rl.organization_id, rl.list_key into v_brand_org, v_brand_key
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rli.id = new.brand_item_id;

  if v_brand_org is null then
    raise exception 'asset_models.brand_item_id % does not reference an existing reference_list_items row', new.brand_item_id
      using errcode = '23503';
  elsif v_brand_key <> 'asset_brand' then
    raise exception 'asset_models.brand_item_id must reference an item from the asset_brand reference list (got list_key=%)', v_brand_key
      using errcode = '23514';
  elsif v_brand_org <> new.organization_id then
    raise exception 'asset_models.brand_item_id must belong to the same organization as the asset model'
      using errcode = '23514';
  end if;

  select rl.organization_id, rl.list_key into v_type_org, v_type_key
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rli.id = new.type_item_id;

  if v_type_org is null then
    raise exception 'asset_models.type_item_id % does not reference an existing reference_list_items row', new.type_item_id
      using errcode = '23503';
  elsif v_type_key <> 'asset_type' then
    raise exception 'asset_models.type_item_id must reference an item from the asset_type reference list (got list_key=%)', v_type_key
      using errcode = '23514';
  elsif v_type_org <> new.organization_id then
    raise exception 'asset_models.type_item_id must belong to the same organization as the asset model'
      using errcode = '23514';
  end if;

  if new.subtype_item_id is not null then
    select rl.organization_id, rl.list_key, rli.parent_item_id
    into v_subtype_org, v_subtype_key, v_subtype_parent_item_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.subtype_item_id;

    if v_subtype_org is null then
      raise exception 'asset_models.subtype_item_id % does not reference an existing reference_list_items row', new.subtype_item_id
        using errcode = '23503';
    elsif v_subtype_key <> 'asset_subtype' then
      raise exception 'asset_models.subtype_item_id must reference an item from the asset_subtype reference list (got list_key=%)', v_subtype_key
        using errcode = '23514';
    elsif v_subtype_org <> new.organization_id then
      raise exception 'asset_models.subtype_item_id must belong to the same organization as the asset model'
        using errcode = '23514';
    elsif v_subtype_parent_item_id is distinct from new.type_item_id then
      raise exception 'asset_models.subtype_item_id must be a sub-type of the model''s own type_item_id (the subtype item''s parent_item_id must equal asset_models.type_item_id)'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_asset_model_reference_items() is
  'BEFORE INSERT/UPDATE OF brand_item_id, type_item_id, subtype_item_id trigger on public.asset_models: rejects an item from the wrong list_key or a different organization''s reference list (brand/type/subtype alike), and additionally rejects a subtype_item_id whose parent_item_id does not match this row''s own type_item_id — same cross-field cascade check validate_asset_reference_items performs for assets.subtype_id/type_id. organization_id is supplied directly (not derived by a BEFORE trigger), so it is already final by the time this trigger runs.';

create trigger asset_models_validate_reference_items
  before insert or update of brand_item_id, type_item_id, subtype_item_id on public.asset_models
  for each row execute function public.validate_asset_model_reference_items();

create trigger asset_models_set_created_by
  before insert on public.asset_models
  for each row execute function public.set_created_by();

create trigger asset_models_set_updated_at
  before update on public.asset_models
  for each row execute function public.set_updated_at();

-- RLS: identical shape to reference_lists/checklist_templates — select: any
-- org member; write: owner only.
create policy "asset_models_select_member"
on public.asset_models
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "asset_models_insert_owner"
on public.asset_models
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "asset_models_update_owner"
on public.asset_models
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "asset_models_delete_owner"
on public.asset_models
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.asset_models from authenticated;

grant select, delete on public.asset_models to authenticated;
-- organization_id is insertable (like reference_lists.organization_id) but
-- not updatable — no legitimate "move this model to a different
-- organization" action, matching every other tenant-scoped table's
-- immutable-organization_id stance. created_by intentionally excluded from
-- both: trigger-stamped by set_created_by.
grant insert (
  organization_id, brand_item_id, type_item_id, subtype_item_id, name, default_warranty_months
) on public.asset_models to authenticated;
grant update (
  brand_item_id, type_item_id, subtype_item_id, name, default_warranty_months
) on public.asset_models to authenticated;

-- ---------------------------------------------------------------------------
-- 3. One-time Kyocera MFP testdata backfill (issue #54 acceptance
--    criterion), for every organization that exists today. NOT part of
--    seed_default_reference_lists — this is demo/test data for one
--    vertical, not a universal new-org default (see header comment).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_asset_type_list_id uuid;
  v_asset_subtype_list_id uuid;
  v_asset_brand_list_id uuid;
  v_printer_type_id uuid;
  v_color_mfp_id uuid;
  v_mono_mfp_id uuid;
  v_wide_format_id uuid;
  v_kyocera_id uuid;
  v_next_sort integer;
begin
  for r in select id from public.organizations loop
    select id into v_asset_type_list_id
    from public.reference_lists
    where organization_id = r.id and list_key = 'asset_type';

    select id into v_asset_subtype_list_id
    from public.reference_lists
    where organization_id = r.id and list_key = 'asset_subtype';

    select id into v_asset_brand_list_id
    from public.reference_lists
    where organization_id = r.id and list_key = 'asset_brand';

    -- Defensive: these three lists are always seeded per-org by
    -- seed_default_reference_lists (including the backfill run just above
    -- in this same migration), but skip an organization missing any of
    -- them rather than fail the whole backfill loop.
    if v_asset_type_list_id is null or v_asset_subtype_list_id is null or v_asset_brand_list_id is null then
      continue;
    end if;

    -- asset_type: "Printer / MFP" — reuse an existing equivalent item
    -- rather than create a duplicate if one already exists in this org.
    select id into v_printer_type_id
    from public.reference_list_items
    where reference_list_id = v_asset_type_list_id
      and (lower(label) like '%printer%' or lower(label) like '%mfp%' or value in ('printer_mfp', 'printer', 'mfp'))
    limit 1;

    if v_printer_type_id is null then
      select coalesce(max(sort_order), 0) + 1 into v_next_sort
      from public.reference_list_items
      where reference_list_id = v_asset_type_list_id;

      insert into public.reference_list_items (reference_list_id, organization_id, value, label, sort_order)
      values (v_asset_type_list_id, r.id, 'printer_mfp', 'Printer / MFP', v_next_sort)
      returning id into v_printer_type_id;
    end if;

    -- asset_subtype: Color MFP / Mono MFP / Wide Format, all under Printer / MFP.
    select id into v_color_mfp_id
    from public.reference_list_items
    where reference_list_id = v_asset_subtype_list_id and parent_item_id = v_printer_type_id and lower(label) = 'color mfp';

    if v_color_mfp_id is null then
      select coalesce(max(sort_order), 0) + 1 into v_next_sort
      from public.reference_list_items
      where reference_list_id = v_asset_subtype_list_id;

      insert into public.reference_list_items (reference_list_id, organization_id, value, label, sort_order, parent_item_id)
      values (v_asset_subtype_list_id, r.id, 'color_mfp', 'Color MFP', v_next_sort, v_printer_type_id)
      returning id into v_color_mfp_id;
    end if;

    select id into v_mono_mfp_id
    from public.reference_list_items
    where reference_list_id = v_asset_subtype_list_id and parent_item_id = v_printer_type_id and lower(label) = 'mono mfp';

    if v_mono_mfp_id is null then
      select coalesce(max(sort_order), 0) + 1 into v_next_sort
      from public.reference_list_items
      where reference_list_id = v_asset_subtype_list_id;

      insert into public.reference_list_items (reference_list_id, organization_id, value, label, sort_order, parent_item_id)
      values (v_asset_subtype_list_id, r.id, 'mono_mfp', 'Mono MFP', v_next_sort, v_printer_type_id)
      returning id into v_mono_mfp_id;
    end if;

    select id into v_wide_format_id
    from public.reference_list_items
    where reference_list_id = v_asset_subtype_list_id and parent_item_id = v_printer_type_id and lower(label) = 'wide format';

    if v_wide_format_id is null then
      select coalesce(max(sort_order), 0) + 1 into v_next_sort
      from public.reference_list_items
      where reference_list_id = v_asset_subtype_list_id;

      insert into public.reference_list_items (reference_list_id, organization_id, value, label, sort_order, parent_item_id)
      values (v_asset_subtype_list_id, r.id, 'wide_format', 'Wide Format', v_next_sort, v_printer_type_id)
      returning id into v_wide_format_id;
    end if;

    -- asset_brand: Kyocera (already seeded per-org by the extended
    -- seed_default_reference_lists above; looked up defensively here in
    -- case this org's row somehow predates that seed).
    select id into v_kyocera_id
    from public.reference_list_items
    where reference_list_id = v_asset_brand_list_id and value = 'kyocera';

    if v_kyocera_id is null then
      select coalesce(max(sort_order), 0) + 1 into v_next_sort
      from public.reference_list_items
      where reference_list_id = v_asset_brand_list_id;

      insert into public.reference_list_items (reference_list_id, organization_id, value, label, sort_order)
      values (v_asset_brand_list_id, r.id, 'kyocera', 'Kyocera', v_next_sort)
      returning id into v_kyocera_id;
    end if;

    -- asset_models: 6 real Kyocera MFP models, mixed warranty periods (four
    -- at the 24-month default, one shortened to 12, one extended to 36) so
    -- default_warranty_months demonstrably isn't hardcoded.
    insert into public.asset_models
      (organization_id, brand_item_id, type_item_id, subtype_item_id, name, default_warranty_months)
    values
      (r.id, v_kyocera_id, v_printer_type_id, v_mono_mfp_id, 'ECOSYS M2540dn', 24),
      (r.id, v_kyocera_id, v_printer_type_id, v_color_mfp_id, 'ECOSYS M6535cidn', 24),
      (r.id, v_kyocera_id, v_printer_type_id, v_color_mfp_id, 'TASKalfa 3554ci', 24),
      (r.id, v_kyocera_id, v_printer_type_id, v_color_mfp_id, 'TASKalfa 5054ci', 36),
      (r.id, v_kyocera_id, v_printer_type_id, v_mono_mfp_id, 'TASKalfa 3011i', 12),
      (r.id, v_kyocera_id, v_printer_type_id, v_wide_format_id, 'TASKalfa Pro 15000c', 36)
    on conflict (organization_id, brand_item_id, name) do nothing;
  end loop;
end;
$$;
