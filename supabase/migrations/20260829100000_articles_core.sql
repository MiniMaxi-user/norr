-- Articles module: product/part database, composite bill-of-materials, and
-- an unlimited-depth Article Group tree (issue #92, "[Story] Artikel
-- database"). New, separately-entitled module — its own feature
-- flag/permission-matrix row will be wired by auth-rbac-engineer on top of
-- this schema; this migration only builds the tables/RLS shape that
-- supports "Owner + Administratie manage, any member reads".
--
-- Four things in this migration:
--
-- 1. Three new FLAT reference lists (extending `seed_default_reference_lists`
--    per its documented extension pattern): `article_unit` (Stuk/Liter/Kg),
--    `article_manufacturer` (a minimal, genuinely-open-ended-per-tenant
--    default — just an "Other" catch-all, unlike `asset_brand`'s
--    printer-vertical seed, since there is no one realistic default
--    manufacturer set the way there was for one story's own test vertical),
--    and `vat_rate` (0%/9%/21%, `value` stored as the literal numeric
--    percentage in text form — '0'/'9'/'21' — so application code can do
--    `Number(item.value)` directly for tax math in #94/#95, rather than
--    inventing a separate numeric column just for this one list). None of
--    these are dependent lists (no `parent_list_key`) — each is independent.
--
-- 2. `article_groups` — a DEDICATED table, not another `reference_lists`
--    list. The story needs an unlimited-depth, SELF-referential tree within
--    one list ("Group > Subgroup > Subsubgroup"). The existing dependent-list
--    mechanism (`reference_lists.parent_list_key` / `reference_list_items.
--    parent_item_id`, `20260823090000_contacts_dependent_reference_lists.sql`)
--    cannot express this at all: it is single-parent and CROSS-list only —
--    `reference_lists_no_self_parent` (`parent_list_key <> list_key`)
--    explicitly forbids a list depending on itself, precisely to stop an
--    accidental self-loop on every other flat/dependent list in the schema.
--    Removing or weakening that guard to shoehorse one tree-shaped concept
--    through the generic mechanism would reopen that footgun for every other
--    `list_key` — not a trade worth making for one feature. `article_groups`
--    is therefore its own table: `parent_group_id` self-references
--    `article_groups.id`, with a dedicated cycle-detection trigger
--    (`validate_article_group_parent`) doing the DB-level integrity check the
--    generic mechanism structurally can't. Same RLS/grant-lockdown shape as
--    every other tenant-scoped table (see design note 4 below for the write
--    boundary specifically).
--
-- 3. `articles` — the product/part record itself. A DEDICATED table (not a
--    `reference_list_items` row), for the same reasoning `asset_models`
--    documents in `20260826160000_asset_brand_and_models.sql`: far more
--    structured columns (article number, EAN/GTIN/MPN, image URL, two
--    prices, a composite flag, an active flag) than the generic value/label/
--    color/sort_order/is_default shape supports, plus multiple simultaneous
--    reference-list FK relationships (unit/manufacturer/vat rate) and one
--    dedicated-table FK (group). `unit_item_id`/`manufacturer_item_id`/
--    `vat_rate_item_id`/`group_id` are each validated (list_key +
--    organization match, or organization match for `group_id` against
--    `article_groups`) by `validate_article_reference_items`, mirroring
--    `validate_asset_model_reference_items`'s exact structure.
--    `unit_item_id`/`vat_rate_item_id` are required (every article needs a
--    unit and a VAT rate for stock/pricing/tax math) but may be omitted on
--    INSERT — `derive_article_defaults` fills them from the organization's
--    default `article_unit`/`vat_rate` items, the same
--    fill-in-the-organization-default UX `assets.status_id` already has via
--    `derive_asset_org_and_client`. `manufacturer_item_id`/`group_id` are
--    nullable (not every article has a known manufacturer, and grouping is a
--    tenant-configured convenience, not a hard requirement for a usable
--    article record). Per the product owner's already-confirmed decision, a
--    composite article's `purchase_price`/`sale_price` are its own
--    manually-entered columns — `is_composite` and its `article_components`
--    BOM (below) do not drive pricing; they exist for
--    reference/stock/reporting only.
--
--    **Active/inactive**: a plain `is_active boolean not null default true`
--    column, NOT a reference list. Unlike `asset_status` (which has
--    meaningfully more than two states — Active/In Repair/Decommissioned —
--    and benefits from `color`/`sort_order`), an article's active flag is a
--    genuine, tenant-invariant binary with no color/ordering/extensibility
--    need, the same reasoning `organizations.is_active` already used
--    (`20260826120000_organizations_is_active.sql`) — a dedicated boolean
--    column is simpler and there is nothing a reference list would add here.
--
-- 4. `article_components` — the composite bill-of-materials. `organization_id`
--    is denormalized from `parent_article_id` (mirrors
--    `derive_contact_organization_id`). Nested composites are disallowed at
--    the DB layer, not just app-side validation, by
--    `validate_article_component`: `parent_article_id` must resolve to an
--    article with `is_composite = true`, and `component_article_id` must
--    resolve to an article with `is_composite = false` — together this
--    structurally forbids any BOM depth beyond one level (a component can
--    never itself be a parent, since only composite articles may be
--    parents, and components are required to be non-composite), which also
--    sidesteps needing general cycle-detection the way `article_groups`
--    needs it. A companion trigger on `articles` itself
--    (`validate_article_is_composite_flip`) closes the one remaining
--    loophole: flipping an already-in-use *component* article's own
--    `is_composite` to `true` after the fact, which would otherwise create a
--    de facto nested composite through the back door without ever touching
--    `article_components` directly.
--
-- Write RLS boundary for (2)/(3)/(4) — the NEW shape this brief calls for:
-- **owner AND administratie** both get full CRUD (via
-- `current_member_role(organization_id) in ('owner', 'administratie')`,
-- reusing the exact primitive `contracts`' owner-or-finance boundary
-- introduced, per `docs/ARCHITECTURE.md`'s `current_member_role` note); every
-- other tenant role is SELECT-only, all rows — matching this story's "Owner/
-- Administratie beheren de artikel database" plus the forward-looking need
-- (issues #93/#94) for every other role to at least READ articles. The three
-- new reference lists (`article_unit`/`article_manufacturer`/`vat_rate`)
-- themselves stay under the EXISTING `reference_lists`/`reference_list_items`
-- table-wide RLS (owner-only write) — no RLS change needed there; only the
-- dedicated `articles`/`article_components`/`article_groups` tables get the
-- new owner-or-administratie write shape.

-- ---------------------------------------------------------------------------
-- 1. New flat reference lists: article_unit, article_manufacturer, vat_rate.
--    Extends seed_default_reference_lists per its documented pattern.
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
  v_article_unit_list_id uuid;
  v_article_manufacturer_list_id uuid;
  v_vat_rate_list_id uuid;
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

  -- article_unit: for articles.unit_item_id (issue #92). Flat. Stuk is the
  -- sensible tenant default (most articles in an FSM parts catalog are
  -- discrete units, not bulk liquid/weight).
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

  -- article_manufacturer: for articles.manufacturer_item_id (issue #92).
  -- Flat. Deliberately minimal (unlike asset_brand's printer-vertical seed)
  -- — a tenant's parts manufacturers are genuinely open-ended and specific
  -- to what they stock, so a single "Other" catch-all default is the honest
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

  -- vat_rate: for articles.vat_rate_item_id (issue #92). Flat. `value` is
  -- the literal numeric percentage as text ('0'/'9'/'21'), not a slug, so
  -- application code can do Number(item.value) directly for tax math
  -- (#94/#95) instead of maintaining a separate mapping. 21% (the Dutch
  -- standard rate) is the default.
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
  'Idempotent (on conflict do nothing throughout). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Extended in 20260829100000_articles_core.sql with article_unit/article_manufacturer/vat_rate (all flat) blocks. Future picklists should extend this function the same way, plus a one-time backfill call in that feature''s own migration.';

-- Backfill: seed the new article_unit/article_manufacturer/vat_rate lists
-- (and any missing items from earlier list_key blocks) for every
-- organization that already existed before this migration ran — the
-- organizations_seed_reference_lists trigger only fires for future inserts.
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
-- 2. article_groups: dedicated, self-referential, unlimited-depth tree.
--    organization_id supplied directly on insert (checked by RLS), same as
--    reference_lists.organization_id / asset_models.organization_id — a
--    group has no single unambiguous parent ROW to derive it from (its
--    optional parent_group_id is itself an article_groups row, not a
--    different parent table).
-- ---------------------------------------------------------------------------
create table public.article_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  parent_group_id uuid references public.article_groups (id),
  name text not null,
  sort_order integer not null default 0,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint article_groups_no_self_parent check (parent_group_id is distinct from id)
);

comment on table public.article_groups is
  'Tenant-configurable Article Group tree (Group > Subgroup > Subsubgroup, unlimited depth) — one group per article via articles.group_id. Dedicated table, not a reference_lists list — see the design note at the top of 20260829100000_articles_core.sql for why the generic dependent-list mechanism (parent_list_key/parent_item_id) structurally cannot express a self-referential tree within one list. Cascade/cycle integrity is enforced by validate_article_group_parent, not left to the UI.';
comment on column public.article_groups.organization_id is
  'Supplied directly on insert, checked by RLS (current_member_role owner/administratie) — same as reference_lists.organization_id / asset_models.organization_id, since a group''s only real parent (parent_group_id) is itself organization-scoped data, not an unambiguous single row to denormalize from.';
comment on column public.article_groups.parent_group_id is
  'Self-reference to another article_groups row in the SAME organization, or null for a top-level group. Validated (organization match, no self-reference, no cycle) by validate_article_group_parent.';

create index article_groups_organization_id_idx on public.article_groups (organization_id);
create index article_groups_parent_group_id_idx on public.article_groups (parent_group_id);
create index article_groups_created_by_idx on public.article_groups (created_by);

alter table public.article_groups enable row level security;
alter table public.article_groups force row level security;

-- Validates parent_group_id: must be an article_groups row in the SAME
-- organization, must not reference itself, and must not create a cycle
-- (walking up the ancestor chain from the intended parent must never reach
-- this row's own id). This is the DB-level integrity check the generic
-- reference-list mechanism cannot express for a self-referential tree — see
-- the migration header design note.
create or replace function public.validate_article_group_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_org uuid;
  v_current_id uuid;
  v_next_parent_id uuid;
  v_depth integer := 0;
begin
  if new.parent_group_id is null then
    return new;
  end if;

  if new.parent_group_id = new.id then
    raise exception 'article_groups.parent_group_id cannot reference itself'
      using errcode = '23514';
  end if;

  select organization_id into v_parent_org
  from public.article_groups
  where id = new.parent_group_id;

  if v_parent_org is null then
    raise exception 'article_groups.parent_group_id % does not reference an existing article_groups row', new.parent_group_id
      using errcode = '23503';
  elsif v_parent_org <> new.organization_id then
    raise exception 'article_groups.parent_group_id must belong to the same organization as the group'
      using errcode = '23514';
  end if;

  -- Cycle detection: walk up the ancestor chain starting at the intended
  -- parent. If we ever reach this row's own id, setting parent_group_id to
  -- new.parent_group_id would create a cycle. Depth-capped defensively
  -- (1000 levels) even though the cycle check itself makes an actual
  -- infinite loop unreachable in practice.
  v_current_id := new.parent_group_id;
  while v_current_id is not null and v_depth <= 1000 loop
    if v_current_id = new.id then
      raise exception 'article_groups.parent_group_id would create a cycle in the group tree'
        using errcode = '23514';
    end if;

    select parent_group_id into v_next_parent_id
    from public.article_groups
    where id = v_current_id;

    v_current_id := v_next_parent_id;
    v_depth := v_depth + 1;
  end loop;

  return new;
end;
$$;

comment on function public.validate_article_group_parent() is
  'BEFORE INSERT/UPDATE OF parent_group_id trigger on public.article_groups: rejects a parent from a different organization, a direct self-reference, or a parent whose ancestor chain loops back to this row (a cycle) — the DB-level cascade-integrity backstop for the unlimited-depth tree, not left to the UI alone.';

create trigger article_groups_validate_parent
  before insert or update of parent_group_id on public.article_groups
  for each row execute function public.validate_article_group_parent();

create trigger article_groups_set_created_by
  before insert on public.article_groups
  for each row execute function public.set_created_by();

create trigger article_groups_set_updated_at
  before update on public.article_groups
  for each row execute function public.set_updated_at();

-- RLS: select any org member; write owner OR administratie — the NEW shape
-- this module needs (see migration header). Reuses current_member_role
-- exactly like contracts' owner-or-finance boundary.
create policy "article_groups_select_member"
on public.article_groups
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "article_groups_insert_owner_or_administratie"
on public.article_groups
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'administratie')
);

create policy "article_groups_update_owner_or_administratie"
on public.article_groups
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'administratie')
)
with check (
  public.current_member_role(organization_id) in ('owner', 'administratie')
);

create policy "article_groups_delete_owner_or_administratie"
on public.article_groups
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'administratie')
);

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.article_groups from authenticated;

grant select, delete on public.article_groups to authenticated;
-- created_by intentionally excluded: stamped by set_created_by.
grant insert (
  organization_id, parent_group_id, name, sort_order
) on public.article_groups to authenticated;
grant update (
  parent_group_id, name, sort_order
) on public.article_groups to authenticated;

-- ---------------------------------------------------------------------------
-- 3. articles: the product/part record. organization_id supplied directly on
--    insert (checked by RLS), same as article_groups/asset_models above.
-- ---------------------------------------------------------------------------
create table public.articles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  article_number text not null,
  description text not null,
  ean text,
  gtin text,
  mpn text,
  image_url text,
  unit_item_id uuid not null references public.reference_list_items (id),
  manufacturer_item_id uuid references public.reference_list_items (id),
  group_id uuid references public.article_groups (id),
  purchase_price numeric(12,2),
  sale_price numeric(12,2),
  vat_rate_item_id uuid not null references public.reference_list_items (id),
  is_composite boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, article_number),
  constraint articles_purchase_price_non_negative check (purchase_price is null or purchase_price >= 0),
  constraint articles_sale_price_non_negative check (sale_price is null or sale_price >= 0)
);

comment on table public.articles is
  'Product/part database record (issue #92). Dedicated table, not a reference_list_items row — see the design note at the top of 20260829100000_articles_core.sql for why (far more structured columns than the generic value/label/color/sort_order/is_default shape supports, plus multiple simultaneous reference-list/dedicated-table FK relationships). A composite article (is_composite = true) has its OWN manually-entered purchase_price/sale_price — article_components (below) is a bill-of-materials for reference/stock/reporting only and never drives pricing (product-owner-confirmed decision).';
comment on column public.articles.organization_id is
  'Supplied directly on insert, checked by RLS (current_member_role owner/administratie) — same as article_groups.organization_id / asset_models.organization_id.';
comment on column public.articles.unit_item_id is
  'FK into reference_list_items for this organization''s article_unit reference list (Stuk/Liter/Kg). Required, but may be omitted on INSERT — derive_article_defaults fills in the organization''s default article_unit item. Validated (list_key + organization match) by validate_article_reference_items.';
comment on column public.articles.manufacturer_item_id is
  'FK into reference_list_items for this organization''s article_manufacturer reference list. Nullable — not every article has a known/tracked manufacturer. Validated by validate_article_reference_items.';
comment on column public.articles.group_id is
  'FK into article_groups (this organization''s Article Group tree). Nullable — grouping is a tenant-configured convenience, not required to create a usable article. Exactly one group per article, per the story (a single column, not a join table). Validated (organization match) by validate_article_reference_items.';
comment on column public.articles.vat_rate_item_id is
  'FK into reference_list_items for this organization''s vat_rate reference list (0%/9%/21%, value = the literal numeric percentage as text). Required, but may be omitted on INSERT — derive_article_defaults fills in the organization''s default vat_rate item (21%, the Dutch standard rate). Validated by validate_article_reference_items.';
comment on column public.articles.is_composite is
  'When true, this article is assembled from other articles (see article_components, its bill-of-materials). Does NOT affect purchase_price/sale_price, which are always this article''s own manually-entered values regardless of is_composite. Cannot be flipped to true while this article is already used as a component of another composite article (validate_article_is_composite_flip) — that would create a de facto nested composite.';
comment on column public.articles.is_active is
  'Plain boolean, not a reference list — see the migration header design note (a genuine tenant-invariant binary with no color/ordering/extensibility need, same reasoning as organizations.is_active).';

create index articles_organization_id_idx on public.articles (organization_id);
create index articles_unit_item_id_idx on public.articles (unit_item_id);
create index articles_manufacturer_item_id_idx on public.articles (manufacturer_item_id);
create index articles_group_id_idx on public.articles (group_id);
create index articles_vat_rate_item_id_idx on public.articles (vat_rate_item_id);
create index articles_created_by_idx on public.articles (created_by);

alter table public.articles enable row level security;
alter table public.articles force row level security;

-- Fills unit_item_id/vat_rate_item_id with the organization's default
-- article_unit/vat_rate item when omitted on INSERT — mirrors
-- derive_asset_org_and_client's "fill in the default status_id" behavior.
-- INSERT-only: both columns are NOT NULL, so an UPDATE can never legally set
-- either back to null for this trigger to have anything to fill.
create or replace function public.derive_article_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.unit_item_id is null then
    select rli.id into new.unit_item_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rl.organization_id = new.organization_id
      and rl.list_key = 'article_unit'
      and rli.is_default
    limit 1;
  end if;

  if new.vat_rate_item_id is null then
    select rli.id into new.vat_rate_item_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rl.organization_id = new.organization_id
      and rl.list_key = 'vat_rate'
      and rli.is_default
    limit 1;
  end if;

  return new;
end;
$$;

comment on function public.derive_article_defaults() is
  'BEFORE INSERT trigger on public.articles: fills unit_item_id/vat_rate_item_id with the organization''s default article_unit/vat_rate item when the caller omits them. Trigger name sorts alphabetically before articles_validate_reference_items (same BEFORE INSERT timing), so its fill-in runs first and the validation trigger sees the final values.';

create trigger articles_derive_defaults
  before insert on public.articles
  for each row execute function public.derive_article_defaults();

-- Validates unit_item_id/manufacturer_item_id/vat_rate_item_id (reference
-- list FKs: list_key + organization match) and group_id (dedicated-table FK:
-- organization match only, article_groups has no list_key). Same structural
-- style as validate_asset_model_reference_items.
create or replace function public.validate_article_reference_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_org uuid;
  v_unit_key text;
  v_manufacturer_org uuid;
  v_manufacturer_key text;
  v_vat_org uuid;
  v_vat_key text;
  v_group_org uuid;
begin
  select rl.organization_id, rl.list_key into v_unit_org, v_unit_key
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rli.id = new.unit_item_id;

  if v_unit_org is null then
    raise exception 'articles.unit_item_id % does not reference an existing reference_list_items row', new.unit_item_id
      using errcode = '23503';
  elsif v_unit_key <> 'article_unit' then
    raise exception 'articles.unit_item_id must reference an item from the article_unit reference list (got list_key=%)', v_unit_key
      using errcode = '23514';
  elsif v_unit_org <> new.organization_id then
    raise exception 'articles.unit_item_id must belong to the same organization as the article'
      using errcode = '23514';
  end if;

  if new.manufacturer_item_id is not null then
    select rl.organization_id, rl.list_key into v_manufacturer_org, v_manufacturer_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.manufacturer_item_id;

    if v_manufacturer_org is null then
      raise exception 'articles.manufacturer_item_id % does not reference an existing reference_list_items row', new.manufacturer_item_id
        using errcode = '23503';
    elsif v_manufacturer_key <> 'article_manufacturer' then
      raise exception 'articles.manufacturer_item_id must reference an item from the article_manufacturer reference list (got list_key=%)', v_manufacturer_key
        using errcode = '23514';
    elsif v_manufacturer_org <> new.organization_id then
      raise exception 'articles.manufacturer_item_id must belong to the same organization as the article'
        using errcode = '23514';
    end if;
  end if;

  select rl.organization_id, rl.list_key into v_vat_org, v_vat_key
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rli.id = new.vat_rate_item_id;

  if v_vat_org is null then
    raise exception 'articles.vat_rate_item_id % does not reference an existing reference_list_items row', new.vat_rate_item_id
      using errcode = '23503';
  elsif v_vat_key <> 'vat_rate' then
    raise exception 'articles.vat_rate_item_id must reference an item from the vat_rate reference list (got list_key=%)', v_vat_key
      using errcode = '23514';
  elsif v_vat_org <> new.organization_id then
    raise exception 'articles.vat_rate_item_id must belong to the same organization as the article'
      using errcode = '23514';
  end if;

  if new.group_id is not null then
    select ag.organization_id into v_group_org
    from public.article_groups ag
    where ag.id = new.group_id;

    if v_group_org is null then
      raise exception 'articles.group_id % does not reference an existing article_groups row', new.group_id
        using errcode = '23503';
    elsif v_group_org <> new.organization_id then
      raise exception 'articles.group_id must belong to the same organization as the article'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_article_reference_items() is
  'BEFORE INSERT/UPDATE OF unit_item_id, manufacturer_item_id, group_id, vat_rate_item_id trigger on public.articles: rejects an item from the wrong list_key or a different organization (unit/manufacturer/vat_rate), and a group_id from a different organization''s article_groups tree. Runs after articles_derive_defaults on INSERT (alphabetically later trigger name, same timing), so unit_item_id/vat_rate_item_id are already final by the time this validates them.';

create trigger articles_validate_reference_items
  before insert or update of unit_item_id, manufacturer_item_id, group_id, vat_rate_item_id on public.articles
  for each row execute function public.validate_article_reference_items();

create trigger articles_set_created_by
  before insert on public.articles
  for each row execute function public.set_created_by();

create trigger articles_set_updated_at
  before update on public.articles
  for each row execute function public.set_updated_at();

-- RLS: select any org member; write owner OR administratie (see migration
-- header) — matches article_groups' shape exactly.
create policy "articles_select_member"
on public.articles
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "articles_insert_owner_or_administratie"
on public.articles
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'administratie')
);

create policy "articles_update_owner_or_administratie"
on public.articles
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'administratie')
)
with check (
  public.current_member_role(organization_id) in ('owner', 'administratie')
);

create policy "articles_delete_owner_or_administratie"
on public.articles
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'administratie')
);

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.articles from authenticated;

grant select, delete on public.articles to authenticated;
-- created_by intentionally excluded: stamped by set_created_by.
-- organization_id is insertable but not updatable — no legitimate "move this
-- article to a different organization" action, matching every other
-- tenant-scoped table's immutable-organization_id stance.
grant insert (
  organization_id, article_number, description, ean, gtin, mpn, image_url,
  unit_item_id, manufacturer_item_id, group_id, purchase_price, sale_price,
  vat_rate_item_id, is_composite, is_active
) on public.articles to authenticated;
grant update (
  article_number, description, ean, gtin, mpn, image_url,
  unit_item_id, manufacturer_item_id, group_id, purchase_price, sale_price,
  vat_rate_item_id, is_composite, is_active
) on public.articles to authenticated;

-- ---------------------------------------------------------------------------
-- 4. article_components: composite bill-of-materials. organization_id is
--    denormalized from parent_article_id (mirrors
--    derive_contact_organization_id). Nested composites are disallowed at
--    the DB layer by validate_article_component (see migration header).
-- ---------------------------------------------------------------------------
create table public.article_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  parent_article_id uuid not null references public.articles (id) on delete cascade,
  component_article_id uuid not null references public.articles (id) on delete cascade,
  quantity numeric(12,3) not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_article_id, component_article_id),
  constraint article_components_no_self_reference check (parent_article_id <> component_article_id),
  constraint article_components_quantity_positive check (quantity > 0)
);

comment on table public.article_components is
  'Bill-of-materials for a composite article (issue #92): which sub-articles a composite article (parent_article_id) is built from, and in what quantity. Reference/stock/reporting only — never drives parent_article_id''s own purchase_price/sale_price (product-owner-confirmed decision, see the articles table comment). organization_id is denormalized from parent_article_id (via derive_article_component_organization_id), mirroring derive_contact_organization_id.';
comment on column public.article_components.parent_article_id is
  'The composite article this row is a BOM line of. Must resolve to an article with is_composite = true (validate_article_component) — you cannot attach components to a non-composite article.';
comment on column public.article_components.component_article_id is
  'The sub-article consumed by the parent. Must resolve to an article with is_composite = false (validate_article_component) — nested composites (a composite built from another composite) are disallowed at the DB layer, per scope discipline in issue #92; this also structurally rules out any BOM cycle, since a component can never itself become a valid parent.';
comment on column public.article_components.quantity is
  'How many units of component_article_id one unit of parent_article_id consumes. numeric(12,3) to allow fractional quantities (e.g. 0.5 liter of a bulk liquid component). Must be > 0.';

create index article_components_organization_id_idx on public.article_components (organization_id);
create index article_components_parent_article_id_idx on public.article_components (parent_article_id);
create index article_components_component_article_id_idx on public.article_components (component_article_id);
create index article_components_created_by_idx on public.article_components (created_by);

alter table public.article_components enable row level security;
alter table public.article_components force row level security;

-- Derives organization_id from parent_article_id, and refuses to let a
-- re-parent (changing parent_article_id on UPDATE) move the component link
-- into a different organization than it already belongs to. Mirrors
-- derive_contact_organization_id.
create or replace function public.derive_article_component_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select a.organization_id into v_org_id
  from public.articles a
  where a.id = new.parent_article_id;

  if v_org_id is null then
    raise exception 'article_components.parent_article_id % does not reference an existing article', new.parent_article_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move an article_component to a parent article in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_article_component_organization_id() is
  'BEFORE INSERT/UPDATE OF parent_article_id trigger on public.article_components: sets organization_id from the referenced parent article, and blocks cross-organization re-parenting. SECURITY DEFINER, same pattern as derive_contact_organization_id.';

create trigger article_components_derive_organization_id
  before insert or update of parent_article_id on public.article_components
  for each row execute function public.derive_article_component_organization_id();

-- Enforces the composite/non-composite shape: parent_article_id must be a
-- composite article, component_article_id must be a non-composite article,
-- and both must belong to this row's own organization. Runs after
-- article_components_derive_organization_id (alphabetically later trigger
-- name, same timing), so new.organization_id is already final.
create or replace function public.validate_article_component()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_org uuid;
  v_parent_is_composite boolean;
  v_component_org uuid;
  v_component_is_composite boolean;
begin
  select organization_id, is_composite into v_parent_org, v_parent_is_composite
  from public.articles
  where id = new.parent_article_id;

  if v_parent_org is null then
    raise exception 'article_components.parent_article_id % does not reference an existing article', new.parent_article_id
      using errcode = '23503';
  elsif not v_parent_is_composite then
    raise exception 'article_components.parent_article_id must reference an article with is_composite = true'
      using errcode = '23514';
  end if;

  select organization_id, is_composite into v_component_org, v_component_is_composite
  from public.articles
  where id = new.component_article_id;

  if v_component_org is null then
    raise exception 'article_components.component_article_id % does not reference an existing article', new.component_article_id
      using errcode = '23503';
  elsif v_component_is_composite then
    raise exception 'article_components.component_article_id must reference a non-composite article (nested composites are not supported)'
      using errcode = '23514';
  elsif v_component_org <> new.organization_id then
    raise exception 'article_components.component_article_id must belong to the same organization as the parent article'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_article_component() is
  'BEFORE INSERT/UPDATE OF parent_article_id, component_article_id trigger on public.article_components: rejects a parent_article_id that is not is_composite = true, a component_article_id that IS is_composite (no nested composites), or a component_article_id from a different organization than the parent.';

create trigger article_components_validate_component
  before insert or update of parent_article_id, component_article_id on public.article_components
  for each row execute function public.validate_article_component();

create trigger article_components_set_created_by
  before insert on public.article_components
  for each row execute function public.set_created_by();

create trigger article_components_set_updated_at
  before update on public.article_components
  for each row execute function public.set_updated_at();

-- Closes the one remaining loophole validate_article_component can't cover
-- by itself: flipping an already-in-use *component* article's own
-- is_composite to true after the fact, which would create a de facto nested
-- composite without ever touching article_components directly.
create or replace function public.validate_article_is_composite_flip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_composite and not old.is_composite then
    if exists (
      select 1 from public.article_components
      where component_article_id = new.id
    ) then
      raise exception 'Cannot set is_composite = true on an article that is already used as a component of another composite article (would create a nested composite)'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_article_is_composite_flip() is
  'BEFORE UPDATE OF is_composite trigger on public.articles: rejects flipping is_composite from false to true when this article is already referenced as a component_article_id somewhere else — the back-door route to a nested composite that validate_article_component (which only fires on article_components writes) cannot see. Defined after article_components exists since it queries that table.';

create trigger articles_validate_is_composite_flip
  before update of is_composite on public.articles
  for each row execute function public.validate_article_is_composite_flip();

-- RLS: select any org member; write owner OR administratie — same shape as
-- articles/article_groups ("if you can manage the article database, you can
-- manage its bill-of-materials").
create policy "article_components_select_member"
on public.article_components
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "article_components_insert_owner_or_administratie"
on public.article_components
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'administratie')
);

create policy "article_components_update_owner_or_administratie"
on public.article_components
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'administratie')
)
with check (
  public.current_member_role(organization_id) in ('owner', 'administratie')
);

create policy "article_components_delete_owner_or_administratie"
on public.article_components
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'administratie')
);

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.article_components from authenticated;

grant select, delete on public.article_components to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_article_component_organization_id. created_by intentionally
-- excluded: stamped by set_created_by. parent_article_id/component_article_id
-- are insert-only (immutable after creation, like reference_list_items'
-- reference_list_id) — to change either side, delete and re-insert the BOM
-- line; only quantity is meaningfully editable in place.
grant insert (
  parent_article_id, component_article_id, quantity
) on public.article_components to authenticated;
grant update (
  quantity
) on public.article_components to authenticated;
