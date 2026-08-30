-- Work Order -> Quote creation, schema prerequisite (issue #94, "Werkorder
-- invoice create" — misleadingly titled; confirmed with the product owner
-- this is about creating a QUOTE from a Work Order, not an invoice.
-- Invoicing doesn't exist yet, per issue #93's "Facturatie komt later").
--
-- Three things in this migration:
--
-- 1. `work_order_articles` — a brand-new table recording which articles were
--    CONSUMED on a work order. There is currently no way to record this at
--    all (no table, no UI) — confirmed in scope for #94 by the product
--    owner, not a separate story, since a Quote created from a Work Order
--    needs to be pre-populated with both the logged time entries AND the
--    consumed articles.
-- 2. `quotes.work_order_id` — nullable traceability FK back to the
--    originating work order, `on delete set null` (a Quote is a real
--    business document that outlives its source Work Order being deleted,
--    same reasoning `work_orders.source_quote_id`/`contracts.source_quote_id`
--    already established the other direction in
--    20260824090000_quotes_core.sql).
-- 3. `quote_line_items.article_id` — nullable traceability FK back to the
--    source article, for future reporting (per issue #92/#93's
--    forward-looking "reporting can be run on articles" comments). Nullable
--    because plenty of quote line items are free-text/manual with no article
--    backing.
--
-- Explicitly OUT OF SCOPE here (api-backend-engineer's follow-up, per the
-- issue #94 brief): the rate-resolution query (which article + sale price to
-- use for a given time entry, given the client/engineer custom-rate
-- precedence from 20260830090000_engineer_client_rate_overrides.sql), and
-- the actual Quote/quote_line_items INSERT logic behind the "Create Quote"
-- button. This migration only builds the schema/RLS/traceability shape that
-- logic will read from and write into.
--
-- Design notes (read before extending):
--
-- 1. **`work_order_articles.quantity` precision**: numeric(12,3), matching
--    `article_components.quantity`'s exact precision/style
--    (20260829100000_articles_core.sql) — NOT numeric(10,2)/integer. The
--    org's `article_unit` reference list includes Liter/Kg alongside Stuk
--    (discrete units), so a consumed quantity can genuinely be fractional
--    (e.g. "0.5 Liter of coolant used on this job"), the same reasoning that
--    already justified article_components' own 3-decimal precision for a
--    bulk-liquid BOM component. `check (quantity > 0)`, same style as
--    `article_components_quantity_positive`.
--
-- 2. **No price snapshot on the line — price is always read live at
--    Quote-creation time.** `work_order_articles` records WHAT article and
--    HOW MUCH was consumed, nothing else. It deliberately has no
--    `unit_price`/`sale_price` column. This mirrors two existing precedents
--    in this schema: (a) issue #93's rate overrides
--    (`clients`/`memberships`.travel_sale_price/work_sale_price) explicitly
--    do NOT snapshot the corresponding purchase price — it always reads live
--    from `articles.purchase_price` "so it can never drift out of sync with
--    the article's own price" (see that migration's own comment); (b)
--    `quote_line_items` itself has no stored line total or synced parent
--    total (`quotes` deliberately has no `total` column either — see design
--    note 2 in 20260824090000_quotes_core.sql). A stored price snapshot here
--    would only reintroduce that exact denormalization-drift risk one line
--    item earlier in the pipeline. `api-backend-engineer`'s Quote-creation
--    Server Action reads `articles.sale_price` live (via `article_id`) at
--    the moment it converts a `work_order_articles` row into a
--    `quote_line_items` row.
--
-- 3. **Cross-org validation**: `article_id` must belong to the SAME
--    organization as the work order (via `organization_id`, denormalized
--    from `work_order_id` the same way `time_entries.organization_id` is
--    denormalized from `work_orders.organization_id` —
--    `derive_work_order_article_organization_id` mirrors
--    `derive_time_entry_organization_id` exactly). Checked by
--    `validate_work_order_article_relations`, same structural style as
--    `validate_rate_override_articles`/`validate_article_reference_items`'s
--    org-match checks (`articles` is a dedicated domain table, not a
--    `reference_list_items` row, so this is an org-match "_relations"-style
--    check, not a list_key-checking "_reference_items"-style one).
--
-- 4. **RLS write boundary — reuses the EXISTING `planning` RBAC module,
--    no new module/matrix row**, same precedent `time_entries` set
--    (20260823180000_time_entries_core.sql) for logging time as a Work
--    Order sub-resource: `lib/rbac/permissions.ts`'s `planning` row already
--    has `engineer: ["read_own", "update_own", "create_own"]` from that
--    migration — reused verbatim, no permissions.ts change needed.
--
--    The concrete policy shape below matches `time_entries`' RLS EXACTLY,
--    substituting `created_by` for `user_id` as the "own row" scoping
--    column: `work_order_articles` has no natural "whose work is this"
--    column the way `time_entries.user_id` (the engineer who clocked the
--    time) does — the closest analogue is `created_by` (whoever logged the
--    consumption), which is trigger-stamped (`set_created_by`, never
--    client-writable) so it can be trusted as an RLS scoping column exactly
--    like `time_entries.user_id` can.
--
--    This also resolves the brief's explicit ask to match "the SAME actors
--    who can currently write to work_orders/time_entries for that work
--    order": `work_orders`' own engineer-write boundary is narrower
--    (assigned_to = auth.uid() only), but `time_entries`' engineer-INSERT
--    boundary is NOT scoped by work-order-assignment at all — ANY engineer
--    in the org can log a time entry (their own row) against ANY work
--    order, not just ones assigned to them. Since "can log time against it"
--    is therefore unconditional for every engineer regardless of work order
--    assignment, unioning in an extra "OR assigned_to = auth.uid() on the
--    work order" branch would be redundant (already implied) — so this
--    table's engineer INSERT is, like time_entries', unconditional (own row
--    only, no work-order-assignment check). owner/planner: full CRUD, any
--    row (matches work_orders' AND time_entries' owner/planner shape).
--    engineer: SELECT/INSERT/UPDATE own rows only (created_by = auth.uid());
--    NO DELETE (matches time_entries' conservative "corrections go through a
--    planner/owner" stance). finance/administratie: SELECT only, all rows.
--
-- Column-grant lockdown: new table, so the usual "this project's public
-- schema grants ALL to authenticated/anon by default on new tables" gotcha
-- applies — `revoke all` before the explicit grants. `id` is included in the
-- INSERT grant (not omitted), same reasoning as every other new table this
-- session (this migration's own RLS test explicitly assigns deterministic
-- fixture ids on insert).

-- ---------------------------------------------------------------------------
-- work_order_articles: articles/materials consumed on a work order.
-- organization_id is denormalized from work_orders.organization_id via
-- work_order_id (see design note 3 above).
-- ---------------------------------------------------------------------------
create table public.work_order_articles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  article_id uuid not null references public.articles (id),
  quantity numeric(12, 3) not null default 1,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_order_articles_quantity_positive check (quantity > 0)
);

comment on table public.work_order_articles is
  'Articles/materials consumed on a work order (issue #94 schema prerequisite — there was previously no way to record this at all). organization_id is denormalized from work_orders.organization_id (via work_order_id) by derive_work_order_article_organization_id, same reasoning as time_entries. Deliberately has NO price column (purchase_price/sale_price) — this table records WHAT and HOW MUCH was consumed only; price resolution happens live from articles.sale_price at Quote-creation time (application layer), never snapshotted here. See design note 2 in this migration for the full reasoning.';
comment on column public.work_order_articles.organization_id is
  'Denormalized from work_orders.organization_id (via work_order_id). Never client-writable — see derive_work_order_article_organization_id trigger and the column-level grants below.';
comment on column public.work_order_articles.article_id is
  'The article/material consumed. Must belong to the same organization_id as the work order (validated by validate_work_order_article_relations). Not client_id-scoped (unlike quote_line_items.asset_id''s client-match check) because articles are organization-scoped, not client-scoped.';
comment on column public.work_order_articles.quantity is
  'How many units of article_id were consumed. numeric(12,3), matching article_components.quantity''s precision exactly — the article_unit reference list includes Liter/Kg alongside Stuk, so a fractional consumed quantity (e.g. 0.5 Liter) is a real case, not just discrete units. Must be > 0 (work_order_articles_quantity_positive).';
comment on column public.work_order_articles.created_by is
  'Whoever logged this consumption. Trigger-stamped (set_created_by), never client-writable. Doubles as the RLS "own row" scoping column for the engineer role (work_order_articles has no separate user_id-style "whose work is this" column the way time_entries does) — see the migration header design note 4.';

create index work_order_articles_organization_id_idx on public.work_order_articles (organization_id);
create index work_order_articles_work_order_id_idx on public.work_order_articles (work_order_id);
create index work_order_articles_article_id_idx on public.work_order_articles (article_id);
create index work_order_articles_created_by_idx on public.work_order_articles (created_by);

alter table public.work_order_articles enable row level security;
alter table public.work_order_articles force row level security;

-- Derives organization_id from work_order_id (blocking cross-organization
-- re-parenting), same pattern as derive_time_entry_organization_id.
create or replace function public.derive_work_order_article_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select wo.organization_id into v_org_id
  from public.work_orders wo
  where wo.id = new.work_order_id;

  if v_org_id is null then
    raise exception 'work_order_articles.work_order_id % does not reference an existing work order', new.work_order_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a work order article to a work order in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_work_order_article_organization_id() is
  'BEFORE INSERT/UPDATE OF work_order_id trigger on public.work_order_articles: sets organization_id from the referenced work order, and blocks cross-organization re-parenting. Mirrors derive_time_entry_organization_id (20260823180000_time_entries_core.sql) exactly, minus the reference-list-default fill-in (work_order_articles has no status/type column needing one).';

create trigger work_order_articles_derive_organization_id
  before insert or update of work_order_id on public.work_order_articles
  for each row execute function public.derive_work_order_article_organization_id();

-- Cross-field consistency: article_id must belong to the same organization as
-- the work order article's own organization_id. SECURITY DEFINER so it can
-- resolve the referenced article regardless of the caller's own RLS
-- visibility (mirrors validate_rate_override_articles' reasoning).
create or replace function public.validate_work_order_article_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_article_org uuid;
begin
  select organization_id into v_article_org
  from public.articles
  where id = new.article_id;

  if v_article_org is null then
    raise exception 'work_order_articles.article_id % does not reference an existing article', new.article_id
      using errcode = '23503';
  elsif v_article_org <> new.organization_id then
    raise exception 'work_order_articles.article_id must belong to the same organization as the work order'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_work_order_article_relations() is
  'BEFORE INSERT/UPDATE OF work_order_id, article_id trigger on public.work_order_articles: rejects an article_id from a different organization than the work order article''s own organization_id. Runs after derive_work_order_article_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger work_order_articles_validate_relations
  before insert or update of work_order_id, article_id on public.work_order_articles
  for each row execute function public.validate_work_order_article_relations();

create trigger work_order_articles_set_created_by
  before insert on public.work_order_articles
  for each row execute function public.set_created_by();

create trigger work_order_articles_set_updated_at
  before update on public.work_order_articles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies: work_order_articles — reuses the planning module's existing
-- engineer create_own/read_own/update_own shape (see migration header design
-- note 4), scoped on created_by instead of time_entries' user_id:
--   owner:                 CRUD, all rows
--   planner:                CRUD, all rows
--   engineer:               SELECT/INSERT/UPDATE only rows where
--                            created_by = auth.uid(); no DELETE
--   finance/administratie:  SELECT only, all rows
-- ---------------------------------------------------------------------------

-- SELECT: any member, EXCEPT an engineer, who only sees their own rows.
create policy "work_order_articles_select_scoped"
on public.work_order_articles
for select
to authenticated
using (
  public.is_member_of_org(organization_id)
  and (
    public.current_member_role(organization_id) <> 'engineer'
    or created_by = auth.uid()
  )
);

-- INSERT: owner/planner any; engineer's own row (created_by is trigger-
-- stamped to auth.uid() before this check runs, so this branch is
-- unconditional for any engineer, matching time_entries' equivalent
-- unconditional-per-engineer INSERT shape — see design note 4).
create policy "work_order_articles_insert_scoped"
on public.work_order_articles
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and created_by = auth.uid()
  )
);

-- UPDATE: owner/planner any row; engineer only their own row.
create policy "work_order_articles_update_scoped"
on public.work_order_articles
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and created_by = auth.uid()
  )
)
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and created_by = auth.uid()
  )
);

-- DELETE: owner/planner only (engineer has no delete action, matches the
-- conservative time_entries/work_orders precedent — corrections go through a
-- planner/owner).
create policy "work_order_articles_delete_owner_or_planner"
on public.work_order_articles
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.work_order_articles from authenticated;

grant select, delete on public.work_order_articles to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_work_order_article_organization_id. created_by intentionally
-- excluded: stamped by set_created_by (and relied on as the RLS "own row"
-- scoping column — see design note 4). `id` IS included in the INSERT grant,
-- same reasoning as every other new table this session (this migration's own
-- RLS test explicitly assigns deterministic fixture ids on insert).
grant insert (
  id, work_order_id, article_id, quantity
) on public.work_order_articles to authenticated;
-- work_order_id is insert-only (immutable after creation, like
-- quote_line_items.quote_id/article_components.parent_article_id) — delete +
-- re-insert to move a consumed-article line to a different work order; only
-- article_id/quantity are meaningfully editable in place (e.g. correcting
-- which article was logged, or the quantity).
grant update (
  article_id, quantity
) on public.work_order_articles to authenticated;

-- ---------------------------------------------------------------------------
-- quotes.work_order_id: traceability back to the originating work order
-- (design note 2 in the migration header). Plain additive column on an
-- existing, already-locked-down table — no `revoke all` needed (ALTER TABLE
-- ADD COLUMN doesn't inherit the "revoke all on new tables" gotcha), same
-- non-issue as work_orders.source_quote_id/contracts.source_quote_id before
-- it (20260824090000_quotes_core.sql).
-- ---------------------------------------------------------------------------
alter table public.quotes
  add column work_order_id uuid references public.work_orders (id) on delete set null;

comment on column public.quotes.work_order_id is
  'Nullable FK into work_orders — the work order this quote was created FROM (issue #94''s "Create Quote" button on a Work Order), if any. on delete set null (not cascade): a quote is a real business document that should survive its source work order being deleted, same reasoning as work_orders.source_quote_id/contracts.source_quote_id''s reverse-direction traceability. When set, must belong to the same client_id as the quote (validated by validate_quote_relations, extended below) — every other cross-reference in this schema is DB-enforced, not just application-layer.';

create index quotes_work_order_id_idx on public.quotes (work_order_id);

-- Extend (CREATE OR REPLACE, not a parallel trigger) validate_quote_relations
-- with the work_order_id <-> client_id cross-field check, and widen the
-- trigger's column list to include work_order_id.
create or replace function public.validate_quote_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_client_id uuid;
  v_work_order_client_id uuid;
begin
  if new.site_id is not null then
    select s.client_id into v_site_client_id
    from public.sites s
    where s.id = new.site_id;

    if v_site_client_id is null then
      raise exception 'quotes.site_id % does not reference an existing site', new.site_id
        using errcode = '23503';
    elsif v_site_client_id <> new.client_id then
      raise exception 'quotes.site_id must belong to the same client as the quote'
        using errcode = '23514';
    end if;
  end if;

  if new.work_order_id is not null then
    select wo.client_id into v_work_order_client_id
    from public.work_orders wo
    where wo.id = new.work_order_id;

    if v_work_order_client_id is null then
      raise exception 'quotes.work_order_id % does not reference an existing work order', new.work_order_id
        using errcode = '23503';
    elsif v_work_order_client_id <> new.client_id then
      raise exception 'quotes.work_order_id must belong to the same client as the quote'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_quote_relations() is
  'BEFORE INSERT/UPDATE OF client_id, site_id, work_order_id trigger on public.quotes: rejects a site_id/work_order_id from a different client than the quote''s own client_id. Extended in 20260830100000_work_order_articles_and_quote_traceability.sql with the work_order_id check. Runs after quotes_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

drop trigger if exists quotes_validate_relations on public.quotes;

create trigger quotes_validate_relations
  before insert or update of client_id, site_id, work_order_id on public.quotes
  for each row execute function public.validate_quote_relations();

grant insert (work_order_id) on public.quotes to authenticated;
grant update (work_order_id) on public.quotes to authenticated;

-- ---------------------------------------------------------------------------
-- quote_line_items.article_id: traceability back to the source article, for
-- future reporting (design note 3 in the migration header). Plain additive
-- column, same non-issue as quotes.work_order_id above.
-- ---------------------------------------------------------------------------
alter table public.quote_line_items
  add column article_id uuid references public.articles (id) on delete set null;

comment on column public.quote_line_items.article_id is
  'Nullable FK into articles — the source article this line item was generated from (issue #94''s Work-Order-time-entry/consumed-article-to-Quote flow, and any future article-based quote line item), for reporting traceability. Nullable because plenty of quote line items are free-text/manual with no article backing. When set, must belong to the QUOTE''s own organization_id (validated by validate_quote_line_item_relations, extended below) — articles are organization-scoped, not client-scoped, unlike asset_id''s existing client-match check on this same table.';

create index quote_line_items_article_id_idx on public.quote_line_items (article_id);

-- Extend validate_quote_line_item_relations with the article_id <-> quote's
-- organization_id cross-field check (article_id, unlike asset_id, is
-- org-scoped not client-scoped — mirrors validate_work_order_article_relations'
-- org-match reasoning above), and widen the trigger's column list.
create or replace function public.validate_quote_line_item_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote_client_id uuid;
  v_asset_client_id uuid;
  v_article_org_id uuid;
begin
  if new.asset_id is not null then
    select client_id into v_quote_client_id
    from public.quotes
    where id = new.quote_id;

    select client_id into v_asset_client_id
    from public.assets
    where id = new.asset_id;

    if v_asset_client_id is null then
      raise exception 'quote_line_items.asset_id % does not reference an existing asset', new.asset_id
        using errcode = '23503';
    elsif v_asset_client_id <> v_quote_client_id then
      raise exception 'quote_line_items.asset_id must belong to the same client as the quote'
        using errcode = '23514';
    end if;
  end if;

  if new.article_id is not null then
    select organization_id into v_article_org_id
    from public.articles
    where id = new.article_id;

    if v_article_org_id is null then
      raise exception 'quote_line_items.article_id % does not reference an existing article', new.article_id
        using errcode = '23503';
    elsif v_article_org_id <> new.organization_id then
      raise exception 'quote_line_items.article_id must belong to the same organization as the quote'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_quote_line_item_relations() is
  'BEFORE INSERT/UPDATE OF quote_id, asset_id, article_id trigger on public.quote_line_items: rejects an asset_id belonging to a different client than the quote''s own client_id, and an article_id belonging to a different organization than the quote''s own organization_id. Extended in 20260830100000_work_order_articles_and_quote_traceability.sql with the article_id check. quote_id is excluded from the UPDATE column grant (design note 5, 20260824090000_quotes_core.sql), so the quote_id branch of this trigger''s WHEN clause is a defense-in-depth backstop. Runs after quote_line_items_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

drop trigger if exists quote_line_items_validate_relations on public.quote_line_items;

create trigger quote_line_items_validate_relations
  before insert or update of quote_id, asset_id, article_id on public.quote_line_items
  for each row execute function public.validate_quote_line_item_relations();

grant insert (article_id) on public.quote_line_items to authenticated;
grant update (article_id) on public.quote_line_items to authenticated;
