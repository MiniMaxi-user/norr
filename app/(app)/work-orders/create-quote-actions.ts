"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { findAutoDraftQuoteId, computeUnresolvedTimeEntryIds } from "@/lib/quotes/auto-draft";

/**
 * "Create Quote from Work Order" (issue #94, originally; issue #109 changed
 * this from an always-create-new action into a PROMOTE-the-existing-
 * auto-draft action — see `supabase/migrations/20260901090000_work_order_auto_draft_quotes.sql`
 * for the schema/trigger side of this: every work order created since that
 * migration already has exactly one `is_auto_draft = true` `quotes` row,
 * auto-created by `work_orders_create_auto_draft_quote` and kept in sync with
 * `time_entries`/`work_order_articles` by a set of DB triggers — this file no
 * longer needs to do any of that sync work itself).
 *
 * **New behavior (issue #109 acceptance criterion 6):** clicking "Create
 * Quote" now looks for that work order's `is_auto_draft = true` quote first.
 *   - Found (the normal case for every work order created after the
 *     migration): PROMOTE it — a single `UPDATE quotes SET is_auto_draft =
 *     false WHERE id = ... AND is_auto_draft = true`, nothing else. The
 *     frozen `quote_line_items` already sitting on that quote (written
 *     incrementally by the sync triggers as time was logged/articles were
 *     consumed) are correct as-is and are NOT recomputed, re-priced, or
 *     touched in any way here — recomputing them would silently overwrite
 *     the whole point of issue #109 (freezing a rate at time-of-registration,
 *     not at click-Create-Quote time). See `promoteAutoDraftQuote` below.
 *   - Not found: falls back to the ORIGINAL from-scratch behavior (build a
 *     brand-new quote + line items from the work order's current
 *     `time_entries`/`work_order_articles`, resolving rates live). Two real
 *     cases hit this path:
 *     1. A legacy work order created BEFORE the issue #109 migration shipped
 *        — it never got an auto-draft (no backfill, by that migration's own
 *        explicit design) and never will.
 *     2. An intentional RE-QUOTE: the work order's original auto-draft was
 *        already promoted once (`is_auto_draft` is now permanently `false`
 *        for that row — sync stops forever on promotion, per the migration),
 *        and the user clicks "Create Quote" again wanting a SECOND,
 *        independent quote off the work order's current state. This mirrors
 *        this action's own pre-#109 behavior exactly (a work order may
 *        legitimately spawn more than one quote over time; see below) — kept
 *        deliberately unrestricted here (no "only once" guard), since
 *        limiting it would be new, unrequested scope.
 *     See `createBrandNewQuoteFromWorkOrder` below — its rate resolution now
 *     reuses the shared `resolve_billing_rate` SQL function (issue #109) that
 *     the sync triggers themselves call, upgraded from this action's OLD
 *     app-layer 2-layer precedence (client override -> engineer override ->
 *     unresolved) to the SAME 4-layer precedence the auto-draft has used
 *     since the migration (client override -> engineer override -> org
 *     default -> unresolved). Leaving this fallback on the old 2-layer logic
 *     would have made "Create Quote" resolve rates differently depending on
 *     which of these two paths happened to run, which is exactly the kind of
 *     silent inconsistency issue #109 exists to eliminate — see
 *     `resolveBillingRatesForEntries` below.
 *
 * The public return shape (`CreateQuoteFromWorkOrderResult`, `{ quoteId,
 * skippedTimeEntryIds }`) is UNCHANGED from before issue #109 — the caller
 * (`app/(app)/work-orders/[id]/work-order-detail-actions.tsx`) needs no
 * changes at all. For the promotion path, `skippedTimeEntryIds` no longer
 * comes from a resolution loop run at click time — it's now a straight query
 * (`computeUnresolvedTimeEntryIds`, `lib/quotes/auto-draft.ts`) over the
 * ALREADY-resolved-at-sync-time `quote_line_items`, per issue #109's own
 * instruction that this become "queryable" rather than recomputed.
 *
 * **Feature/RBAC gate** — unchanged from before issue #109: gated on
 * `requireModuleContext("quotes")`, then BOTH
 * `canAny(actor, "planning", ["read", "read_own"])` (can view Work Orders at
 * all) and `can(actor, "quotes", "create")` (can create Quotes) — see the
 * original design note this file has always carried: in today's matrix only
 * owner/planner satisfy the second check at all, so the first never actually
 * narrows anything further, kept anyway per "require both, don't loosen
 * either", with `work_orders` SELECT RLS independently re-scoping an engineer
 * to their own assigned row regardless.
 */

const uuidSchema = z.string().uuid("Invalid work order id.");

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Minimal shape read off `work_orders` — just enough to build a brand-new
 * Quote header and resolve rates for its line items (the fallback path
 * only — the promotion path never needs this). */
interface SourceWorkOrder {
  id: string;
  client_id: string;
  site_id: string | null;
  title: string;
}

/** Minimal shape read off `time_entries` for the fallback path, with its
 * `entry_type_id` resolved to the reference item's `value`
 * (`labor` | `travel` | `break`) in the same round trip. */
interface SourceTimeEntry {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  time_entry_type: { value: string } | null;
}

/** Minimal shape read off `work_order_articles` for the fallback path, with
 * its own article's display fields + live `sale_price` resolved in the same
 * round trip. */
interface SourceWorkOrderArticle {
  id: string;
  article_id: string;
  quantity: number;
  created_at: string;
  article: { article_number: string; description: string; sale_price: number | null } | null;
}

/** Row shape returned by the `resolve_billing_rate` SQL function (issue
 * #109, `supabase/migrations/20260901090000_work_order_auto_draft_quotes.sql`)
 * — zero rows means unresolved (layer 4). */
interface ResolvedBillingRate {
  resolved_article_id: string;
  resolved_sale_price: number | null;
  resolved_purchase_price: number | null;
}

/** Same whole-minute rounding step `elapsedMinutes` uses for display in
 * `./components/format-work-order-time.ts`, converted to a 2-decimal-place
 * hours figure (`quote_line_items.quantity` is `numeric(10,2)`) — kept
 * IDENTICAL to `sync_time_entry_to_auto_draft_quote`'s own rounding (see that
 * function's comment in the issue #109 migration) so a quantity never
 * differs between this fallback path and the always-on sync path. Returns
 * `null` when a duration genuinely can't be computed (defensive; `ended_at`
 * is already guaranteed non-null and >= `started_at` by the time this is
 * called) or rounds to `0` hours (a sub-30-second entry — treated as
 * unresolvable, same as the sync trigger). */
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
   * #95). `undefined` for a consumed-article-derived line item. */
  engineerUserId?: string;
  /** Only set for a time-entry-derived line item — used purely to sort
   * ascending by `started_at` before `sort_order` is assigned; not written to
   * the DB. */
  sourceStartedAt?: string;
}

export interface CreateQuoteFromWorkOrderResult {
  quoteId: string;
  /** Ids of `time_entries` rows left off the quote because no rate could be
   * resolved for them — surfaced as a "N time entries could not be priced"
   * warning by the caller. Does NOT include Break-type or still-running
   * entries, which were never pricing candidates in the first place. */
  skippedTimeEntryIds: string[];
}

/**
 * Promotes an existing `is_auto_draft = true` quote: flips the flag to
 * `false` and returns its id, alongside the set of eligible time entries that
 * never got a line item synced (queried, not recomputed — see the module
 * comment above). Computed BEFORE the flag flips, against the quote's OWN id
 * (not re-derived via `is_auto_draft = true`) — see
 * `computeUnresolvedTimeEntryIds`'s own comment in `lib/quotes/auto-draft.ts`
 * for why that ordering independence matters.
 *
 * The `.eq("is_auto_draft", true)` on the UPDATE (in addition to `.eq("id",
 * ...)`) is a defensive no-op guard against a concurrent double-click/second
 * tab already promoting the same quote between this function's read and
 * write — `quotes_update_owner_or_planner` RLS would otherwise silently
 * allow a second no-op UPDATE to "succeed" (it's already `false`, setting it
 * to `false` again is a valid write), which would let both requests report
 * success. Filtering on the OLD value means the second one matches zero rows
 * instead, and is told plainly that someone else already did it.
 */
async function promoteAutoDraftQuote(
  supabase: SupabaseServerClient,
  workOrderId: string,
  quoteId: string,
): Promise<ActionResult<CreateQuoteFromWorkOrderResult>> {
  const { data: skippedTimeEntryIds, error: unresolvedError } = await computeUnresolvedTimeEntryIds(
    supabase,
    workOrderId,
    quoteId,
  );
  if (unresolvedError) return fail(mapDbError(unresolvedError));

  const { data, error } = await supabase
    .from("quotes")
    .update({ is_auto_draft: false })
    .eq("id", quoteId)
    .eq("is_auto_draft", true)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) return fail(mapDbError(error));
  if (!data) {
    return fail("This work order's quote was already created or promoted. Refresh the page and try again.");
  }

  return ok({ quoteId: data.id, skippedTimeEntryIds });
}

/**
 * Resolves a billing rate per (engineer, Travel-vs-Labor) combination present
 * among `entries`, via the shared `resolve_billing_rate` SQL function (issue
 * #109) — the SAME 4-layer precedence (client override -> engineer override
 * -> org default -> unresolved) the auto-draft's own sync triggers use.
 * Batched by DISTINCT (`user_id`, `isTravel`) pair rather than once per time
 * entry — a work order typically has very few distinct engineers, so this is
 * a handful of round trips at most, not one per logged time entry.
 */
async function resolveBillingRatesForEntries(
  supabase: SupabaseServerClient,
  organizationId: string,
  clientId: string,
  entries: readonly SourceTimeEntry[],
): Promise<{ ratesByKey: Map<string, ResolvedBillingRate | null>; error: { code?: string; message: string } | null }> {
  const distinctKeys = new Map<string, { userId: string; isTravel: boolean }>();
  for (const entry of entries) {
    const isTravel = entry.time_entry_type?.value === "travel";
    distinctKeys.set(`${entry.user_id}:${isTravel}`, { userId: entry.user_id, isTravel });
  }

  const ratesByKey = new Map<string, ResolvedBillingRate | null>();
  const results = await Promise.all(
    Array.from(distinctKeys.entries()).map(async ([key, { userId, isTravel }]) => {
      const { data, error } = await supabase
        .rpc("resolve_billing_rate", {
          p_organization_id: organizationId,
          p_client_id: clientId,
          p_user_id: userId,
          p_is_travel: isTravel,
        })
        .maybeSingle<ResolvedBillingRate>();
      return { key, data: data ?? null, error };
    }),
  );

  for (const result of results) {
    if (result.error) return { ratesByKey, error: result.error };
    ratesByKey.set(result.key, result.data);
  }
  return { ratesByKey, error: null };
}

/**
 * Original (pre-#109) "always creates a brand-new quote" behavior — see the
 * module comment above for the two cases that still reach this path (a
 * pre-migration legacy work order, or an intentional re-quote after the
 * first auto-draft was already promoted). Builds a Quote header + line items
 * from the work order's CURRENT `time_entries`/`work_order_articles`, same
 * shape/ordering/skip rules as before #109, with rate resolution upgraded to
 * the shared 4-layer `resolve_billing_rate` function (see
 * `resolveBillingRatesForEntries` above) instead of this file's own
 * previously-hand-rolled 2-layer (client/engineer-only) lookup.
 *
 * `quote_line_items.purchase_price` (issue #109's new stored snapshot column)
 * is deliberately left unset here, same as every column already excluded
 * from this INSERT before #109 — it's withheld from the `quote_line_items`
 * INSERT column grant entirely (only the SECURITY DEFINER sync triggers may
 * write it), so this app-layer INSERT could not set it even if it wanted to.
 */
async function createBrandNewQuoteFromWorkOrder(
  supabase: SupabaseServerClient,
  organizationId: string,
  workOrder: SourceWorkOrder,
): Promise<ActionResult<CreateQuoteFromWorkOrderResult>> {
  const [timeEntriesResult, workOrderArticlesResult] = await Promise.all([
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
  ]);

  if (timeEntriesResult.error) return fail(mapDbError(timeEntriesResult.error));
  if (workOrderArticlesResult.error) return fail(mapDbError(workOrderArticlesResult.error));

  const allTimeEntries = (timeEntriesResult.data ?? []) as unknown as SourceTimeEntry[];
  const workOrderArticles = (workOrderArticlesResult.data ?? []) as unknown as SourceWorkOrderArticle[];

  // Eligible = Labor or Travel type, AND already finished (`ended_at` set) —
  // Break/still-running entries are excluded before rate resolution even
  // starts, and never counted in `skippedTimeEntryIds` (same rule the sync
  // triggers apply).
  const eligibleTimeEntries = allTimeEntries.filter(
    (entry) =>
      entry.ended_at !== null &&
      (entry.time_entry_type?.value === "labor" || entry.time_entry_type?.value === "travel"),
  );

  const { ratesByKey, error: rateError } = await resolveBillingRatesForEntries(
    supabase,
    organizationId,
    workOrder.client_id,
    eligibleTimeEntries,
  );
  if (rateError) return fail(mapDbError(rateError));

  // Distinct resolved article ids -> a single batched articles lookup for
  // display fields (article_number/description), instead of N+1-ing one
  // lookup per line item.
  const distinctArticleIds = Array.from(
    new Set(
      Array.from(ratesByKey.values())
        .filter((rate): rate is ResolvedBillingRate => rate !== null)
        .map((rate) => rate.resolved_article_id),
    ),
  );
  let articleDisplayById = new Map<string, { article_number: string; description: string }>();
  if (distinctArticleIds.length > 0) {
    const { data: articles, error: articlesError } = await supabase
      .from("articles")
      .select("id, article_number, description")
      .in("id", distinctArticleIds);
    if (articlesError) return fail(mapDbError(articlesError));
    articleDisplayById = new Map(
      ((articles ?? []) as { id: string; article_number: string; description: string }[]).map((row) => [
        row.id,
        { article_number: row.article_number, description: row.description },
      ]),
    );
  }

  const skippedTimeEntryIds: string[] = [];
  const timeEntryLineItems: DraftLineItem[] = [];

  for (const entry of eligibleTimeEntries) {
    const isTravel = entry.time_entry_type?.value === "travel";
    const resolved = ratesByKey.get(`${entry.user_id}:${isTravel}`) ?? null;

    if (!resolved) {
      skippedTimeEntryIds.push(entry.id);
      continue;
    }

    const quantity = computeQuantityHours(entry.started_at, entry.ended_at as string);
    if (quantity === null) {
      // Rounds to 0 hours (or a defensive guard tripped) — treated the same
      // as "could not be priced" rather than inserted as a meaningless
      // zero-quantity line, same rule as before #109.
      skippedTimeEntryIds.push(entry.id);
      continue;
    }

    const articleDisplay = articleDisplayById.get(resolved.resolved_article_id);
    const description = articleDisplay
      ? `${articleDisplay.article_number} — ${articleDisplay.description}`
      : "Time entry";

    timeEntryLineItems.push({
      description,
      quantity,
      unitPrice: resolved.resolved_sale_price ?? 0,
      articleId: resolved.resolved_article_id,
      engineerUserId: entry.user_id,
      sourceStartedAt: entry.started_at,
    });
  }

  // Already fetched in `started_at` ascending order, but re-sort explicitly
  // here rather than relying on that — this is the actual ordering
  // contract, not an incidental side effect of the query's own `order()`.
  timeEntryLineItems.sort((a, b) => (a.sourceStartedAt ?? "").localeCompare(b.sourceStartedAt ?? ""));

  // Consumed articles: always included (a missing `sale_price` defaults to 0
  // instead of being skipped — visibly-wrong-but-present beats silently
  // missing), already fetched in `created_at` ascending order.
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
        engineer_user_id: item.engineerUserId ?? null,
        sort_order: index,
      })),
    );

    if (lineItemsError) {
      // Best-effort compensating cleanup, same as before #109: the just-
      // created `quotes` row is deleted so the caller isn't left with an
      // empty, orphaned draft quote instead of a clean failure. Its own
      // failure is swallowed — the ORIGINAL line-item error is the useful
      // one to surface.
      await supabase.from("quotes").delete().eq("id", quoteId);
      return fail(mapDbError(lineItemsError));
    }
  }

  return ok({ quoteId, skippedTimeEntryIds });
}

/**
 * "Create Quote" entry point. Promotes the work order's existing
 * `is_auto_draft = true` quote when one exists; otherwise falls back to
 * creating a brand-new quote from scratch. See the module comment above for
 * the full design.
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

  const { data: autoDraftQuoteId, error: autoDraftError } = await findAutoDraftQuoteId(supabase, workOrder.id);
  if (autoDraftError) return fail(mapDbError(autoDraftError));

  if (autoDraftQuoteId) {
    return promoteAutoDraftQuote(supabase, workOrder.id, autoDraftQuoteId);
  }

  return createBrandNewQuoteFromWorkOrder(supabase, organizationId, workOrder);
}
