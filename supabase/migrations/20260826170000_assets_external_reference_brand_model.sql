-- Asset create/edit form rework, schema half (issue #53). Adds
-- `assets.external_reference` and replaces the free-text
-- `assets.manufacturer`/`assets.model` columns with governed FKs:
-- `brand_item_id` (reference_list_items, list_key='asset_brand', added in
-- `20260826160000_asset_brand_and_models.sql`) and `model_id` (the
-- `asset_models` table added in that same migration). The UI/action-layer
-- half (cascading dropdowns, auto-fill of type/subtype/brand from a chosen
-- model) is a separate handoff — not this migration's concern.
--
-- Live-checked on the linked project (`fxpjzcyeevtaadexnkub`, "norr") before
-- writing this migration: `select count(*) from public.assets` returned
-- ZERO rows. Same "check before deciding on backfill complexity" discipline
-- `20260822200000_reference_lists.sql` documents for its own type/status
-- migration — that one found zero rows too but still wrote general-case
-- backfill logic because it was migrating columns (free text / enum) that
-- had an unambiguous 1:1 target to match into. This migration does NOT do
-- that: with zero rows there is nothing to match, so this is a plain column
-- swap (drop `manufacturer`/`model` text columns, add `brand_item_id`/
-- `model_id` uuid FKs) with no backfill machinery. If this migration is ever
-- copied as a template for a table that already has data, see the task's
-- own conservative-backfill guidance instead: case-insensitive match
-- `manufacturer` against `asset_brand` items and `model` against
-- `asset_models.name`, both scoped to the row's own organization; on a miss
-- leave the new column null and append
-- `'Legacy manufacturer/model (unmatched): <value>'` to that asset's
-- `notes` rather than fabricating a new `asset_models` row (unlike a flat
-- picklist, `asset_models` requires brand+type to insert a new row, which
-- free-text `model` alone can't safely supply).
--
-- Design notes:
--
-- 1. `external_reference text null` — a plain new nullable attribute (the
--    tenant's own external/legacy reference number for this asset, e.g. an
--    ERP or previous system's asset id). No FK, no validation — free text
--    by design, same shape as `assets.notes`/`assets.serial_number`.
--
-- 2. `brand_item_id uuid references reference_list_items(id)` replaces
--    `manufacturer text`. Nullable (Brand is not required at the asset
--    level, unlike `asset_models.brand_item_id` which IS required — a
--    tenant can log an asset without picking a model or a brand yet).
--    Validated by extending `validate_asset_reference_items` (not a
--    parallel trigger, per the existing convention for every `assets.*_id`
--    reference-list FK): must be an `asset_brand` item belonging to the
--    asset's own organization. Same structural style as `type_id`/
--    `status_id`/`subtype_id`.
--
-- 3. `model_id uuid references asset_models(id)` replaces `model text`.
--    Nullable. Validated by the same extended trigger to belong to the
--    asset's own organization (`asset_models.organization_id = new.organization_id`)
--    — but deliberately NOT cross-checked against the asset's own
--    `type_id`/`subtype_id`/`brand_item_id`. Auto-filling those fields from
--    a selected model on save is a UI/UX convenience for the frontend
--    handoff, not a DB-level invariant: a user can legitimately pick a
--    Model and still correct e.g. its Type for one specific unit that's
--    mis-catalogued upstream, so no trigger forces them to match.
--
-- 4. Column grants: `assets` is already column-locked-down (`revoke all`
--    applied in `20260822193000_fix_clients_sites_assets_column_grants.sql`,
--    reaffirmed for every column added since). These are new columns on an
--    already-existing, already-locked-down table (not a newly-created
--    table), so the "default privileges grant ALL to authenticated on new
--    tables" gotcha does not apply here — same reasoning
--    `20260822200000_reference_lists.sql` and
--    `20260823090000_contacts_dependent_reference_lists.sql` documented for
--    `type_id`/`status_id`/`subtype_id`. `manufacturer`/`model`'s own grant
--    entries are dropped automatically by Postgres along with the columns
--    themselves; `external_reference`/`brand_item_id`/`model_id` get a
--    plain additive grant.

-- ---------------------------------------------------------------------------
-- Column swap: drop manufacturer/model (text, ungoverned free text), add
-- external_reference/brand_item_id/model_id.
-- ---------------------------------------------------------------------------
alter table public.assets
  drop column manufacturer,
  drop column model;

alter table public.assets
  add column external_reference text,
  add column brand_item_id uuid references public.reference_list_items (id),
  add column model_id uuid references public.asset_models (id);

comment on column public.assets.external_reference is
  'Free-text external/legacy reference for this asset (e.g. an ERP or previous system''s asset id). No FK, no validation, same shape as notes/serial_number.';
comment on column public.assets.brand_item_id is
  'FK into reference_list_items for this organization''s asset_brand reference list. Replaces the old free-text assets.manufacturer column. Nullable. Validated (list_key + organization match) by validate_asset_reference_items.';
comment on column public.assets.model_id is
  'FK into asset_models (see 20260826160000_asset_brand_and_models.sql). Replaces the old free-text assets.model column. Nullable. Validated by validate_asset_reference_items to belong to the asset''s own organization only — deliberately NOT cross-checked against this asset''s own type_id/subtype_id/brand_item_id; auto-filling those from the selected model is a UI convenience, not a DB invariant, since a user can legitimately pick a Model and still correct e.g. its Type for one mis-catalogued unit.';

create index assets_brand_item_id_idx on public.assets (brand_item_id);
create index assets_model_id_idx on public.assets (model_id);

-- ---------------------------------------------------------------------------
-- Extend validate_asset_reference_items with brand_item_id/model_id checks.
-- ---------------------------------------------------------------------------
create or replace function public.validate_asset_reference_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type_org uuid;
  v_type_key text;
  v_status_org uuid;
  v_status_key text;
  v_subtype_org uuid;
  v_subtype_key text;
  v_subtype_parent_item_id uuid;
  v_brand_org uuid;
  v_brand_key text;
  v_model_org uuid;
begin
  if new.type_id is not null then
    select rl.organization_id, rl.list_key into v_type_org, v_type_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.type_id;

    if v_type_org is null then
      raise exception 'assets.type_id % does not reference an existing reference_list_items row', new.type_id
        using errcode = '23503';
    elsif v_type_key <> 'asset_type' then
      raise exception 'assets.type_id must reference an item from the asset_type reference list (got list_key=%)', v_type_key
        using errcode = '23514';
    elsif v_type_org <> new.organization_id then
      raise exception 'assets.type_id must belong to the same organization as the asset'
        using errcode = '23514';
    end if;
  end if;

  if new.status_id is not null then
    select rl.organization_id, rl.list_key into v_status_org, v_status_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.status_id;

    if v_status_org is null then
      raise exception 'assets.status_id % does not reference an existing reference_list_items row', new.status_id
        using errcode = '23503';
    elsif v_status_key <> 'asset_status' then
      raise exception 'assets.status_id must reference an item from the asset_status reference list (got list_key=%)', v_status_key
        using errcode = '23514';
    elsif v_status_org <> new.organization_id then
      raise exception 'assets.status_id must belong to the same organization as the asset'
        using errcode = '23514';
    end if;
  end if;

  if new.subtype_id is not null then
    select rl.organization_id, rl.list_key, rli.parent_item_id
    into v_subtype_org, v_subtype_key, v_subtype_parent_item_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.subtype_id;

    if v_subtype_org is null then
      raise exception 'assets.subtype_id % does not reference an existing reference_list_items row', new.subtype_id
        using errcode = '23503';
    elsif v_subtype_key <> 'asset_subtype' then
      raise exception 'assets.subtype_id must reference an item from the asset_subtype reference list (got list_key=%)', v_subtype_key
        using errcode = '23514';
    elsif v_subtype_org <> new.organization_id then
      raise exception 'assets.subtype_id must belong to the same organization as the asset'
        using errcode = '23514';
    elsif new.type_id is null or v_subtype_parent_item_id is distinct from new.type_id then
      raise exception 'assets.subtype_id must be a sub-type of the asset''s own type_id (the subtype item''s parent_item_id must equal assets.type_id)'
        using errcode = '23514';
    end if;
  end if;

  if new.brand_item_id is not null then
    select rl.organization_id, rl.list_key into v_brand_org, v_brand_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.brand_item_id;

    if v_brand_org is null then
      raise exception 'assets.brand_item_id % does not reference an existing reference_list_items row', new.brand_item_id
        using errcode = '23503';
    elsif v_brand_key <> 'asset_brand' then
      raise exception 'assets.brand_item_id must reference an item from the asset_brand reference list (got list_key=%)', v_brand_key
        using errcode = '23514';
    elsif v_brand_org <> new.organization_id then
      raise exception 'assets.brand_item_id must belong to the same organization as the asset'
        using errcode = '23514';
    end if;
  end if;

  if new.model_id is not null then
    select am.organization_id into v_model_org
    from public.asset_models am
    where am.id = new.model_id;

    if v_model_org is null then
      raise exception 'assets.model_id % does not reference an existing asset_models row', new.model_id
        using errcode = '23503';
    elsif v_model_org <> new.organization_id then
      raise exception 'assets.model_id must belong to the same organization as the asset'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_asset_reference_items() is
  'BEFORE INSERT/UPDATE OF type_id, status_id, subtype_id, brand_item_id, model_id trigger on public.assets: rejects an item from the wrong list_key or a different organization''s reference list (type_id/status_id/subtype_id/brand_item_id alike); rejects a subtype_id whose parent_item_id does not match the asset''s own type_id; rejects a model_id from a different organization''s asset_models. Deliberately does NOT cross-check model_id against this asset''s own type_id/subtype_id/brand_item_id (see 20260826170000_assets_external_reference_brand_model.sql design note 3) — that auto-fill is a UI concern, not a DB invariant. Runs after assets_derive_org_and_client (alphabetically later trigger name, same timing), so new.organization_id is already final.';

drop trigger if exists assets_validate_reference_items on public.assets;

create trigger assets_validate_reference_items
  before insert or update of type_id, status_id, subtype_id, brand_item_id, model_id on public.assets
  for each row execute function public.validate_asset_reference_items();

-- ---------------------------------------------------------------------------
-- Column grants: manufacturer/model's grant entries were dropped
-- automatically by Postgres along with those columns; add a plain additive
-- grant for the three new columns (see design note 4 above).
-- ---------------------------------------------------------------------------
grant insert (external_reference, brand_item_id, model_id) on public.assets to authenticated;
grant update (external_reference, brand_item_id, model_id) on public.assets to authenticated;
