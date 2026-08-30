"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";

/**
 * "Create Quote from Work Order" (issue #94, "Werkorder invoice create" —
 * confirmed with the product owner this is about creating a QUOTE, not real
 * invoicing; see `supabase/migrations/20260830100000_work_order_articles_and_quote_traceability.sql`'s
 * header for the full context). Kept in its own file rather than folded into
 * `./actions.ts`/`../quotes/actions.ts` — this is a cross-module orchestration
 * (reads `work_orders`/`time_entries`/`work_order_articles`/`clients`/
 * `memberships`/`articles`, writes `quotes`/`quote_line_items`), not plain
 * CRUD on any single module's own table, so it doesn't fit either file's
 * existing "one table + its embeds" shape.
 *
 * **Feature/RBAC gate** — mirrors `attachChecklistTemplate` in
 * `./checklist-actions.ts` (also a Work-Order-sub-resource action that reads
 * a `work_orders` row without a second `requireModuleContext("planning")`
 * call): gated on a single `requireModuleContext("quotes")` (this action's
 * primary output is a Quote), then BOTH of:
 *   - `canAny(actor, "planning", ["read", "read_own"])` — the caller must be
 *     able to view Work Orders at all (reusing `getWorkOrder`'s own gate in
 *     `./actions.ts`, not a new permission tier); and
 *   - `can(actor, "quotes", "create")` — the caller must be able to create
 *     Quotes (reusing `createQuote`'s own gate in `../quotes/actions.ts`).
 * In practice only `owner`/`planner` satisfy the second check at all (Quotes'
 * RBAC row: engineer/finance/administratie are `read`-only), so the first
 * check never actually narrows anything further in today's matrix — kept
 * anyway per the brief's explicit "require both, don't loosen either", and
 * because `work_orders` SELECT RLS still independently re-scopes an engineer
 * to their own assigned row regardless (defense in depth, same reasoning
 * every other module's `can()`-vs-RLS split documents).
 *
 * **Rate resolution precedence** (per the confirmed business rules, not
 * re-litigated here):
 *   1. The work order's own `clients.has_custom_rate = true` → use the
 *      CLIENT's own `travel_article_id`/`travel_sale_price` (Travel entries)
 *      or `work_article_id`/`work_sale_price` (Labor entries).
 *   2. Else, the time entry's `user_id` has an `engineer` membership row with
 *      `has_custom_rate = true` → use THAT membership's equivalent
 *      travel/work article + price.
 *   3. Else → no rate resolvable; the entry is left off the quote and its id
 *      is collected into `skippedTimeEntryIds` for the caller to surface as a
 *      "N entries could not be priced" warning.
 * Both override tables store an EDITABLE sale price directly on the override
 * row itself (not a pointer that needs a second live lookup) — see
 * `20260830090000_engineer_client_rate_overrides.sql`'s own design note 2 —
 * so `unit_price` for a time-entry-derived line item is read straight off
 * whichever override row resolved, never `articles.sale_price`. Consumed
 * articles (`work_order_articles`) are the opposite: no price is stored
 * anywhere on that table by design (see that migration's design note 2), so
 * their `unit_price` is always read live from `articles.sale_price`.
 *
 * **Quantity for a time-entry-derived line item**: hours, computed the exact
 * same way `elapsedMinutes` in `./components/format-work-order-time.ts`
 * computes a duration for display (`Math.round((end - start) / 60000)` whole
 * minutes), converted to a 2-decimal-place hours figure
 * (`quote_line_items.quantity` is `numeric(10,2)`) —
 * `Math.round(totalMinutes / 60 * 100) / 100`. Reusing that exact
 * minute-rounding step (rather than a raw millisecond division) keeps this
 * figure consistent with what the work order's own Hours section already
 * shows the user for the same entry.
 *
 * **Ordering** (`quote_line_items.sort_order`): every time-entry-derived line
 * item (Travel and Work, interleaved) sorted ascending by its source entry's
 * `started_at`, THEN every consumed-article line item, sorted ascending by
 * its source `work_order_articles.created_at` (the order they were logged in
 * — an arbitrary but stable choice per the brief, documented here rather than
 * silently picked).
 *
 * **Which time entries are eligible at all**: Break-type entries are never
 * eligible (not a billable Labor/Travel type — same "fold into Work times but
 * don't invoice it" spirit the Hours section gives Break for display, taken
 * one step further here since a quote line item needs a real price, and
 * Break has no rate-resolution rule at all in the confirmed business rules).
 * A still-running entry (`ended_at: null`) is also never eligible — same
 * "in progress" treatment the Hours section gives it (no computable duration
 * to quantity from yet). Neither of these is counted in `skippedTimeEntryIds`:
 * that field is reserved for the ONE reason the brief actually asks the
 * frontend to warn about ("could not be priced") — a Break entry or a
 * still-running entry was never a pricing candidate in the first place, so
 * folding them into the same warning would misleadingly suggest a pricing
 * gap that isn't one. A rounded-to-zero-hours entry (sub-30-second Travel/
 * Labor, effectively a rounding artifact) is treated the same as
 * "could not be priced" and IS added to `skippedTimeEntryIds` — a
 * zero-quantity quote line item would be meaningless, and unlike Break/
 * running entries this genuinely is "this entry didn't make it onto the
 * quote", which the warning exists to surface.
 *
 * **Consumed articles with no `sale_price` set**: unlike an unresolvable time
 * entry, a consumed article's `article_id` (and therefore its intended
 * pricing target) is always known — it's just possibly unpriced. Rather than
 * silently dropping real "what was consumed" data from the quote the way an
 * unresolvable time entry is dropped, this defaults `unit_price` to `0` and
 * still includes the line item (with `article_id` set for traceability) —
 * visibly wrong-but-present (a 0-priced line the user can see and correct) is
 * a better failure mode here than silently missing.
 *
 * **Quote name**: this codebase has no existing auto-naming precedent for
 * Quotes — `quoteCreateSchema.name` is a plain required, user-typed field on
 * every existing creation path (`../quotes/quote-form-actions.ts`). Generates
 * `"Quote — {work order title}"` here, the exact shape the issue's own brief
 * suggested — the DB fills `status_id` with the org's default (`Draft`) the
 * same way `createQuote` already leaves it omitted.
 *
 * **Partial-failure handling**: this codebase has no existing multi-insert
 * transaction/RPC pattern to reuse — every other multi-step creation flow
 * either is a single trigger-driven round trip (`attachChecklistTemplate`'s
 * template → items snapshot, done entirely in a DB trigger) or is a
 * genuinely independent, sequential, no-rollback pair of Server Action calls
 * left to the frontend (`new-client-panel.tsx`'s client-then-site create).
 * Neither shape fits "one Server Action, two dependent inserts" cleanly, so
 * this introduces a minimal, explicitly-scoped-to-here convention instead:
 * the `quotes` row is inserted first, then every `quote_line_items` row in
 * ONE bulk `.insert([...])` call (a single INSERT statement is atomic in
 * Postgres — either every line item is written, or none are); if that bulk
 * insert fails, the just-created `quotes` row is deleted as a best-effort
 * compensating action (its own failure is swallowed — surfacing the
 * ORIGINAL line-item error is more useful than a secondary cleanup error) so
 * the caller isn't left with an empty, orphaned draft quote instead of a
 * clean failure.
 */

const uuidSchema = z.string().uuid("Invalid work order id.");

/** Minimal shape read off `work_orders` — just enough to build the Quote
 * header and resolve client-level rate overrides. */
interface SourceWorkOrder {
  id: string;
  client_id: string;
  site_id: string | null;
  title: string;
}

/** Minimal shape read off `time_entries`, with its `entry_type_id` resolved
 * to the reference item's `value` (`labor` | `travel` | `break`) in the same
 * round trip — same embed pattern `TIME_ENTRY_SELECT` uses in
 * `./time-entries-actions.ts`. */
interface SourceTimeEntry {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  time_entry_type: { value: string } | null;
}

/** Minimal shape read off `work_order_articles`, with its own article's
 * display fields + live `sale_price` resolved in the same round trip. */
interface SourceWorkOrderArticle {
  id: string;
  article_id: string;
  quantity: number;
  created_at: string;
  article: { article_number: string; description: string; sale_price: number | null } | null;
}

/** A resolved rate override row (either `clients` or `memberships`' shared
 * 5-column shape, per `lib/rate-overrides/schema.ts`), with its own
 * travel/work article display fields embedded for building a line item's
 * `description`. */
interface RateOverrideRow {
  has_custom_rate: boolean;
  travel_article_id: string | null;
  work_article_id: string | null;
  travel_sale_price: number | null;
  work_sale_price: number | null;
  travel_article: { article_number: string; description: string } | null;
  work_article: { article_number: string; description: string } | null;
}

/** A resolved (article_id, unit_price, description) triple for one billable
 * time entry, or `null` when no rate could be resolved (rule 1.c — the
 * caller adds the entry's id to `skippedTimeEntryIds` in that case). */
interface ResolvedRate {
  articleId: string;
  unitPrice: number;
  description: string;
}

function resolveRateFromOverrideRow(row: RateOverrideRow | null, isTravel: boolean): ResolvedRate | null {
  if (!row || !row.has_custom_rate) return null;
  const articleId = isTravel ? row.travel_article_id : row.work_article_id;
  const unitPrice = isTravel ? row.travel_sale_price : row.work_sale_price;
  const article = isTravel ? row.travel_article : row.work_article;
  if (!articleId || unitPrice === null || !article) return null;
  return {
    articleId,
    unitPrice,
    description: `${article.article_number} — ${article.description}`,
  };
}

/** Same whole-minute rounding step `elapsedMinutes` uses for display in
 * `./components/format-work-order-time.ts`, converted to a 2-decimal-place
 * hours figure (`quote_line_items.quantity` is `numeric(10,2)`) — see the
 * module comment above for why this reuses that exact step. Returns `null`
 * when a duration genuinely can't be computed (defensive; `ended_at` is
 * already guaranteed non-null and >= `started_at` by the time this is
 * called, same guard `elapsedMinutes` keeps anyway) or rounds to `0` hours
 * (a sub-30-second entry — treated as unresolvable, see the module comment). */
function computeQuantityHours(startedAt: string, endedAt: string): number | null {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const totalMinutes = Math.round((end - start) / 60000);
  const hours = Math.round((totalMinutes / 60) * 100) / 100;
  return hours > 0 ? hours : null;
}

/** One fully-resolved quote line item, prior to `sort_order` assignment. */
interface DraftLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  articleId: string;
  /** Only set for a time-entry-derived line item (the source time entry's
   * own `user_id`) — written to `quote_line_items.engineer_user_id` (issue
   * #95). `undefined` for a consumed-article-derived line item, which has no
   * associated engineer (`work_order_articles` has no per-row "who consumed
   * this" concept the way a time entry has "who logged this"). */
  engineerUserId?: string;
  /** Only set for a time-entry-derived line item — used purely to sort
   * ascending by `started_at` before `sort_order` is assigned; not written to
   * the DB. */
  sourceStartedAt?: string;
}

export interface CreateQuoteFromWorkOrderResult {
  quoteId: string;
  /** Ids of `time_entries` rows that were left off the quote because no rate
   * could be resolved for them (rule 1.c) — surface as a "N time entries
   * could not be priced and were left off this quote" warning. Does NOT
   * include Break-type or still-running entries, which were never pricing
   * candidates in the first place — see the module comment above. */
  skippedTimeEntryIds: string[];
}

/**
 * Creates a brand-new Quote (header + line items) from a Work Order's logged
 * time and consumed articles. Always creates a NEW quote — never updates an
 * existing one tied to the same work order (a work order may legitimately
 * spawn more than one quote over time; see the module comment above and the
 * confirmed business rules — no dedupe attempted here).
 */
export async function createQuoteFromWorkOrder(
  workOrderId: string,
): Promise<ActionResult<CreateQuoteFromWorkOrderResult>> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail(idResult.error.issues[0]?.message ?? "Invalid work order id.");

  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;

  if (!canAny(actor, "planning", ["read", "read_own"])) {
    return fail("You do not have permission to view this work order.");
  }
  if (!can(actor, "quotes", "create")) {
    return fail("Only an owner or planner can create quotes.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: workOrder, error: workOrderError } = await supabase
    .from("work_orders")
    .select("id, client_id, site_id, title")
    .eq("id", idResult.data)
    .maybeSingle<SourceWorkOrder>();
  if (workOrderError) return fail(mapDbError(workOrderError));
  if (!workOrder) return fail("Work order not found, or you do not have permission to view it.");

  const [timeEntriesResult, workOrderArticlesResult, clientRateResult] = await Promise.all([
    supabase
      .from("time_entries")
      .select("id, user_id, started_at, ended_at, time_entry_type:reference_list_items!time_entries_entry_type_id_fkey(value)")
      .eq("work_order_id", workOrder.id)
      .order("started_at", { ascending: true }),
    supabase
      .from("work_order_articles")
      .select(
        "id, article_id, quantity, created_at, article:articles!work_order_articles_article_id_fkey(article_number, description, sale_price)",
      )
      .eq("work_order_id", workOrder.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("clients")
      .select(
        "has_custom_rate, travel_article_id, work_article_id, travel_sale_price, work_sale_price, travel_article:articles!clients_travel_article_id_fkey(article_number, description), work_article:articles!clients_work_article_id_fkey(article_number, description)",
      )
      .eq("id", workOrder.client_id)
      .maybeSingle<RateOverrideRow>(),
  ]);

  if (timeEntriesResult.error) return fail(mapDbError(timeEntriesResult.error));
  if (workOrderArticlesResult.error) return fail(mapDbError(workOrderArticlesResult.error));
  if (clientRateResult.error) return fail(mapDbError(clientRateResult.error));

  const allTimeEntries = (timeEntriesResult.data ?? []) as unknown as SourceTimeEntry[];
  const workOrderArticles = (workOrderArticlesResult.data ?? []) as unknown as SourceWorkOrderArticle[];
  const clientRate = clientRateResult.data;

  // Eligible = Labor or Travel type, AND already finished (`ended_at` set) —
  // see the module comment above for why Break/still-running entries are
  // excluded before rate resolution even starts (and never counted in
  // `skippedTimeEntryIds`).
  const eligibleTimeEntries = allTimeEntries.filter(
    (entry) =>
      entry.ended_at !== null &&
      (entry.time_entry_type?.value === "labor" || entry.time_entry_type?.value === "travel"),
  );

  // Engineer rate overrides are only ever consulted when the client itself
  // has no custom rate (rule precedence 1.a before 1.b) — skip the query
  // entirely in the common "client has a custom rate" case.
  let membershipByUserId = new Map<string, RateOverrideRow>();
  if (!clientRate?.has_custom_rate) {
    const distinctUserIds = Array.from(new Set(eligibleTimeEntries.map((entry) => entry.user_id)));
    if (distinctUserIds.length > 0) {
      const { data: memberships, error: membershipsError } = await supabase
        .from("memberships")
        .select(
          "user_id, has_custom_rate, travel_article_id, work_article_id, travel_sale_price, work_sale_price, travel_article:articles!memberships_travel_article_id_fkey(article_number, description), work_article:articles!memberships_work_article_id_fkey(article_number, description)",
        )
        .eq("organization_id", organizationId)
        .eq("role", "engineer")
        .in("user_id", distinctUserIds);
      if (membershipsError) return fail(mapDbError(membershipsError));
      membershipByUserId = new Map(
        ((memberships ?? []) as unknown as (RateOverrideRow & { user_id: string })[]).map((row) => [
          row.user_id,
          row,
        ]),
      );
    }
  }

  const skippedTimeEntryIds: string[] = [];
  const timeEntryLineItems: DraftLineItem[] = [];

  for (const entry of eligibleTimeEntries) {
    const isTravel = entry.time_entry_type?.value === "travel";
    const resolved =
      resolveRateFromOverrideRow(clientRate ?? null, isTravel) ??
      resolveRateFromOverrideRow(membershipByUserId.get(entry.user_id) ?? null, isTravel);

    if (!resolved) {
      skippedTimeEntryIds.push(entry.id);
      continue;
    }

    const quantity = computeQuantityHours(entry.started_at, entry.ended_at as string);
    if (quantity === null) {
      // Rounds to 0 hours (or a defensive guard tripped) — see the module
      // comment above for why this is treated the same as "could not be
      // priced" rather than inserted as a meaningless zero-quantity line.
      skippedTimeEntryIds.push(entry.id);
      continue;
    }

    timeEntryLineItems.push({
      description: resolved.description,
      quantity,
      unitPrice: resolved.unitPrice,
      articleId: resolved.articleId,
      engineerUserId: entry.user_id,
      sourceStartedAt: entry.started_at,
    });
  }

  // Already fetched in `started_at` ascending order, but re-sort explicitly
  // here rather than relying on that — this is the actual ordering
  // contract (rule 3), not an incidental side effect of the query's own
  // `order()`.
  timeEntryLineItems.sort((a, b) => (a.sourceStartedAt ?? "").localeCompare(b.sourceStartedAt ?? ""));

  // Consumed articles: always included (see the module comment above for why
  // a missing `sale_price` defaults to 0 instead of being skipped), already
  // fetched in `created_at` ascending order.
  const articleLineItems: DraftLineItem[] = workOrderArticles.map((row) => ({
    description: row.article
      ? `${row.article.article_number} — ${row.article.description}`
      : "Consumed article",
    quantity: Math.round(Number(row.quantity) * 100) / 100,
    unitPrice: row.article?.sale_price ?? 0,
    articleId: row.article_id,
  }));

  const orderedLineItems = [...timeEntryLineItems, ...articleLineItems];

  const quoteName = `Quote — ${workOrder.title}`;

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      client_id: workOrder.client_id,
      site_id: workOrder.site_id,
      work_order_id: workOrder.id,
      name: quoteName,
    })
    .select("id")
    .single();

  if (quoteError) return fail(mapDbError(quoteError));
  const quoteId = (quote as { id: string }).id;

  if (orderedLineItems.length > 0) {
    const { error: lineItemsError } = await supabase.from("quote_line_items").insert(
      orderedLineItems.map((item, index) => ({
        quote_id: quoteId,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        article_id: item.articleId,
        // engineer_user_id (issue #95): set from the source time entry's
        // user_id for a Travel/Labor-derived line item; omitted (-> null)
        // for a consumed-article-derived line item, which has no engineer —
        // see DraftLineItem.engineerUserId's own comment.
        engineer_user_id: item.engineerUserId ?? null,
        sort_order: index,
      })),
    );

    if (lineItemsError) {
      // Best-effort compensating cleanup — see the module comment above for
      // why this codebase has no transaction/RPC pattern to reach for
      // instead. Its own failure is swallowed on purpose: the original
      // `lineItemsError` is the useful one to surface.
      await supabase.from("quotes").delete().eq("id", quoteId);
      return fail(mapDbError(lineItemsError));
    }
  }

  return ok({ quoteId, skippedTimeEntryIds });
}
