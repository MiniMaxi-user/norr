-- Quote layout (issue #95): two schema additions to public.quote_line_items
-- that the redesigned Quote detail page (app/(app)/quotes/[id]) depends on.
-- Both are plain additive columns on an existing, already-RLS'd table (no new
-- table, no RLS policy change, no tenant-isolation boundary change) — per
-- db-schema-architect's own "small edit" working style this gets a direct
-- migration + live-probe verification, not a new pgTAP test file / qa-reviewer
-- handoff. See this migration's hand-off note at the bottom for what WAS and
-- wasn't verified.
--
-- 1. `discount_percent` — per-line discount, a genuine stored value (unlike
--    purchase_price/vat_rate_item_id, which are read live from `articles` at
--    display time and deliberately never snapshotted anywhere in this
--    schema) since it's user-entered per line with no source-of-truth to
--    derive it from. `numeric(5,2)`, `not null default 0`, `check
--    (discount_percent >= 0 and discount_percent <= 100)`. The
--    discounted-unit-price and per-row total are both computed at the
--    application/display layer, same as the existing `quantity * unit_price`
--    total (design note 2, `20260824090000_quotes_core.sql`) — no stored
--    computed columns added here.
--
-- 2. `engineer_user_id` — nullable FK into `public.users`, captures which
--    engineer a travel/work-time-derived line item belongs to, for future
--    reporting (explicitly forward-looking per the issue #95 story — no
--    reporting feature is being built now, same "nullable, no consumer yet"
--    precedent as `quote_line_items.article_id`/`quotes.work_order_id` from
--    `20260830100000_work_order_articles_and_quote_traceability.sql`).
--    `on delete set null` (a quote line item survives the referenced user
--    being removed). Validated by extending (CREATE OR REPLACE, not a
--    parallel trigger) the existing `validate_quote_line_item_relations`
--    with an org-membership check, same style as
--    `validate_work_order_relations`' `assigned_to` <-> org-membership check
--    (`20260823120000_work_orders_core.sql`): reject an `engineer_user_id`
--    that isn't a member of the quote line item's own `organization_id`.
--    Populated going forward by `api-backend-engineer` (from a source time
--    entry's `user_id` when converting a Work Order's travel/work lines into
--    a quote, and manually on the new inline-edit UI) — out of scope here.
--
-- Both columns are added to the existing column-level INSERT/UPDATE grants on
-- quote_line_items (it has column-level lockdown from
-- `20260824090000_quotes_core.sql`) — same actors who can already
-- insert/update quote_line_items today (owner/planner, per that migration's
-- RLS policies) can set these two new columns, nothing more or less. No RLS
-- policy change.

-- ---------------------------------------------------------------------------
-- 1. discount_percent
-- ---------------------------------------------------------------------------
alter table public.quote_line_items
  add column discount_percent numeric(5, 2) not null default 0,
  add constraint quote_line_items_discount_percent_range
    check (discount_percent >= 0 and discount_percent <= 100);

comment on column public.quote_line_items.discount_percent is
  'Per-line discount percentage, user-entered (unlike purchase_price/vat_rate, which are read live from articles and never stored here — this has no source of truth to derive from). numeric(5,2), not null, defaults to 0, constrained to [0, 100] by quote_line_items_discount_percent_range. The discounted unit price (unit_price * (1 - discount_percent / 100)) and this line''s total are computed at the application/display layer, same as the existing quantity * unit_price total (design note 2, 20260824090000_quotes_core.sql) — no stored computed column.';

-- ---------------------------------------------------------------------------
-- 2. engineer_user_id
-- ---------------------------------------------------------------------------
alter table public.quote_line_items
  add column engineer_user_id uuid references public.users (id) on delete set null;

comment on column public.quote_line_items.engineer_user_id is
  'Nullable FK into users — the engineer this travel/work-time-derived line item belongs to, for future reporting (issue #95, explicitly forward-looking; no reporting feature consumes this yet). Nullable because plenty of line items (materials, free-text) have no associated engineer. When set, must be a member of the line item''s own organization_id (validated by validate_quote_line_item_relations, extended below), same cross-field style as work_orders.assigned_to''s org-membership check in validate_work_order_relations. Populated by application logic: from a source time entry''s user_id when converting Work Order travel/work lines into a quote, or manually on the Quote page''s inline-edit UI — out of scope here.';

create index quote_line_items_engineer_user_id_idx on public.quote_line_items (engineer_user_id);

-- Extend validate_quote_line_item_relations with the engineer_user_id <-> org
-- membership check, and widen the trigger's column list to include
-- engineer_user_id. SECURITY DEFINER already set (unchanged), so it can
-- resolve org membership regardless of the caller's own RLS visibility.
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
  v_engineer_is_member boolean;
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

  if new.engineer_user_id is not null then
    select exists (
      select 1
      from public.memberships m
      where m.user_id = new.engineer_user_id
        and m.organization_id = new.organization_id
    ) into v_engineer_is_member;

    if not v_engineer_is_member then
      raise exception 'quote_line_items.engineer_user_id must be a member of the same organization as the quote line item'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_quote_line_item_relations() is
  'BEFORE INSERT/UPDATE OF quote_id, asset_id, article_id, engineer_user_id trigger on public.quote_line_items: rejects an asset_id belonging to a different client than the quote''s own client_id, an article_id belonging to a different organization than the quote''s own organization_id, and an engineer_user_id who is not a member of the line item''s own organization_id. Extended in 20260830120000_quote_line_items_discount_and_engineer.sql with the engineer_user_id check (mirrors validate_work_order_relations'' assigned_to org-membership check). quote_id is excluded from the UPDATE column grant (design note 5, 20260824090000_quotes_core.sql), so the quote_id branch of this trigger''s WHEN clause is a defense-in-depth backstop. Runs after quote_line_items_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

drop trigger if exists quote_line_items_validate_relations on public.quote_line_items;

create trigger quote_line_items_validate_relations
  before insert or update of quote_id, asset_id, article_id, engineer_user_id on public.quote_line_items
  for each row execute function public.validate_quote_line_item_relations();

-- ---------------------------------------------------------------------------
-- Column grants: extend the existing INSERT/UPDATE column lists (same actors
-- as today — owner/planner, per quote_line_items' RLS policies from
-- 20260824090000_quotes_core.sql — nothing more/less). No RLS policy change.
-- ---------------------------------------------------------------------------
grant insert (discount_percent, engineer_user_id) on public.quote_line_items to authenticated;
grant update (discount_percent, engineer_user_id) on public.quote_line_items to authenticated;
