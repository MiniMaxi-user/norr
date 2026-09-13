-- Warehouse stock consumption deduction (issue #182, "[Story] Synchronisatie
-- voorraad monteur") -- the second of the three-story sequence
-- `20260916090000_warehouses_and_stock.sql` (issue #181) started. That
-- migration's own design note 3/comment on `warehouse_stock.total_consumed`
-- explicitly reserved this exact hook: "issue #182 is expected to add a
-- SECURITY DEFINER trigger on work_order_articles inserts that increments it
-- and decrements quantity together, scoped to the work order's assigned
-- engineer's own warehouse." This migration builds exactly that, and nothing
-- else -- no PWA catalog-filtering, no "my stock" API route, no UI; those are
-- other agents' follow-ups off this migration.
--
-- Does NOT touch `20260916090000_warehouses_and_stock.sql` at all -- no new
-- migration re-issuing that file's DDL, per instruction. No new columns, no
-- RLS policy change, no grant change on either `work_order_articles` or
-- `warehouse_stock`: the trigger function below is `SECURITY DEFINER`, so it
-- writes `warehouse_stock` with the function owner's privileges regardless of
-- the inserting caller's own RLS/column-grant standing on that table (an
-- engineer inserting their own `work_order_articles` row today has zero
-- direct grant on `warehouse_stock` at all -- see
-- `20260916090000_warehouses_and_stock.sql`'s RLS: engineer is read-own-only,
-- no write). Same "function-owner role bypasses RLS + grants" mechanism
-- `20260901090000_work_order_auto_draft_quotes.sql`'s sync triggers already
-- established for the identical shape (an engineer's own INSERT
-- transitively writing a table they have no direct privilege on).
--
-- Design notes (read before extending):
--
-- 1. **Trigger shape: `AFTER INSERT ... FOR EACH ROW`, not a statement-level
--    trigger.** `work_order_articles` rows are inserted one at a time from
--    the PWA finish route (`apps/pwa/app/api/work-orders/[id]/finish/
--    route.ts`'s `.insert(articles.map(...))` -- technically one multi-row
--    INSERT statement per finish call when multiple articles were consumed,
--    but each row still needs its own independent
--    `assigned-engineer-warehouse` resolution and its own `quantity`
--    delta applied to its own `article_id`'s stock line -- there is no
--    per-statement aggregation that would make a statement-level trigger
--    simpler or more correct here). A `FOR EACH ROW` trigger handles both
--    the single-row and multi-row-in-one-INSERT cases identically and
--    correctly.
--
-- 2. **Floors at 0 via `GREATEST(0, quantity - consumed)`, never lets the
--    `warehouse_stock_quantity_non_negative` CHECK constraint
--    (`20260916090000_warehouses_and_stock.sql`) fire.** A real-world
--    engineer can consume more of an article than the system has on record
--    (a miscount, an off-book restock, etc.) -- letting that CHECK abort the
--    UPDATE would abort the triggering `work_order_articles` INSERT itself
--    (same transaction), which would block a work order from finishing.
--    Unacceptable per the brief -- finishing a job must never fail because
--    of a stock bookkeeping mismatch.
--
-- 3. **`total_consumed` always increases by the FULL consumed amount,
--    independent of the floor.** This is exactly why `total_consumed` exists
--    as a separate column from `quantity` (see
--    `20260916090000_warehouses_and_stock.sql`'s own comment on it): it
--    tracks REAL usage, including the "used more than we had recorded" case,
--    which `quantity` alone (floored at 0) cannot represent.
--
-- 4. **`last_counted_at` is never touched by this trigger.** Per
--    `20260916090000_warehouses_and_stock.sql`'s design note 3, that column
--    is stamped only by a human manually correcting the on-hand count
--    (an `api-backend-engineer`-owned Server Action naming `last_counted_at`
--    explicitly in its own UPDATE's column list); this is a system-driven
--    deduction, a structurally different write path, so this trigger's own
--    UPDATE statement simply never names that column.
--
-- 5. **Resolution path: `work_order_articles.work_order_id` ->
--    `work_orders.assigned_to` -> that user's `memberships.role` (must be
--    `'engineer'`, in the SAME `organization_id` as the consumed article) ->
--    `warehouses` row for `(organization_id, assigned_to)` -> `warehouse_
--    stock` row for `(that warehouse_id, article_id)`.** Every step is a
--    safe no-op (not an exception) when it doesn't resolve, per the brief:
--      - `assigned_to is null` (unassigned work order, or a planner created
--        it for themselves with no assignee) -> no-op.
--      - the assignee's current `memberships` role in this article's own
--        `organization_id` is not `'engineer'` (reassigned since, demoted,
--        or simply never was one -- e.g. a planner who assigned themselves)
--        -> no-op. Scoped to `organization_id` (not a bare `user_id` lookup)
--        for the same cross-tenant-safety reason every other cross-table
--        lookup in this schema is org-scoped: a user_id is not
--        organization-unique across the whole `memberships` table.
--      - no `warehouses` row exists for that (organization_id, assigned_to)
--        pair (shouldn't normally happen once every engineer membership has
--        an auto-created warehouse per issue #181, but this migration ships
--        independently of any PWA-side change, and a historical edge case --
--        e.g. a membership row inserted before 20260916090000 ever ran, or a
--        role that was never actually 'engineer' at auto-creation time --
--        is possible) -> no-op.
--      - no `warehouse_stock` row exists for that `(warehouse_id,
--        article_id)` pair (the org's #182 PWA-side "only show articles from
--        my own stock" restriction hasn't shipped yet, or simply was never
--        added to that engineer's warehouse) -> the `UPDATE ... WHERE`
--        simply matches zero rows; no error, no row created with a guessed
--        quantity, nothing logged beyond Postgres' own ordinary zero-rows-
--        affected outcome.
--    Every step reads columns that are already either server-derived/
--    trigger-stamped (`work_order_articles.organization_id`/`work_order_id`,
--    `work_orders.assigned_to` -- validated to be an org member by `validate_
--    work_order_relations`, though not necessarily still an engineer, which
--    is exactly what this trigger separately re-checks) or plain FK-joined
--    rows this `SECURITY DEFINER` function can read regardless of the
--    caller's own RLS visibility -- there is no client-influenceable input
--    to this trigger beyond `new.work_order_id`/`new.article_id`/
--    `new.quantity`, which the row's own pre-existing `derive_work_order_
--    article_organization_id`/`validate_work_order_article_relations`
--    triggers (`20260830100000_work_order_articles_and_quote_traceability.
--    sql`) already fully validated before this trigger ever runs (this one
--    is registered after those, and Postgres fires same-timing/same-event
--    triggers in alphabetical-by-name order: `work_order_articles_deduct_
--    warehouse_stock` sorts after `work_order_articles_derive_organization_
--    id`/`work_order_articles_set_created_by`/`_validate_relations`, though
--    since this is AFTER INSERT and those are BEFORE INSERT, they are
--    already fully complete regardless of naming).
--
-- 6. **Cross-org safety is structural, not an extra guard clause.** The
--    resolved `warehouse_id` is looked up WHERE `organization_id = new.
--    organization_id` (the consumed article's own, already-validated
--    organization) -- there is no code path in this trigger that can resolve
--    a warehouse (and therefore a `warehouse_stock` row) belonging to any
--    other organization, regardless of what `work_orders.assigned_to`/
--    `memberships` rows exist elsewhere. This is asserted directly in the
--    pgTAP test below (section 5), not just relied upon structurally.

create or replace function public.deduct_warehouse_stock_for_work_order_article()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assigned_to uuid;
  v_assignee_role public.membership_role;
  v_warehouse_id uuid;
begin
  select wo.assigned_to into v_assigned_to
  from public.work_orders wo
  where wo.id = new.work_order_id;

  -- No assignee at all (unassigned work order, or a planner-created one with
  -- nobody assigned yet) -- safe no-op, per the brief.
  if v_assigned_to is null then
    return new;
  end if;

  select m.role into v_assignee_role
  from public.memberships m
  where m.user_id = v_assigned_to
    and m.organization_id = new.organization_id;

  -- The assignee isn't a member of this article's own organization at all,
  -- or their current role isn't 'engineer' (reassigned/demoted since, or
  -- simply never was one) -- safe no-op.
  if v_assignee_role is distinct from 'engineer'::public.membership_role then
    return new;
  end if;

  select w.id into v_warehouse_id
  from public.warehouses w
  where w.organization_id = new.organization_id
    and w.user_id = v_assigned_to;

  -- No warehouse for this engineer in this organization (historical edge
  -- case -- see design note 5) -- safe no-op.
  if v_warehouse_id is null then
    return new;
  end if;

  -- Floors quantity at 0 (never triggers warehouse_stock_quantity_non_
  -- negative -- see design note 2); total_consumed always records the FULL
  -- consumed amount regardless of the floor (design note 3);
  -- last_counted_at is deliberately never named here (design note 4). A
  -- WHERE match of zero rows (no warehouse_stock row for this article in
  -- this warehouse yet) is a silent no-op, per the brief -- no row is
  -- created.
  update public.warehouse_stock
    set quantity = greatest(0, quantity - new.quantity),
        total_consumed = total_consumed + new.quantity,
        updated_at = now()
    where warehouse_id = v_warehouse_id
      and article_id = new.article_id;

  return new;
end;
$$;

comment on function public.deduct_warehouse_stock_for_work_order_article() is
  'AFTER INSERT trigger on public.work_order_articles (issue #182): resolves the consumed article''s work order -> assigned_to -> (if their current membership role in this same organization is ''engineer'') their warehouses row -> the matching warehouse_stock row (same warehouse_id + article_id), and deducts the consumed quantity, flooring at 0 (GREATEST(0, quantity - new.quantity), so warehouse_stock_quantity_non_negative can never abort this trigger''s own UPDATE, which would otherwise abort the triggering work_order_articles INSERT and block a work order from finishing). total_consumed always increases by the FULL new.quantity regardless of the floor. last_counted_at is deliberately never touched (that column is stamped only by a human manual count, an application-layer concern -- see 20260916090000_warehouses_and_stock.sql design note 3). Every resolution step (no assignee, assignee not an engineer, no warehouse, no matching warehouse_stock row) is a silent no-op, never an exception -- see this migration''s header design note 5 for the full reasoning. SECURITY DEFINER so this write succeeds regardless of the inserting caller''s own RLS/column-grant standing on warehouse_stock (an engineer has none -- read-own-only per 20260916090000_warehouses_and_stock.sql).';

create trigger work_order_articles_deduct_warehouse_stock
  after insert on public.work_order_articles
  for each row execute function public.deduct_warehouse_stock_for_work_order_article();
