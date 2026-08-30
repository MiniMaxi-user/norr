-- Engineer/Client custom travel-time and work-time billing articles (issue
-- #93, "Reistijd en werktijd artikelen beheren" / "Manage travel time and
-- work time articles"). Extends the existing `public.memberships` (an
-- "engineer" is a membership row with `role = 'engineer'`) and
-- `public.clients` tables with a per-row rate-override shape, so BOTH an
-- engineer and a client can optionally point at a specific Travel-time
-- article and a specific Work-time article (from `public.articles`,
-- `20260829100000_articles_core.sql`) with an editable sale price. Later
-- resolution order (engineer default -> client override -> contract
-- override) and invoicing itself are explicitly OUT OF SCOPE here — this
-- migration only builds the two override shapes storage needs; no
-- resolution logic lives in the DB.
--
-- Five new columns, IDENTICAL shape on both `public.memberships` and
-- `public.clients` (mirrors the story's "Engineer page ... Client page ...
-- same shape" acceptance criteria):
--   - `has_custom_rate boolean not null default false` — the "Afwijkend
--     tarief" checkbox state.
--   - `travel_article_id uuid references public.articles (id)` — nullable;
--     exactly one Travel-time article when `has_custom_rate` is true.
--   - `work_article_id uuid references public.articles (id)` — nullable;
--     exactly one Work-time article when `has_custom_rate` is true.
--   - `travel_sale_price numeric(12,2)` — nullable, EDITABLE override sale
--     price for travel. The corresponding PURCHASE price is deliberately
--     NOT stored anywhere on `memberships`/`clients` — per the acceptance
--     criteria ("purchase amount not editable"), it always mirrors
--     `articles.purchase_price` live, read via `travel_article_id` at
--     display/use time. Storing a purchase-price snapshot here would let it
--     drift from the article's own price with no UI path to edit it back in
--     sync — a column that can only ever be stale is worse than no column.
--   - `work_sale_price numeric(12,2)` — same, for work.
--
-- Design decisions (per db-schema-architect brief on issue #93):
--
-- 1. **FK org-match validation**: `travel_article_id`/`work_article_id`, when
--    set, must belong to the SAME `organization_id` as the membership/client
--    row. One SHARED trigger function, `validate_rate_override_articles`
--    (SECURITY DEFINER, `before insert or update of travel_article_id,
--    work_article_id`), is attached to BOTH tables — the column shapes
--    (`organization_id`, `travel_article_id`, `work_article_id`) are
--    identical on `memberships` and `clients`, so one generic function
--    (using `tg_table_name` for error messages) covers both, the same way
--    `set_created_by`/`set_updated_at` are already single generic functions
--    reused across every table in this schema, rather than writing two
--    near-identical copies (`validate_article_reference_items`'s per-column
--    style is not reused here precisely because it's per-column/per-table
--    specific; this case has no such per-table divergence to justify two
--    functions). `memberships` had no prior cross-table FK-org-match
--    validation-trigger precedent (its only FKs, `user_id`/`organization_id`,
--    are baseline/immutable) — this migration establishes one, consistent
--    with `articles`/`contacts`/`clients`' existing `validate_*` pattern:
--    `23503` for a dangling id, `23514` for a cross-organization mismatch.
--
-- 2. **`has_custom_rate = true` requires both article ids — CHECK
--    constraint, not application-layer-only**: the acceptance criteria says
--    "always exactly 1 for work, 1 for travel" once the checkbox is on, and
--    that shape (a boolean gating two required FKs) is exactly what a plain
--    CHECK can express without over-constraining the "checkbox off" state:
--    `check (not has_custom_rate or (travel_article_id is not null and
--    work_article_id is not null))`. When `has_custom_rate = false`, the
--    constraint is trivially satisfied regardless of whether the article
--    ids/prices are null or still hold stale values from a previously-on
--    state — the UI/`api-backend-engineer` should clear them on uncheck for
--    tidy data, but the DB does not force it (their presence is simply
--    ignored/unused once the flag is off, same "ignored, not forbidden"
--    posture other optional-with-flag columns in this schema take).
--    `travel_sale_price`/`work_sale_price` are deliberately NOT included in
--    this CHECK — `articles.purchase_price`/`sale_price` are themselves
--    nullable (an article can exist with no price yet), so requiring a
--    non-null override sale price here whenever an article is chosen would
--    be stricter than the source data it's prefilled from; the UI prefills
--    it from the article's own `sale_price` (possibly null) and leaves it
--    editable from there.
--
-- 3. **Non-negative CHECKs** on `travel_sale_price`/`work_sale_price`, both
--    tables — same style as `articles_sale_price_non_negative`
--    (`20260829100000_articles_core.sql`): `check (... is null or ... >= 0)`.
--
-- 4. **RLS/grants — no new write-permission tier.** Neither table's
--    row-level policies change at all; these 5 columns are covered by
--    whichever policy already governs writes to that row:
--      - `clients`: `clients_insert_owner`/`clients_update_owner`
--        (`is_org_owner(organization_id)`, `20260822190000_clients_sites_
--        assets.sql`) — unchanged. Column-level grants ARE restricted on
--        `clients` (locked down by `20260822193000_fix_clients_sites_
--        assets_column_grants.sql`), so this migration re-issues additive
--        `grant insert (...)`/`grant update (...)` statements adding these 5
--        columns, same pattern as every prior `clients` column addition
--        this session (`clients_business_fields.sql`,
--        `clients_kanban_status.sql`, `clients_represents_organization.sql`)
--        — no preceding `revoke all` needed (that already happened once,
--        for the whole table, in the fix migration; re-adding a `revoke all`
--        here would also strip privileges other migrations granted on
--        unrelated `clients` columns, which is not the intent).
--      - `memberships`: `memberships_update_owner`
--        (`is_org_owner(organization_id)`, baseline migration) —
--        unchanged. `memberships` has NEVER had column-level INSERT/UPDATE
--        lockdown — its baseline grant is a single unrestricted
--        `grant select, insert, update, delete on public.memberships to
--        authenticated;` (no column list). A table-level grant (as opposed
--        to a column-level one) covers every column of the table, including
--        columns added later by `ALTER TABLE ADD COLUMN` — so the 5 new
--        columns are already insertable/updatable by `authenticated` under
--        that existing grant, gated only by the (unchanged) row-level
--        `is_org_owner` policy, with no new GRANT statement required here.
--        This is a **pre-existing, deliberate scope difference** between
--        `memberships` and every other tenant-scoped table in this schema
--        (which do have column-level lockdown) — not something introduced
--        or widened by this migration. Flagged here rather than silently
--        left unstated, per the "reuse existing write policies/grants,
--        don't introduce a new tier" brief: nothing changes, so nothing new
--        needs granting.
--
-- 5. **Indexes** on both new FK columns, both tables — matching this
--    schema's "index every FK/filter column" convention (e.g.
--    `articles_unit_item_id_idx`).

-- ---------------------------------------------------------------------------
-- public.memberships ("engineer" = a membership row with role = 'engineer')
-- ---------------------------------------------------------------------------
alter table public.memberships
  add column has_custom_rate boolean not null default false,
  add column travel_article_id uuid references public.articles (id),
  add column work_article_id uuid references public.articles (id),
  add column travel_sale_price numeric(12,2),
  add column work_sale_price numeric(12,2),
  add constraint memberships_custom_rate_requires_articles
    check (not has_custom_rate or (travel_article_id is not null and work_article_id is not null)),
  add constraint memberships_travel_sale_price_non_negative
    check (travel_sale_price is null or travel_sale_price >= 0),
  add constraint memberships_work_sale_price_non_negative
    check (work_sale_price is null or work_sale_price >= 0);

comment on column public.memberships.has_custom_rate is
  'The "Afwijkend tarief" checkbox (issue #93) on an engineer''s (membership) record. When true, travel_article_id/work_article_id are required (memberships_custom_rate_requires_articles). When false, the org''s standing default travel/work article+price applies instead (resolved at application layer, out of scope for this migration).';
comment on column public.memberships.travel_article_id is
  'The engineer''s default Travel-time billing article override, from public.articles. Required (not null) whenever has_custom_rate is true (memberships_custom_rate_requires_articles); validated to belong to this row''s own organization_id by validate_rate_override_articles.';
comment on column public.memberships.work_article_id is
  'The engineer''s default Work-time billing article override, from public.articles. Required whenever has_custom_rate is true; validated the same way as travel_article_id.';
comment on column public.memberships.travel_sale_price is
  'Editable override sale price for travel_article_id. The matching PURCHASE price is deliberately NOT stored here (per acceptance criteria: "purchase amount not editable") — always read live from articles.purchase_price via travel_article_id, so it can never drift out of sync with the article''s own price. Non-negative when set.';
comment on column public.memberships.work_sale_price is
  'Editable override sale price for work_article_id. See travel_sale_price comment for why the purchase price is not duplicated here.';

create index memberships_travel_article_id_idx on public.memberships (travel_article_id);
create index memberships_work_article_id_idx on public.memberships (work_article_id);

-- ---------------------------------------------------------------------------
-- public.clients
-- ---------------------------------------------------------------------------
alter table public.clients
  add column has_custom_rate boolean not null default false,
  add column travel_article_id uuid references public.articles (id),
  add column work_article_id uuid references public.articles (id),
  add column travel_sale_price numeric(12,2),
  add column work_sale_price numeric(12,2),
  add constraint clients_custom_rate_requires_articles
    check (not has_custom_rate or (travel_article_id is not null and work_article_id is not null)),
  add constraint clients_travel_sale_price_non_negative
    check (travel_sale_price is null or travel_sale_price >= 0),
  add constraint clients_work_sale_price_non_negative
    check (work_sale_price is null or work_sale_price >= 0);

comment on column public.clients.has_custom_rate is
  'The "Afwijkend tarief" checkbox (issue #93) on a client record. When true, travel_article_id/work_article_id are required (clients_custom_rate_requires_articles) and, per the story''s later invoicing resolution order (engineer default -> client override -> contract override, out of scope here), take precedence over the assigned engineer''s own default. When false, the engineer''s (or org''s) standing default applies instead.';
comment on column public.clients.travel_article_id is
  'The client''s default Travel-time billing article override, from public.articles. Required whenever has_custom_rate is true (clients_custom_rate_requires_articles); validated to belong to this row''s own organization_id by validate_rate_override_articles.';
comment on column public.clients.work_article_id is
  'The client''s default Work-time billing article override, from public.articles. Required whenever has_custom_rate is true; validated the same way as travel_article_id.';
comment on column public.clients.travel_sale_price is
  'Editable override sale price for travel_article_id. The matching PURCHASE price is deliberately NOT stored here (per acceptance criteria: "purchase amount not editable") — always read live from articles.purchase_price via travel_article_id. Non-negative when set.';
comment on column public.clients.work_sale_price is
  'Editable override sale price for work_article_id. See travel_sale_price comment for why the purchase price is not duplicated here.';

create index clients_travel_article_id_idx on public.clients (travel_article_id);
create index clients_work_article_id_idx on public.clients (work_article_id);

-- ---------------------------------------------------------------------------
-- Shared FK org-match validation trigger (see design note 1 above) —
-- attached to both tables since the column shape is identical on each.
-- ---------------------------------------------------------------------------
create or replace function public.validate_rate_override_articles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_travel_org uuid;
  v_work_org uuid;
begin
  if new.travel_article_id is not null then
    select organization_id into v_travel_org
    from public.articles
    where id = new.travel_article_id;

    if v_travel_org is null then
      raise exception '%.travel_article_id % does not reference an existing article', tg_table_name, new.travel_article_id
        using errcode = '23503';
    elsif v_travel_org <> new.organization_id then
      raise exception '%.travel_article_id must belong to the same organization as the row', tg_table_name
        using errcode = '23514';
    end if;
  end if;

  if new.work_article_id is not null then
    select organization_id into v_work_org
    from public.articles
    where id = new.work_article_id;

    if v_work_org is null then
      raise exception '%.work_article_id % does not reference an existing article', tg_table_name, new.work_article_id
        using errcode = '23503';
    elsif v_work_org <> new.organization_id then
      raise exception '%.work_article_id must belong to the same organization as the row', tg_table_name
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_rate_override_articles() is
  'BEFORE INSERT/UPDATE OF travel_article_id, work_article_id trigger, shared by public.memberships and public.clients (issue #93): rejects a travel_article_id/work_article_id that does not exist, or belongs to a different organization than the row itself. One shared function since both tables have the identical (organization_id, travel_article_id, work_article_id) column shape — same "one generic function, many tables" reuse as set_created_by/set_updated_at, not a per-table copy.';

create trigger memberships_validate_rate_override_articles
  before insert or update of travel_article_id, work_article_id on public.memberships
  for each row execute function public.validate_rate_override_articles();

create trigger clients_validate_rate_override_articles
  before insert or update of travel_article_id, work_article_id on public.clients
  for each row execute function public.validate_rate_override_articles();

-- ---------------------------------------------------------------------------
-- Column-level grants: clients only (see design note 4 — memberships needs
-- no new grant, its baseline table-level grant already covers these
-- columns). Additive, no preceding revoke — same pattern as every prior
-- clients column addition this session.
-- ---------------------------------------------------------------------------
grant insert (
  has_custom_rate, travel_article_id, work_article_id, travel_sale_price, work_sale_price
) on public.clients to authenticated;
grant update (
  has_custom_rate, travel_article_id, work_article_id, travel_sale_price, work_sale_price
) on public.clients to authenticated;
