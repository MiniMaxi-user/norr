-- Asset composite/bill-of-materials (issue #125). Same underlying concept as
-- Articles' composite BOM (`article_components`,
-- `20260829100000_articles_core.sql`), but for `assets` instead of
-- `articles` — read that migration first as the structural reference for
-- the RLS/grant/trigger conventions reused below (SECURITY DEFINER
-- organization-deriving trigger, `revoke all` then explicit column grants,
-- `force row level security`).
--
-- Where this deliberately DIVERGES from `article_components`, and why:
--
-- 1. **`component_asset_id` is UNIQUE across the whole table** (not just the
--    `(parent_asset_id, component_asset_id)` pair `article_components`
--    uses). An Article is a catalog/product row — the same article can be
--    "used" conceptually in unlimited different composite recipes, since a
--    recipe isn't a physical thing. An Asset (`public.assets`) is a single
--    physical, individually tracked instance (serial number, client/site,
--    status). A single physical asset instance can only ever be part of ONE
--    parent assembly at a time — it can't physically be inside two
--    different machines simultaneously. Enforced at the DB level via a
--    plain `unique (component_asset_id)` constraint, not left to app-side
--    validation. A direct, useful consequence: since a component has at
--    most one parent, "walk up to the root of this asset's composition
--    tree" is always a single linear walk (at most one row matches
--    `component_asset_id = <this id>`), never a fan-out — see point 5 below.
--
-- 2. **General, arbitrary-depth cycle detection from day one**, unlike
--    Articles' original flat-only design (`article_components` forbade
--    nesting entirely, structurally sidestepping the need for cycle
--    detection — a rule since reversed for Articles in a parallel migration,
--    issue #124, precisely because it was too limiting). Assets explicitly
--    wants unlimited depth (an engine assembly inside a generator inside a
--    site's backup power skid, etc.), so `validate_asset_component` walks
--    the full DESCENDANT tree of the intended `component_asset_id` (a real
--    fan-out — one asset can have many components, unlike
--    `article_groups`' single-parent ANCESTOR walk) via a `WITH RECURSIVE`
--    query, depth-capped defensively at 1000. The walk is REFLEXIVE — it
--    includes `component_asset_id` itself as its own depth-0 node, not just
--    its proper descendants — which is what makes a dedicated
--    `..._no_self_reference` CHECK constraint (the kind `article_components`
--    has) unnecessary here: attaching an asset as its own component is
--    simply the depth-0 case of the same general "would this create a
--    cycle" rule, not a separate rule.
--
-- 3. **No `assets.is_composite` flag.** Considered mirroring
--    `articles.is_composite`, but rejected: that flag earns its keep for
--    Articles partly because it gates whether the BOM editor renders at all
--    in an article CREATE form (before the row/its id even exists) and lets
--    the Articles LIST view show a cheap badge with no join. Assets has no
--    equivalent create-time chicken-and-egg problem worth solving with a
--    flag (an asset already gets a real id from its own create form before
--    any composition UI would be shown), and its own detail screen
--    (`asset-screen.tsx`) is already a full read-heavy page that can afford
--    a cheap `exists (select 1 from asset_components where parent_asset_id
--    = $1)` existence-check query instead of a join-free boolean column. A
--    denormalized flag here would be pure drift risk (a column that could
--    silently disagree with the real `asset_components` rows, e.g. after
--    the last component is deleted) for no concrete win — so this migration
--    deliberately does NOT add one. If a future list view needs a cheap
--    per-row "has components" badge across many rows without N+1 queries,
--    that's a single `count(*) ... group by parent_asset_id` aggregate
--    query away; revisit only if that turns out to be a real performance
--    problem in practice, not preemptively.
--
-- 4. **Tree-fetching query: left to the application layer, not a SQL
--    function.** `article_groups` (this schema's other unlimited-depth,
--    self-referential tree) does its own tree assembly entirely in
--    TypeScript — `listArticleGroups()` returns the org's whole tree as
--    flat rows, and `app/(app)/articles/group-tree.ts`'s
--    `flattenArticleGroups`/`buildArticleGroupTree`/`topArticleGroupAncestorId`
--    do all ancestor/descendant walking client-side from that one flat
--    fetch — there is no recursive-CTE SQL function anywhere in this
--    codebase for tree assembly. Following that same precedent rather than
--    introducing a new style: `api-backend-engineer`'s follow-up should
--    fetch this organization's `asset_components` rows (RLS-scoped, a
--    single ordinary `select`) and, in TypeScript, (a) walk UP via
--    `component_asset_id = <id>` — at most one hop per level, since
--    `component_asset_id` is unique, so finding the root is a single linear
--    walk, never a fan-out — to find the tree's root, then (b) walk DOWN
--    from that root via `parent_asset_id` (real fan-out, mirrors
--    `buildArticleGroupTree`'s `byParent` map) to build the whole tree. No
--    SQL function is defined in this migration for that purpose.
--
-- ---------------------------------------------------------------------------
-- asset_components: composite bill-of-materials for assets. organization_id
-- is denormalized from parent_asset_id (mirrors
-- derive_article_component_organization_id / derive_contact_organization_id).
-- ---------------------------------------------------------------------------
create table public.asset_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  parent_asset_id uuid not null references public.assets (id) on delete cascade,
  component_asset_id uuid not null references public.assets (id) on delete cascade,
  quantity numeric(12,3) not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (component_asset_id),
  constraint asset_components_quantity_positive check (quantity > 0)
);

comment on table public.asset_components is
  'Bill-of-materials for a composite asset (issue #125): which physical sub-assets a parent asset (parent_asset_id) is assembled from, and in what quantity. organization_id is denormalized from parent_asset_id (via derive_asset_component_organization_id), mirroring derive_article_component_organization_id/derive_contact_organization_id. See the design note at the top of 20260906100000_asset_components.sql for how this deliberately diverges from article_components (unique component, general cycle detection, no is_composite flag, no dedicated tree-fetch SQL function).';
comment on column public.asset_components.parent_asset_id is
  'The assembly this row is a BOM line of. Any asset may be a parent (no is_composite gate, unlike article_components.parent_article_id) — arbitrary depth is supported, see validate_asset_component.';
comment on column public.asset_components.component_asset_id is
  'The physical sub-asset consumed by/installed inside the parent. UNIQUE across the whole table: a single physical asset instance can only ever be part of ONE parent assembly at a time, unlike article_components.component_article_id (a catalog article has no such physical uniqueness constraint). Validated (cross-organization guard + arbitrary-depth cycle rejection) by validate_asset_component.';
comment on column public.asset_components.quantity is
  'How many units of component_asset_id one unit of parent_asset_id consumes. numeric(12,3) to allow fractional quantities, same precision as article_components.quantity. Must be > 0. In practice this will almost always be 1 for a uniquely-tracked physical asset, but the column is not constrained to exactly 1 — a parent could plausibly consume multiple identical untracked-individually component units in some fleet scenario; left as a plain positive numeric rather than hardcoding 1.';

create index asset_components_organization_id_idx on public.asset_components (organization_id);
create index asset_components_parent_asset_id_idx on public.asset_components (parent_asset_id);
-- No separate index on component_asset_id: the `unique (component_asset_id)`
-- constraint above already creates one.
create index asset_components_created_by_idx on public.asset_components (created_by);

alter table public.asset_components enable row level security;
alter table public.asset_components force row level security;

-- Derives organization_id from parent_asset_id, and refuses to let a
-- re-parent (changing parent_asset_id on UPDATE) move the component link
-- into a different organization than it already belongs to. Mirrors
-- derive_article_component_organization_id / derive_contact_organization_id.
create or replace function public.derive_asset_component_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select a.organization_id into v_org_id
  from public.assets a
  where a.id = new.parent_asset_id;

  if v_org_id is null then
    raise exception 'asset_components.parent_asset_id % does not reference an existing asset', new.parent_asset_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move an asset_component to a parent asset in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_asset_component_organization_id() is
  'BEFORE INSERT/UPDATE OF parent_asset_id trigger on public.asset_components: sets organization_id from the referenced parent asset, and blocks cross-organization re-parenting. SECURITY DEFINER, same pattern as derive_article_component_organization_id.';

create trigger asset_components_derive_organization_id
  before insert or update of parent_asset_id on public.asset_components
  for each row execute function public.derive_asset_component_organization_id();

-- Validates component_asset_id's organization (must match the parent's,
-- already derived as new.organization_id by the trigger above — alphabetical
-- trigger-name ordering, "derive" < "validate", guarantees it runs first at
-- the same BEFORE INSERT/UPDATE timing, same trick article_components /
-- articles use) and rejects any cycle. Arbitrary-depth cycle detection: walks
-- the full DESCENDANT tree of the intended component_asset_id (a real
-- fan-out, since one asset can have many components — unlike
-- validate_article_group_parent's single-parent ANCESTOR walk) via a WITH
-- RECURSIVE query, depth-capped defensively at 1000. The walk is REFLEXIVE
-- (includes component_asset_id itself as depth 0), which is what makes a
-- dedicated self-reference CHECK constraint unnecessary — see the migration
-- header design note.
create or replace function public.validate_asset_component()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_org uuid;
  v_component_org uuid;
  v_would_cycle boolean;
begin
  select organization_id into v_parent_org
  from public.assets
  where id = new.parent_asset_id;

  if v_parent_org is null then
    raise exception 'asset_components.parent_asset_id % does not reference an existing asset', new.parent_asset_id
      using errcode = '23503';
  end if;

  select organization_id into v_component_org
  from public.assets
  where id = new.component_asset_id;

  if v_component_org is null then
    raise exception 'asset_components.component_asset_id % does not reference an existing asset', new.component_asset_id
      using errcode = '23503';
  elsif v_component_org <> new.organization_id then
    raise exception 'asset_components.component_asset_id must belong to the same organization as the parent asset'
      using errcode = '23514';
  end if;

  with recursive descendants(id, depth) as (
    select new.component_asset_id, 0
    union all
    select ac.component_asset_id, d.depth + 1
    from public.asset_components ac
    join descendants d on ac.parent_asset_id = d.id
    where d.depth < 1000
  )
  select exists (select 1 from descendants where id = new.parent_asset_id) into v_would_cycle;

  if v_would_cycle then
    raise exception 'asset_components: attaching component_asset_id % under parent_asset_id % would create a cycle in the asset composition tree', new.component_asset_id, new.parent_asset_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_asset_component() is
  'BEFORE INSERT/UPDATE OF parent_asset_id, component_asset_id trigger on public.asset_components: rejects a component_asset_id from a different organization than the parent, and rejects any parent_asset_id/component_asset_id pair that would create a cycle (parent_asset_id already somewhere in component_asset_id''s own descendant tree, INCLUDING component_asset_id itself — self-reference is the depth-0 case of this same check, so no separate CHECK constraint is needed). Depth-capped defensively at 1000, same posture as validate_article_group_parent.';

create trigger asset_components_validate_component
  before insert or update of parent_asset_id, component_asset_id on public.asset_components
  for each row execute function public.validate_asset_component();

create trigger asset_components_set_created_by
  before insert on public.asset_components
  for each row execute function public.set_created_by();

create trigger asset_components_set_updated_at
  before update on public.asset_components
  for each row execute function public.set_updated_at();

-- RLS: select any org member (matches assets_select_member); write is
-- OWNER-ONLY (matches assets_insert_owner/assets_update_owner/
-- assets_delete_owner EXACTLY — assets.sql design note 2 documents this is
-- intentionally coarser than the RBAC matrix's Planner "Read/Update" grant,
-- a known, deliberate v1 gap NOT closed by this migration). Do NOT use the
-- owner-or-administratie shape article_components/articles/article_groups
-- use — Assets' own write boundary is owner-only, and asset_components is a
-- sub-resource of assets, so it must match assets' real boundary, not
-- Articles'.
create policy "asset_components_select_member"
on public.asset_components
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "asset_components_insert_owner"
on public.asset_components
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "asset_components_update_owner"
on public.asset_components
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "asset_components_delete_owner"
on public.asset_components
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.asset_components from authenticated;

grant select, delete on public.asset_components to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_asset_component_organization_id. created_by intentionally excluded:
-- stamped by set_created_by. parent_asset_id/component_asset_id are
-- insert-only (immutable after creation, same "delete and re-add to change
-- either side" convention as article_components) — only quantity is
-- meaningfully editable in place.
grant insert (
  id, parent_asset_id, component_asset_id, quantity
) on public.asset_components to authenticated;
grant update (
  quantity
) on public.asset_components to authenticated;
