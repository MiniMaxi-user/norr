-- Work Order auto-draft Quote: freeze rates at time-of-registration, not at
-- "Create Quote" time (issue #109, "Work order: automatische conceptofferte
-- legt tarieven vast op moment van registratie"). See that issue's full
-- Dutch brief for the business narrative (a 31-Dec fault must bill at 31-Dec
-- rates even if the quote is only finalized on 5-Jan, after a rate change).
--
-- This is a schema/RLS/trigger-only migration -- no UI, no new Server
-- Actions beyond what's needed to prove the trigger chain works end to end.
-- `api-backend-engineer`/`frontend-ui-engineer` follow-ups are listed at the
-- bottom of this header.
--
-- Six things, in dependency order:
--
-- 1. `organizations.default_travel_article_id` /
--    `default_work_article_id` -- the org-level rate-resolution fallback
--    layer that `20260830090000_engineer_client_rate_overrides.sql`
--    explicitly left "out of scope" (see that migration's comment on
--    `memberships.has_custom_rate`: "the org's standing default travel/work
--    article+price applies instead (resolved at application layer, out of
--    scope for this migration)"). Same nullable-FK-into-articles shape as
--    `clients`/`memberships.travel_article_id`/`work_article_id`, but NO
--    separate override price column -- the default IS the linked article's
--    own `sale_price`/`purchase_price`, read live, same "no snapshot, no
--    drift" posture as every other price-from-article lookup in this
--    schema. Validated by a NEW dedicated trigger,
--    `validate_organization_default_rate_articles` -- NOT a reuse of
--    `validate_rate_override_articles`, because that shared function checks
--    the article's org against `new.organization_id` (a column), whereas an
--    `organizations` row's own id IS the organization id being checked
--    against (`new.id`); forcing the two into one function would need an
--    extra branch keyed on `tg_table_name = 'organizations'`, which is more
--    convoluted than just writing the (structurally near-identical) second
--    function.
--
-- 2. `quotes.is_auto_draft boolean not null default false` -- marks a quote
--    as the system-managed 1:1 shadow of a work order, distinct from
--    `status_id` pointing at the `Draft` reference item (which also covers
--    ordinary human-authored draft quotes). At most one `is_auto_draft`
--    quote per `work_order_id`, enforced by a partial unique index
--    (`quotes_one_auto_draft_per_work_order_idx`); a plain CHECK
--    (`quotes_auto_draft_requires_work_order`) requires `work_order_id` to
--    be set whenever `is_auto_draft` is true (an auto-draft is only ever
--    created FROM a work order -- see point 4). `is_auto_draft` is
--    deliberately excluded from the INSERT column grant (only the
--    SECURITY DEFINER trigger in point 4 ever sets it true -- see that
--    trigger's own note on why a SECURITY DEFINER function's DML bypasses
--    column-level grants) but IS included in the UPDATE grant, since
--    flipping it to `false` is exactly what a future "Create Quote" button
--    promotion action (issue #109 acceptance criterion 6, `api-backend-
--    engineer` follow-up, NOT built here) needs to do as an ordinary
--    owner/planner UPDATE under the existing `quotes_update_owner_or_planner`
--    policy -- no new RLS tier.
--
-- 3. `quote_line_items.purchase_price numeric(12,2)` -- a new STORED
--    snapshot column, nullable. For a human-authored line item this stays
--    null/unused, exactly like today (purchase price is read live from
--    `articles.purchase_price` at the application layer, per
--    `20260830100000_work_order_articles_and_quote_traceability.sql`'s own
--    design note 2 -- unchanged, don't touch that path). For an auto-draft-
--    owned line item (point 6's sync triggers), it IS frozen at write time,
--    same historical-accuracy reasoning as `unit_price` -- otherwise the
--    margin on a historical work order would silently drift every time the
--    linked article's purchase price changes. Non-negative CHECK, same
--    style as every other price column in this schema
--    (`quote_line_items_purchase_price_non_negative`). Deliberately excluded
--    from both the INSERT and UPDATE column grants -- only ever written by
--    the SECURITY DEFINER sync triggers in point 6, never directly by a
--    client; a future manual-entry UI for it is `api-backend-engineer`'s
--    call, not assumed here.
--
--    Two more new columns on `quote_line_items`, needed to make point 6's
--    sync idempotent (upsert/delete the SAME row across repeated
--    inserts/updates of the same source row, not append a fresh line every
--    time): `source_time_entry_id uuid references time_entries(id) on
--    delete set null` and `source_work_order_article_id uuid references
--    work_order_articles(id) on delete set null`. `on delete set null`
--    (not cascade) is deliberate: once a quote is promoted
--    (`is_auto_draft -> false`), its frozen line items must survive the
--    later deletion of their source `time_entries`/`work_order_articles`
--    row (issue #109 acceptance criterion 6, "bevroren regels blijven
--    staan" / "frozen lines remain") -- a blind `on delete cascade` would
--    incorrectly delete a PROMOTED quote's historical line item just
--    because someone later corrected/removed the source time entry. Instead,
--    point 6's sync trigger explicitly deletes the line item on a source-row
--    DELETE, but ONLY while the owning quote is still `is_auto_draft = true`
--    -- once promoted, the FK's `set null` just severs the (by-then
--    meaningless) traceability link and the frozen row itself is left alone.
--    A partial unique index on each column (`... where ... is not null`)
--    enforces "at most one line item per source row" and doubles as this
--    pair's required FK/filter index (no separate plain index needed -- the
--    partial unique index already serves every lookup the sync triggers do,
--    all of which filter on a specific non-null id). A CHECK
--    (`quote_line_items_single_sync_source`) keeps the two mutually
--    exclusive (a line item is synced from at most one kind of source, or
--    from neither if human-authored).
--
-- 4. Auto-draft creation: `work_orders_create_auto_draft_quote`, an AFTER
--    INSERT (not BEFORE -- the issue's own brief asks for AFTER, and there's
--    no reason to fight that: the work order row must already exist for
--    `quotes.work_order_id` to point at it) trigger on `work_orders`, so a
--    work order can never exist without its auto-draft regardless of which
--    Server Action performs the insert. SECURITY DEFINER: the INSERT this
--    trigger issues against `quotes` executes with the function owner's
--    privileges (bypassing BOTH `quotes`' RLS -- `force row level security`
--    notwithstanding, since the owning role has BYPASSRLS, same reasoning
--    already established for every other SECURITY DEFINER trigger in this
--    schema -- AND its column-level grants, since `is_auto_draft` is
--    deliberately withheld from the client-facing INSERT grant in point 2),
--    which is exactly what lets a plain owner/planner work-order-creating
--    INSERT transitively create a `quotes` row despite the inserting role
--    having no elevated `quotes` privilege of its own. `quotes_set_created_by`
--    (existing BEFORE INSERT trigger on `quotes`) still fires as part of
--    this same INSERT and stamps `created_by = auth.uid()` correctly --
--    `auth.uid()` is resolved from the session's JWT claim, unaffected by
--    SECURITY DEFINER role-switching. Name: `'Quote — ' || work order title`
--    -- the exact pattern `createQuoteFromWorkOrder`
--    (`app/(app)/work-orders/create-quote-actions.ts`) already uses for its
--    own (always-NEW, non-auto-draft) quote. `client_id`/`site_id` are
--    copied straight from the work order; `status_id` is left unset so
--    `derive_quote_organization_id` fills in the org's default `quote_status`
--    item (`Draft`), same as every other quote creation path.
--
-- 5. `public.resolve_billing_rate(p_organization_id, p_client_id, p_user_id,
--    p_is_travel) returns table(resolved_article_id, resolved_sale_price,
--    resolved_purchase_price)` -- the shared rate-resolution function, the
--    FULL 4-layer precedence from the issue brief (extending the 2-layer
--    version `createQuoteFromWorkOrder` already implements at the
--    application layer with the org-default layer that never existed
--    anywhere until this migration):
--      1. `clients.has_custom_rate` -> that client's own
--         `travel_article_id`/`travel_sale_price` (or `work_*`) --
--         purchase price still read live from `articles.purchase_price`.
--      2. else the engineer's (`memberships`, `p_user_id` +
--         `p_organization_id`) `has_custom_rate` -> same shape, membership
--         row.
--      3. else `organizations.default_travel_article_id`/
--         `default_work_article_id` (point 1) -> that article's OWN live
--         `sale_price`/`purchase_price` (no override price column at this
--         layer -- see point 1).
--      4. else unresolved -- returns zero rows (no exception raised; the
--         issue brief is explicit that an unresolved rate must be
--         "queryable" for a later UI to flag, not a hard failure that
--         blocks logging time in the first place).
--    STABLE + SECURITY DEFINER (reads `clients`/`memberships`/
--    `organizations`/`articles` regardless of the caller's own RLS
--    visibility into those tables, mirroring every other cross-table
--    resolution helper in this schema) -- but, UNLIKE those internal-only
--    `validate_*`/`derive_*` helpers, this one IS meant to be called
--    directly by `authenticated` (point 6's sync triggers call it, and the
--    issue brief explicitly asks for it to be reusable by future
--    application-layer preview/read-only calls too) via `revoke ... grant
--    execute`. That direct callability is exactly why it opens with an
--    `is_member_of_org(p_organization_id)` guard, raising `42501` otherwise
--    -- without it, ANY authenticated user on ANY tenant could pass an
--    arbitrary `p_organization_id`/`p_client_id`/`p_user_id` and read back
--    another tenant's rate-override article/price data, a real cross-tenant
--    leak a SECURITY DEFINER function without this guard would otherwise
--    open up. Called from inside point 6's own SECURITY DEFINER trigger
--    functions, `auth.uid()` still resolves to the original session's user
--    (session-level, unaffected by SECURITY DEFINER nesting), so the guard
--    passes exactly when it should (the inserting engineer is, by
--    definition, a member of their own organization -- already re-verified
--    server-side here, not merely trusted from the row).
--
-- 6. Sync triggers -- TWO per source table, not one, each split by timing:
--    `sync_time_entry_to_auto_draft_quote` (AFTER INSERT OR UPDATE on
--    `time_entries`, upserts) + `sync_time_entry_to_auto_draft_quote_delete`
--    (BEFORE DELETE, deletes), and the `work_order_articles` equivalents.
--    The DELETE half is deliberately its OWN BEFORE trigger rather than a
--    third branch folded into one AFTER INSERT/UPDATE/DELETE trigger:
--    `quote_line_items.source_time_entry_id`/`source_work_order_article_id`
--    are `on delete set null` FKs back to these exact tables, which Postgres
--    implements as its OWN internal AFTER-ROW trigger on the same table;
--    two AFTER DELETE ROW triggers on one table fire in ALPHABETICAL order
--    by trigger name, which is NOT guaranteed to put a user trigger after an
--    auto-generated `RI_ConstraintTrigger_...` one -- were the FK's SET
--    NULL to fire first, an AFTER-trigger cleanup here would find its
--    `source_time_entry_id = old.id` lookup already nulled out, leaving a
--    stale line item on a STILL-active auto-draft instead of deleting it.
--    Running the cleanup BEFORE DELETE instead sidesteps the race
--    entirely (see `sync_time_entry_to_auto_draft_quote_delete`'s own
--    comment for the full reasoning). All four functions are SECURITY
--    DEFINER, for the exact reason the issue brief calls out: an engineer
--    has INSERT/UPDATE rights on `time_entries`/`work_order_articles`
--    (own rows; no DELETE on either table -- that stays owner/planner-only
--    per existing RLS from `20260823180000_time_entries_core.sql`/
--    `20260830100000_...`) but NO direct write rights on
--    `quotes`/`quote_line_items` at all (Quotes' RBAC row is owner/planner
--    CRUD, engineer read-only) -- SECURITY DEFINER is what lets that
--    engineer's own INSERT/UPDATE (and an owner/planner's DELETE)
--    transitively write a `quote_line_items` row without ever being
--    granted a `quotes` privilege of their own.
--
--    **Scoped strictly to the row being synced, nothing client-trusted
--    beyond what existing RLS on the source table already validated**: both
--    functions only ever read `new`/`old`'s OWN already-validated columns
--    (`organization_id`/`work_order_id`, server-derived by
--    `derive_time_entry_organization_id`/`derive_work_order_article_organization_id`,
--    never client-writable; `article_id`, cross-org-validated by
--    `validate_work_order_article_relations`; `user_id`/`entry_type_id`,
--    org-membership/list-key-validated), look up the target quote SOLELY by
--    that row's own `work_order_id` + the system flag `is_auto_draft = true`
--    (never a client-supplied `quote_id`), and write only server-computed
--    values (a resolved rate, a live article price, a computed duration) --
--    there is no code path here that lets a caller's `time_entries`/
--    `work_order_articles` INSERT/UPDATE steer an arbitrary write into
--    someone else's quote.
--
--    **No auto-draft found (never created, or already promoted) ->
--    no-op**: both functions' very first step is the `is_auto_draft = true`
--    lookup; finding nothing means either this work order predates this
--    migration (acceptance criterion 10 -- no backfill, an auto-draft is
--    created lazily... actually not even lazily: a pre-existing work order
--    permanently has none until a NEW work order creates one going forward,
--    matching the brief's explicit no-backfill instruction) or its auto-draft
--    was already promoted (`is_auto_draft -> false`) -- either way, sync
--    silently stops, exactly per the brief.
--
--    **time_entries specifics**: excludes Break-type entries (not billable,
--    matches `createQuoteFromWorkOrder`'s own exclusion) and still-running
--    entries (`ended_at is null`) from ever having a line item; computes
--    quantity with the IDENTICAL whole-minute-then-2-decimal-hours rounding
--    `computeQuantityHours` uses in `create-quote-actions.ts`, so a quantity
--    never differs between this always-on sync path and that (still-live,
--    for a second manually-triggered quote) application code path; a
--    rounds-to-zero duration is treated the same as "unresolved" (no line
--    item). Rate resolution is the full point-5 function, keyed on
--    `entry_type_id`'s `labor`/`travel` value and the owning quote's OWN
--    `client_id` (which is the work order's `client_id` at auto-draft
--    creation time, but may since have been reassigned by an owner/planner
--    editing the auto-draft quote directly -- deliberately read live off
--    `quotes.client_id`, not re-derived from `work_orders.client_id`, so
--    such a reassignment is honored going forward). `work_order_id` is NOT
--    immutable on `time_entries` (unlike `work_order_articles`), so an
--    UPDATE that re-parents a time entry to a different work order first
--    cleans up any line item left on the OLD work order's auto-draft before
--    evaluating the new one.
--
--    **An unresolved rate (layer 4) leaves the time entry OFF the
--    auto-draft** -- same choice `createQuoteFromWorkOrder` already made
--    for its own `skippedTimeEntryIds` (rather than inserting a null/0-priced
--    placeholder line the way a consumed article with no `sale_price`
--    does -- time entries and consumed articles get different unresolved
--    treatment in the EXISTING code already, this migration doesn't invent
--    that asymmetry). Per the issue brief's explicit ask that this be
--    "queryable" for a later UI to surface as "N entries missing rate": it
--    IS queryable, by joining eligible `time_entries` (Labor/Travel,
--    `ended_at` set) against `quote_line_items` on
--    `source_time_entry_id` and finding no match, scoped to the work
--    order's `is_auto_draft` quote -- deliberately no extra boolean/flag
--    column added for this (would just be redundant with that join), left
--    for `api-backend-engineer`/`frontend-ui-engineer` to build the actual
--    "N entries missing rate" surface.
--
--    **work_order_articles specifics**: simpler -- price is always resolved
--    directly from `articles.sale_price`/`purchase_price` (no client/
--    engineer override layer involved for consumed materials, matching this
--    table's existing "no price snapshot, no rate-override involvement"
--    design). A missing `sale_price` defaults `unit_price` to 0 (same
--    "visibly wrong-but-present beats silently missing" choice
--    `createQuoteFromWorkOrder` already made for this exact case) rather
--    than being skipped -- unlike a time entry, a consumed article's
--    pricing target (`article_id`) is always known, just possibly unpriced.
--    `work_order_id` IS immutable on this table (no UPDATE grant on it, per
--    `20260830100000_...`), so there is no re-parenting case to handle here.
--
--    `sort_order` is left at its column default (0) for every
--    sync-inserted line item -- maintaining a globally-correct interleaved
--    order (time-entry lines by `started_at`, then article lines by
--    `created_at`, the way `createQuoteFromWorkOrder` does it for a one-shot
--    batch insert) across an open-ended stream of incremental
--    inserts/updates/deletes is real added complexity with no functional
--    payoff yet, since nothing reads/displays these auto-draft line items
--    today; a future read (Work Order cost display, or the promoted quote's
--    own line items list) can order by joining back to
--    `time_entries.started_at`/`work_order_articles.created_at` via the new
--    `source_*` columns, or a later pass can maintain `sort_order` for real
--    once something actually renders it in order. Flagged here rather than
--    silently decided.
--
-- ---------------------------------------------------------------------------
-- Explicitly OUT OF SCOPE here (frontend-ui-engineer / api-backend-engineer
-- follow-ups, per the issue #109 brief):
--   - The "Create Quote" button's promotion logic (flip the existing
--     auto-draft's `is_auto_draft -> false` instead of always creating a
--     new quote -- acceptance criterion 6). `createQuoteFromWorkOrder`
--     (`app/(app)/work-orders/create-quote-actions.ts`) still always creates
--     a brand-new quote today; that function needs a follow-up pass to look
--     for an existing `is_auto_draft = true` quote on the work order first.
--   - Settings UI for `organizations.default_travel_article_id`/
--     `default_work_article_id` (acceptance criterion 4) -- an org-owner-only
--     picker, same shape as the existing Engineer/Client rate-override forms.
--   - Work Order cost display reading the auto-draft's frozen line items
--     (Hours section per-bucket costs, "To invoice" KPI tile -- acceptance
--     criterion 7) -- today's Work Order screen has no cost display wired to
--     `quote_line_items` at all yet.
--   - `/quotes` list labeling/filtering out `is_auto_draft` quotes by default
--     (acceptance criterion 8).
--   - The "N entries missing rate" UI surface described in point 6 above.
--   - `resolve_billing_rate` is exposed for a future live preview (e.g. "what
--     rate would apply right now") but no caller uses it yet outside the
--     sync triggers.

-- ===========================================================================
-- 1. organizations.default_travel_article_id / default_work_article_id
-- ===========================================================================
alter table public.organizations
  add column default_travel_article_id uuid references public.articles (id),
  add column default_work_article_id uuid references public.articles (id);

comment on column public.organizations.default_travel_article_id is
  'Org-level rate-resolution fallback (issue #109, layer 3 of resolve_billing_rate) -- the Travel-time billing article used when neither the client nor the assigned engineer has a custom-rate override. Nullable (layer 3 simply contributes nothing when unset, falling through to "unresolved"). No separate override price column: the price IS this article''s own live sale_price/purchase_price, read via this FK, same "never snapshot" posture as every other price-from-article lookup in this schema. Validated to belong to THIS SAME organization by validate_organization_default_rate_articles.';
comment on column public.organizations.default_work_article_id is
  'Org-level rate-resolution fallback (issue #109, layer 3) -- the Work-time (Labor) billing article used when neither the client nor the assigned engineer has a custom-rate override. See default_travel_article_id''s comment for the full reasoning (identical, substituting Work/Labor for Travel).';

create index organizations_default_travel_article_id_idx on public.organizations (default_travel_article_id);
create index organizations_default_work_article_id_idx on public.organizations (default_work_article_id);

-- Dedicated validation trigger (NOT a reuse of validate_rate_override_articles
-- -- see migration header point 1 for why): checks each article's own
-- organization_id against new.id (the organizations row's own id IS the
-- organization id here), not against a separate organization_id column the
-- way clients/memberships have.
create or replace function public.validate_organization_default_rate_articles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_travel_org uuid;
  v_work_org uuid;
begin
  if new.default_travel_article_id is not null then
    select organization_id into v_travel_org
    from public.articles
    where id = new.default_travel_article_id;

    if v_travel_org is null then
      raise exception 'organizations.default_travel_article_id % does not reference an existing article', new.default_travel_article_id
        using errcode = '23503';
    elsif v_travel_org <> new.id then
      raise exception 'organizations.default_travel_article_id must belong to this same organization'
        using errcode = '23514';
    end if;
  end if;

  if new.default_work_article_id is not null then
    select organization_id into v_work_org
    from public.articles
    where id = new.default_work_article_id;

    if v_work_org is null then
      raise exception 'organizations.default_work_article_id % does not reference an existing article', new.default_work_article_id
        using errcode = '23503';
    elsif v_work_org <> new.id then
      raise exception 'organizations.default_work_article_id must belong to this same organization'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_organization_default_rate_articles() is
  'BEFORE INSERT/UPDATE OF default_travel_article_id, default_work_article_id trigger on public.organizations: rejects an article that does not exist, or belongs to a DIFFERENT organization than the row itself (checked against new.id, since an organizations row IS the organization). Not a reuse of validate_rate_override_articles (20260830090000_engineer_client_rate_overrides.sql) -- that function checks against a new.organization_id COLUMN, which organizations does not have; see this migration''s header design note 1.';

create trigger organizations_validate_default_rate_articles
  before insert or update of default_travel_article_id, default_work_article_id on public.organizations
  for each row execute function public.validate_organization_default_rate_articles();

-- No new GRANT statement needed: organizations has never had column-level
-- INSERT/UPDATE lockdown (its baseline grant, 20260822150910_organizations_
-- memberships_baseline_rls.sql, is table-wide -- `grant select, insert,
-- update on public.organizations to authenticated`, which already covers
-- these 2 new columns automatically), same pre-existing scope difference
-- documented for `memberships` in 20260830090000_engineer_client_rate_
-- overrides.sql's design note 4. Actual write access is still gated by the
-- unchanged `organizations_update_owner` RLS policy (is_org_owner) -- and,
-- for the (table-grant-permitted but practically self-defeating) INSERT
-- path, by validate_organization_default_rate_articles itself: a
-- brand-new organizations row's own id has no articles yet, so any
-- non-null default_travel_article_id/default_work_article_id supplied on
-- that same INSERT is rejected as belonging to "a different organization"
-- (23514) -- these columns are, in practice, only ever settable via a
-- later UPDATE by that org's own owner.

-- ===========================================================================
-- 2. quotes.is_auto_draft
-- ===========================================================================
alter table public.quotes
  add column is_auto_draft boolean not null default false,
  add constraint quotes_auto_draft_requires_work_order
    check (not is_auto_draft or work_order_id is not null);

comment on column public.quotes.is_auto_draft is
  'True when this quote is the system-managed 1:1 shadow of a work order (issue #109), auto-created by work_orders_create_auto_draft_quote and kept in sync by the time_entries/work_order_articles sync triggers until promoted (is_auto_draft -> false, by a future "Create Quote" button action -- not built in this migration). Distinct from status_id pointing at the Draft reference item, which also covers ordinary human-authored draft quotes. Requires work_order_id to be set (quotes_auto_draft_requires_work_order) -- an auto-draft only ever originates FROM a work order. At most one is_auto_draft quote per work_order_id (quotes_one_auto_draft_per_work_order_idx). Excluded from the INSERT column grant (only the SECURITY DEFINER work_orders_create_auto_draft_quote trigger ever sets it true); included in the UPDATE grant so an owner/planner promotion action can flip it to false under the existing quotes_update_owner_or_planner policy -- no new RLS tier.';

create unique index quotes_one_auto_draft_per_work_order_idx
  on public.quotes (work_order_id)
  where is_auto_draft;

grant update (is_auto_draft) on public.quotes to authenticated;

-- ===========================================================================
-- 3. quote_line_items: purchase_price (stored snapshot) + source_time_entry_id
--    / source_work_order_article_id (sync identity columns)
-- ===========================================================================
alter table public.quote_line_items
  add column purchase_price numeric(12, 2),
  add column source_time_entry_id uuid references public.time_entries (id) on delete set null,
  add column source_work_order_article_id uuid references public.work_order_articles (id) on delete set null,
  add constraint quote_line_items_purchase_price_non_negative
    check (purchase_price is null or purchase_price >= 0),
  add constraint quote_line_items_single_sync_source
    check (source_time_entry_id is null or source_work_order_article_id is null);

comment on column public.quote_line_items.purchase_price is
  'STORED snapshot (issue #109) -- unlike unit_price (always genuinely user-entered) and every other purchase-price lookup in this schema (always read live from articles.purchase_price), this column exists specifically so an auto-draft-owned line item (source_time_entry_id/source_work_order_article_id set) can freeze its purchase price at the moment it was synced, for the exact same historical-accuracy reason unit_price is frozen there. NULL/unused for an ordinary human-authored line item -- that path is unchanged, still reads articles.purchase_price live at the application layer. Non-negative when set (quote_line_items_purchase_price_non_negative). Excluded from both the INSERT and UPDATE column grants -- only ever written by the SECURITY DEFINER sync triggers below, never directly by a client.';
comment on column public.quote_line_items.source_time_entry_id is
  'Nullable FK into time_entries -- set exactly when this line item was created/is maintained by sync_time_entry_to_auto_draft_quote (issue #109), null for a human-authored line item or one synced from a work_order_article instead (quote_line_items_single_sync_source keeps the two mutually exclusive). on delete set null (not cascade): once the owning quote is promoted (is_auto_draft -> false), a later deletion of the source time entry must NOT delete this now-historical frozen line item -- see this migration''s header for the full reasoning. The partial unique index below (quote_line_items_source_time_entry_id_uidx) is what makes the sync trigger''s upsert idempotent (one line item per source row, found/updated on every subsequent change instead of appended).';
comment on column public.quote_line_items.source_work_order_article_id is
  'Nullable FK into work_order_articles -- the work_order_articles analogue of source_time_entry_id, set by sync_work_order_article_to_auto_draft_quote. See that column''s comment for the full reasoning (identical).';

create unique index quote_line_items_source_time_entry_id_uidx
  on public.quote_line_items (source_time_entry_id)
  where source_time_entry_id is not null;

create unique index quote_line_items_source_work_order_article_id_uidx
  on public.quote_line_items (source_work_order_article_id)
  where source_work_order_article_id is not null;

-- ===========================================================================
-- 4. Auto-draft creation: AFTER INSERT on work_orders. SECURITY DEFINER --
--    see migration header point 4 for why this is what lets the INSERT
--    succeed despite is_auto_draft being withheld from the client-facing
--    INSERT grant on quotes.
-- ===========================================================================
create or replace function public.create_work_order_auto_draft_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.quotes (client_id, site_id, work_order_id, name, is_auto_draft)
  values (new.client_id, new.site_id, new.id, 'Quote — ' || new.title, true);

  return new;
end;
$$;

comment on function public.create_work_order_auto_draft_quote() is
  'AFTER INSERT trigger on public.work_orders (issue #109): creates the linked is_auto_draft quote for every new work order, unconditionally -- makes it impossible to create a work order without one, regardless of which Server Action performs the insert. SECURITY DEFINER so this INSERT into quotes succeeds despite is_auto_draft being withheld from the client-facing INSERT grant, and regardless of the inserting role''s own quotes RLS privileges (an engineer has none). client_id/site_id copied from the work order; status_id left unset so derive_quote_organization_id fills in the org''s default quote_status (Draft) item, same as every other quote-creation path. Name mirrors createQuoteFromWorkOrder''s own "Quote — {title}" pattern (app/(app)/work-orders/create-quote-actions.ts).';

create trigger work_orders_create_auto_draft_quote
  after insert on public.work_orders
  for each row execute function public.create_work_order_auto_draft_quote();

-- ===========================================================================
-- 5. resolve_billing_rate: the shared 4-layer rate-resolution function. See
--    migration header point 5 for the full precedence/security reasoning.
-- ===========================================================================
create or replace function public.resolve_billing_rate(
  p_organization_id uuid,
  p_client_id uuid,
  p_user_id uuid,
  p_is_travel boolean
)
returns table (
  resolved_article_id uuid,
  resolved_sale_price numeric,
  resolved_purchase_price numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_client_has_custom_rate boolean;
  v_client_article_id uuid;
  v_client_sale_price numeric;
  v_membership_has_custom_rate boolean;
  v_membership_article_id uuid;
  v_membership_sale_price numeric;
  v_org_default_article_id uuid;
  v_article_id uuid;
  v_sale_price numeric;
  v_purchase_price numeric;
begin
  -- Direct callers (this is grant-execute-to-authenticated, unlike this
  -- schema's internal-only validate_*/derive_* helpers -- see migration
  -- header point 5) must be a member of the organization they're asking
  -- about; without this guard a SECURITY DEFINER function taking a bare
  -- p_organization_id would let any authenticated user on any tenant read
  -- back another tenant's rate-override article/price data.
  if not public.is_member_of_org(p_organization_id) then
    raise exception 'resolve_billing_rate: caller is not a member of organization %', p_organization_id
      using errcode = '42501';
  end if;

  -- Layer 1: client override (clients.has_custom_rate).
  if p_is_travel then
    select c.has_custom_rate, c.travel_article_id, c.travel_sale_price
      into v_client_has_custom_rate, v_client_article_id, v_client_sale_price
      from public.clients c
      where c.id = p_client_id;
  else
    select c.has_custom_rate, c.work_article_id, c.work_sale_price
      into v_client_has_custom_rate, v_client_article_id, v_client_sale_price
      from public.clients c
      where c.id = p_client_id;
  end if;

  if coalesce(v_client_has_custom_rate, false) and v_client_article_id is not null then
    v_article_id := v_client_article_id;
    v_sale_price := v_client_sale_price;
  else
    -- Layer 2: engineer (membership) override.
    if p_is_travel then
      select m.has_custom_rate, m.travel_article_id, m.travel_sale_price
        into v_membership_has_custom_rate, v_membership_article_id, v_membership_sale_price
        from public.memberships m
        where m.user_id = p_user_id and m.organization_id = p_organization_id;
    else
      select m.has_custom_rate, m.work_article_id, m.work_sale_price
        into v_membership_has_custom_rate, v_membership_article_id, v_membership_sale_price
        from public.memberships m
        where m.user_id = p_user_id and m.organization_id = p_organization_id;
    end if;

    if coalesce(v_membership_has_custom_rate, false) and v_membership_article_id is not null then
      v_article_id := v_membership_article_id;
      v_sale_price := v_membership_sale_price;
    else
      -- Layer 3: org-level default (point 1 above) -- price is read live
      -- from the article's own sale_price below (no override price column
      -- at this layer), signalled here by leaving v_sale_price null.
      if p_is_travel then
        select o.default_travel_article_id into v_org_default_article_id
          from public.organizations o where o.id = p_organization_id;
      else
        select o.default_work_article_id into v_org_default_article_id
          from public.organizations o where o.id = p_organization_id;
      end if;

      v_article_id := v_org_default_article_id;
      v_sale_price := null;
    end if;
  end if;

  -- Layer 4: unresolved -- no exception, just zero rows returned (see
  -- migration header point 5: the caller decides how to handle/flag this).
  if v_article_id is null then
    return;
  end if;

  select a.purchase_price into v_purchase_price
    from public.articles a where a.id = v_article_id;

  if v_sale_price is null then
    select a.sale_price into v_sale_price
      from public.articles a where a.id = v_article_id;
  end if;

  return query select v_article_id, v_sale_price, v_purchase_price;
end;
$$;

comment on function public.resolve_billing_rate(uuid, uuid, uuid, boolean) is
  'Shared 4-layer rate-resolution function (issue #109): client has_custom_rate override -> engineer (membership) has_custom_rate override -> organizations.default_travel_article_id/default_work_article_id (that article''s own live sale_price/purchase_price) -> unresolved (zero rows, no exception). SECURITY DEFINER + STABLE, callable directly by authenticated (revoke/grant below) for a future read-only preview, and by the sync triggers below. Opens with an is_member_of_org(p_organization_id) guard -- required precisely because it IS directly callable, unlike this schema''s internal-only validate_*/derive_* trigger helpers; see this function''s own body comment.';

revoke all on function public.resolve_billing_rate(uuid, uuid, uuid, boolean) from public;
grant execute on function public.resolve_billing_rate(uuid, uuid, uuid, boolean) to authenticated;

-- ===========================================================================
-- 6a. Sync trigger: time_entries -> auto-draft quote_line_items.
-- ===========================================================================
create or replace function public.sync_time_entry_to_auto_draft_quote_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote_id uuid;
begin
  -- BEFORE DELETE (not AFTER -- see this function's own comment below for
  -- why): remove any previously-synced line item, keyed on
  -- source_time_entry_id, but ONLY while the owning quote is still an
  -- auto-draft (see migration header -- sync stops permanently once
  -- promoted; a promoted quote's frozen line item survives its source time
  -- entry being deleted, severed to null by the FK's own on delete set null
  -- instead).
  select id into v_quote_id
    from public.quotes
    where work_order_id = old.work_order_id and is_auto_draft
    limit 1;

  if v_quote_id is not null then
    delete from public.quote_line_items
      where source_time_entry_id = old.id and quote_id = v_quote_id;
  end if;

  return old;
end;
$$;

comment on function public.sync_time_entry_to_auto_draft_quote_delete() is
  'BEFORE DELETE trigger on public.time_entries (issue #109) -- deliberately BEFORE, not AFTER, and a SEPARATE trigger/function from the INSERT/UPDATE one below. quote_line_items.source_time_entry_id''s own FK is ON DELETE SET NULL (not cascade -- see the migration header), which Postgres implements as its own internal AFTER-ROW trigger on THIS table; if this cleanup also ran AFTER DELETE, its firing order relative to that internal FK trigger would be alphabetical-by-trigger-name and NOT reliably ordered after it (an "RI_ConstraintTrigger_..." name can sort before a user trigger name) -- were the FK''s SET NULL to run first, this trigger''s source_time_entry_id = old.id lookup would already find nothing (nulled out), leaving a stale line item behind on a STILL-active auto-draft instead of deleting it. Running BEFORE DELETE sidesteps the race entirely: this delete always happens strictly before the parent row (and therefore the FK action) is even removed.';

create trigger time_entries_sync_auto_draft_quote_delete
  before delete on public.time_entries
  for each row execute function public.sync_time_entry_to_auto_draft_quote_delete();

-- ---------------------------------------------------------------------------
-- INSERT/UPDATE half -- AFTER, upserts the line item. See
-- sync_time_entry_to_auto_draft_quote_delete's own comment above for why
-- DELETE is handled by a separate BEFORE trigger instead of folded in here.
-- ---------------------------------------------------------------------------
create or replace function public.sync_time_entry_to_auto_draft_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote_id uuid;
  v_old_quote_id uuid;
  v_quote_client_id uuid;
  v_entry_type text;
  v_is_travel boolean;
  v_billable boolean;
  v_total_minutes numeric;
  v_quantity numeric;
  v_resolved_article_id uuid;
  v_resolved_sale_price numeric;
  v_resolved_purchase_price numeric;
  v_article_number text;
  v_article_description text;
  v_line_description text;
  v_existing_line_item_id uuid;
begin
  -- work_order_id is NOT immutable on time_entries (unlike
  -- work_order_articles') -- handle re-parenting first: clean up any line
  -- item left behind on the OLD work order's auto-draft quote. This is safe
  -- as an AFTER-trigger delete (unlike the DELETE case above) because it
  -- does not delete the OLD row itself, so no FK ON DELETE action is ever
  -- involved here.
  if tg_op = 'UPDATE' and old.work_order_id is distinct from new.work_order_id then
    select id into v_old_quote_id
      from public.quotes
      where work_order_id = old.work_order_id and is_auto_draft
      limit 1;

    if v_old_quote_id is not null then
      delete from public.quote_line_items
        where source_time_entry_id = old.id and quote_id = v_old_quote_id;
    end if;
  end if;

  select q.id, q.client_id into v_quote_id, v_quote_client_id
    from public.quotes q
    where q.work_order_id = new.work_order_id and q.is_auto_draft
    limit 1;

  -- No auto-draft quote for this work order (never created -- a pre-
  -- migration work order, acceptance criterion 10 -- or already promoted).
  if v_quote_id is null then
    return new;
  end if;

  select rli.value into v_entry_type
    from public.reference_list_items rli
    where rli.id = new.entry_type_id;

  v_billable := coalesce(v_entry_type in ('labor', 'travel'), false);
  v_is_travel := v_entry_type = 'travel';

  -- Not billable (Break, or an unresolved entry_type), or still running (no
  -- ended_at yet) -- no valid line item can exist right now; remove any
  -- stale one from a previous state (e.g. entry_type changed Travel ->
  -- Break, or ended_at was cleared) and stop.
  if not v_billable or new.ended_at is null then
    delete from public.quote_line_items
      where source_time_entry_id = new.id and quote_id = v_quote_id;
    return new;
  end if;

  -- Same whole-minute-then-2-decimal-hours rounding as
  -- createQuoteFromWorkOrder's computeQuantityHours
  -- (app/(app)/work-orders/create-quote-actions.ts) -- kept identical so a
  -- time-entry-derived quantity never differs between this always-on sync
  -- path and that (still-live, for a manually-created second quote) path.
  v_total_minutes := round(extract(epoch from (new.ended_at - new.started_at))::numeric / 60);
  v_quantity := round((v_total_minutes / 60) * 100) / 100;

  if v_quantity is null or v_quantity <= 0 then
    -- Rounds to 0 hours -- same "treated as unresolvable" rule as the
    -- application-layer path; remove any stale line item and stop.
    delete from public.quote_line_items
      where source_time_entry_id = new.id and quote_id = v_quote_id;
    return new;
  end if;

  select resolved_article_id, resolved_sale_price, resolved_purchase_price
    into v_resolved_article_id, v_resolved_sale_price, v_resolved_purchase_price
    from public.resolve_billing_rate(new.organization_id, v_quote_client_id, new.user_id, v_is_travel);

  if v_resolved_article_id is null then
    -- Unresolved rate: leave this time entry OFF the auto-draft (see
    -- migration header point 6 for why, and how it stays queryable). Remove
    -- any stale line item (e.g. an override that used to resolve was since
    -- removed) and stop.
    delete from public.quote_line_items
      where source_time_entry_id = new.id and quote_id = v_quote_id;
    return new;
  end if;

  select a.article_number, a.description into v_article_number, v_article_description
    from public.articles a
    where a.id = v_resolved_article_id;

  v_line_description := coalesce(v_article_number || ' — ' || v_article_description, 'Time entry');

  select id into v_existing_line_item_id
    from public.quote_line_items
    where source_time_entry_id = new.id and quote_id = v_quote_id;

  if v_existing_line_item_id is not null then
    update public.quote_line_items
      set description = v_line_description,
          quantity = v_quantity,
          unit_price = coalesce(v_resolved_sale_price, 0),
          purchase_price = v_resolved_purchase_price,
          article_id = v_resolved_article_id,
          engineer_user_id = new.user_id
      where id = v_existing_line_item_id;
  else
    insert into public.quote_line_items (
      quote_id, source_time_entry_id, description, quantity, unit_price,
      purchase_price, article_id, engineer_user_id
    ) values (
      v_quote_id, new.id, v_line_description, v_quantity, coalesce(v_resolved_sale_price, 0),
      v_resolved_purchase_price, v_resolved_article_id, new.user_id
    );
  end if;

  return new;
end;
$$;

comment on function public.sync_time_entry_to_auto_draft_quote() is
  'AFTER INSERT/UPDATE trigger on public.time_entries (issue #109): upserts the corresponding quote_line_items row (matched by source_time_entry_id) on that work order''s is_auto_draft quote, freezing the resolved sale_price/purchase_price at write time. DELETE is handled by the separate BEFORE DELETE trigger/function above (sync_time_entry_to_auto_draft_quote_delete), not here -- see that function''s comment for why. SECURITY DEFINER -- lets an engineer''s own time_entries INSERT (which they DO have RLS rights for) transitively write quote_line_items (which they do NOT). No-ops entirely when no is_auto_draft quote exists for the work order (never created, or already promoted -- sync stops permanently on promotion). See this migration''s header for the full design reasoning (billable-type filtering, quantity rounding, unresolved-rate handling, re-parenting).';

create trigger time_entries_sync_auto_draft_quote
  after insert or update on public.time_entries
  for each row execute function public.sync_time_entry_to_auto_draft_quote();

-- ===========================================================================
-- 6b. Sync trigger: work_order_articles -> auto-draft quote_line_items.
--     Simpler than 6a -- price is always resolved directly from
--     articles.sale_price/purchase_price, no client/engineer override layer
--     involved (matches work_order_articles' existing no-price-snapshot
--     design). work_order_id is immutable on this table, so there is no
--     re-parenting case to handle.
-- ===========================================================================
create or replace function public.sync_work_order_article_to_auto_draft_quote_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote_id uuid;
begin
  -- BEFORE DELETE, not AFTER -- same FK-firing-order race avoided as
  -- sync_time_entry_to_auto_draft_quote_delete above (see that function's
  -- own comment for the full reasoning); quote_line_items.
  -- source_work_order_article_id has the identical ON DELETE SET NULL FK
  -- shape.
  select id into v_quote_id
    from public.quotes
    where work_order_id = old.work_order_id and is_auto_draft
    limit 1;

  if v_quote_id is not null then
    delete from public.quote_line_items
      where source_work_order_article_id = old.id and quote_id = v_quote_id;
  end if;

  return old;
end;
$$;

comment on function public.sync_work_order_article_to_auto_draft_quote_delete() is
  'BEFORE DELETE trigger on public.work_order_articles (issue #109) -- see sync_time_entry_to_auto_draft_quote_delete''s comment (20260901090000_work_order_auto_draft_quotes.sql) for the full FK-firing-order reasoning this mirrors exactly.';

create trigger work_order_articles_sync_auto_draft_quote_delete
  before delete on public.work_order_articles
  for each row execute function public.sync_work_order_article_to_auto_draft_quote_delete();

-- ---------------------------------------------------------------------------
-- INSERT/UPDATE half -- AFTER, upserts the line item.
-- ---------------------------------------------------------------------------
create or replace function public.sync_work_order_article_to_auto_draft_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote_id uuid;
  v_article_number text;
  v_article_description text;
  v_line_description text;
  v_sale_price numeric;
  v_purchase_price numeric;
  v_existing_line_item_id uuid;
begin
  select id into v_quote_id
    from public.quotes
    where work_order_id = new.work_order_id and is_auto_draft
    limit 1;

  if v_quote_id is null then
    return new;
  end if;

  select a.article_number, a.description, a.sale_price, a.purchase_price
    into v_article_number, v_article_description, v_sale_price, v_purchase_price
    from public.articles a
    where a.id = new.article_id;

  v_line_description := coalesce(v_article_number || ' — ' || v_article_description, 'Consumed article');

  select id into v_existing_line_item_id
    from public.quote_line_items
    where source_work_order_article_id = new.id and quote_id = v_quote_id;

  if v_existing_line_item_id is not null then
    update public.quote_line_items
      set description = v_line_description,
          quantity = new.quantity,
          unit_price = coalesce(v_sale_price, 0),
          purchase_price = v_purchase_price,
          article_id = new.article_id
      where id = v_existing_line_item_id;
  else
    insert into public.quote_line_items (
      quote_id, source_work_order_article_id, description, quantity, unit_price,
      purchase_price, article_id
    ) values (
      v_quote_id, new.id, v_line_description, new.quantity, coalesce(v_sale_price, 0),
      v_purchase_price, new.article_id
    );
  end if;

  return new;
end;
$$;

comment on function public.sync_work_order_article_to_auto_draft_quote() is
  'AFTER INSERT/UPDATE trigger on public.work_order_articles (issue #109): upserts the corresponding quote_line_items row (matched by source_work_order_article_id) on that work order''s is_auto_draft quote, snapshotting articles.sale_price/purchase_price at write time. DELETE is handled by the separate BEFORE DELETE trigger/function above (sync_work_order_article_to_auto_draft_quote_delete). SECURITY DEFINER -- same reasoning as sync_time_entry_to_auto_draft_quote. No client/engineer rate-override layer involved (unlike time entries) -- price is always read straight from the consumed article. A missing sale_price defaults unit_price to 0 rather than skipping the line (same "visibly wrong-but-present" choice createQuoteFromWorkOrder already makes for this case).';

create trigger work_order_articles_sync_auto_draft_quote
  after insert or update on public.work_order_articles
  for each row execute function public.sync_work_order_article_to_auto_draft_quote();
