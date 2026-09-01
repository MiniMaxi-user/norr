"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { findAutoDraftQuoteId, computeUnresolvedTimeEntryIds } from "@/lib/quotes/auto-draft";

/**
 * Read-only queries over a work order's `is_auto_draft = true` quote (issue
 * #109) — deliberately separate from `./create-quote-actions.ts`, which owns
 * the one MUTATING action in this area ("Create Quote" / promotion). These
 * two queries have no side effects and are meant to be called on every Work
 * Order page load (unlike "Create Quote", which only runs on a button click),
 * so they're kept in their own file rather than folded into that one — same
 * "one file per concern" split this module already uses for
 * `./time-entries-actions.ts` / `./work-order-articles-actions.ts` /
 * `./checklist-actions.ts`.
 *
 * Both share their core lookups (`findAutoDraftQuoteId`,
 * `computeUnresolvedTimeEntryIds`) with `./create-quote-actions.ts` via
 * `lib/quotes/auto-draft.ts` — see that module's header for why.
 *
 * Left for `frontend-ui-engineer` (not built here): the actual "N entries
 * missing rate" banner and the Hours-section/"To invoice" KPI tile UI that
 * consume these two queries.
 */

const uuidSchema = z.string().uuid("Invalid work order id.");

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Confirms `workOrderId` exists and is visible to the caller (RLS-scoped —
 * an engineer's `read_own` access on `planning` only sees their own assigned
 * rows) before either query below touches `quotes`/`quote_line_items` keyed
 * off it. Same defense-in-depth shape `createQuoteFromWorkOrder` already
 * uses in `./create-quote-actions.ts`.
 */
async function loadVisibleWorkOrderId(
  supabase: SupabaseServerClient,
  workOrderId: string,
): Promise<{ data: string | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await supabase
    .from("work_orders")
    .select("id")
    .eq("id", workOrderId)
    .maybeSingle<{ id: string }>();
  return { data: data?.id ?? null, error };
}

export interface UnresolvedWorkOrderTimeEntriesResult {
  /** `null` when the work order has no active auto-draft — either it
   * predates issue #109 (no backfill), or its auto-draft was already
   * promoted (sync stops permanently on promotion). In either case there is
   * nothing left to flag: `unresolvedTimeEntryIds` is always `[]` alongside a
   * `null` here. */
  autoDraftQuoteId: string | null;
  /** Ids of billable (Labor/Travel, already-finished) `time_entries` on this
   * work order with no matching `quote_line_items` row on the auto-draft —
   * i.e. entries the sync trigger could not resolve a billing rate for.
   * Powers the "N entries missing rate" warning (issue #109 acceptance
   * criterion 7's read side). */
  unresolvedTimeEntryIds: string[];
}

/**
 * Given a work order id, returns which of its billable time entries are
 * missing a resolved rate on the auto-draft quote right now. See the module
 * comment above and `computeUnresolvedTimeEntryIds` (`lib/quotes/auto-draft.ts`)
 * for the full "queryable, not recomputed" design.
 */
export async function getUnresolvedWorkOrderTimeEntries(
  workOrderId: string,
): Promise<ActionResult<UnresolvedWorkOrderTimeEntriesResult>> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail(idResult.error.issues[0]?.message ?? "Invalid work order id.");

  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);
  const { actor } = ctx.context;

  // Deliberately `can(actor, "planning", "read")` (owner/planner/finance/
  // administratie — the UNSCOPED read action), NOT
  // `canAny(actor, "planning", ["read", "read_own"])` the way
  // `createQuoteFromWorkOrder` gates in `./create-quote-actions.ts`. That
  // function gets away with the looser `read_own`-inclusive check because
  // its SECOND gate (`can(actor, "quotes", "create")`) already excludes
  // engineer entirely before any `time_entries` query runs. These two
  // queries have no such second gate (`quotes` `read` is granted to every
  // role) — and `time_entries_select_scoped` RLS
  // (`20260823180000_time_entries_core.sql`) restricts an ENGINEER caller to
  // only `user_id = auth.uid()` rows, while every other role sees the whole
  // organization's. Both queries below need to see every engineer's time
  // entries on this work order to be accurate (an "unresolved" count that
  // silently excludes a colleague's entries is misleading; a cost-summary
  // bucket that can't even tell Travel from Labor for a colleague's synced
  // line item — since the embedded `time_entries` row would come back `null`
  // under RLS — would be actively wrong, not just incomplete). Restricting
  // to the unscoped `read` action keeps every caller of these two queries
  // one whose `time_entries` visibility is already whole-organization, so
  // there is no silent under/mis-reporting for a shared, multi-engineer work
  // order. Net effect: an engineer gets `false` here (same "you do not have
  // permission" shape every other gate in this codebase uses) — flagged for
  // `frontend-ui-engineer`, who should treat that failure as "hide this
  // widget for this role" rather than an error state.
  if (!can(actor, "planning", "read")) {
    return fail("You do not have permission to view this work order.");
  }
  if (!canAny(actor, "quotes", ["read"])) {
    return fail("You do not have permission to view this work order's quote.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: visibleWorkOrderId, error: workOrderError } = await loadVisibleWorkOrderId(supabase, idResult.data);
  if (workOrderError) return fail(mapDbError(workOrderError));
  if (!visibleWorkOrderId) return fail("Work order not found, or you do not have permission to view it.");

  const { data: autoDraftQuoteId, error: autoDraftError } = await findAutoDraftQuoteId(supabase, visibleWorkOrderId);
  if (autoDraftError) return fail(mapDbError(autoDraftError));

  if (!autoDraftQuoteId) {
    return ok({ autoDraftQuoteId: null, unresolvedTimeEntryIds: [] });
  }

  const { data: unresolvedTimeEntryIds, error: unresolvedError } = await computeUnresolvedTimeEntryIds(
    supabase,
    visibleWorkOrderId,
    autoDraftQuoteId,
  );
  if (unresolvedError) return fail(mapDbError(unresolvedError));

  return ok({ autoDraftQuoteId, unresolvedTimeEntryIds });
}

/** Raw shape of a `quote_line_items` row as read for the cost summary —
 * `source_time_entry`'s embedded `entry_type.value` is what buckets a
 * time-entry-derived line item into `travelTotal` vs `laborTotal` (a line
 * item itself has no Travel/Labor flag of its own). */
interface CostSummaryLineItemRow {
  quantity: number | string;
  unit_price: number | string;
  discount_percent: number | string;
  source_time_entry_id: string | null;
  source_work_order_article_id: string | null;
  source_time_entry: { entry_type: { value: string } | null } | null;
}

export interface WorkOrderCostSummary {
  /** `null` when this work order currently has no `is_auto_draft = true`
   * quote — see `hasPromotedQuote` for how to tell WHY (never created vs.
   * already promoted) so the UI can decide between showing "$0" and pointing
   * at the promoted quote instead. */
  autoDraftQuoteId: string | null;
  /** `true` when no auto-draft exists BUT at least one `is_auto_draft =
   * false` quote is still linked to this work order (`work_order_id`) — i.e.
   * the original auto-draft was promoted already. Every total below is `0`
   * in that case (this summary only ever reads the auto-draft's OWN frozen
   * line items, never a promoted quote's) — `frontend-ui-engineer` can use
   * this flag to link to the promoted quote instead of showing a
   * misleading-looking "$0 to invoice". */
  hasPromotedQuote: boolean;
  travelTotal: number;
  travelLineItemCount: number;
  laborTotal: number;
  laborLineItemCount: number;
  materialTotal: number;
  materialLineItemCount: number;
  /** Line items on the auto-draft with neither `source_time_entry_id` nor
   * `source_work_order_article_id` set — i.e. added directly by an
   * owner/planner via the ordinary quote-line-item actions rather than by a
   * sync trigger (the auto-draft is an ordinary `quotes` row in every other
   * respect, so this is possible even before promotion). Kept as its own
   * bucket rather than silently dropped or lumped into material, so
   * `grandTotal` always ties out to the auto-draft's real total. */
  otherTotal: number;
  otherLineItemCount: number;
  grandTotal: number;
}

const ZERO_COST_SUMMARY: Omit<WorkOrderCostSummary, "autoDraftQuoteId" | "hasPromotedQuote"> = {
  travelTotal: 0,
  travelLineItemCount: 0,
  laborTotal: 0,
  laborLineItemCount: 0,
  materialTotal: 0,
  materialLineItemCount: 0,
  otherTotal: 0,
  otherLineItemCount: 0,
  grandTotal: 0,
};

/** `quantity * unit_price * (1 - discount_percent / 100)`, rounded to 2
 * decimal places — identical formula to `computeTotal` in
 * `app/(app)/quotes/actions.ts` (kept as its own small copy rather than a
 * cross-module import, same "small enough to duplicate" precedent
 * `validateClientRateOverrideArticle`'s own comment documents elsewhere in
 * this codebase). */
function lineItemTotal(row: CostSummaryLineItemRow): number {
  const discountFactor = 1 - Number(row.discount_percent) / 100;
  return Number(row.quantity) * Number(row.unit_price) * discountFactor;
}

/**
 * Returns the frozen cost breakdown for a work order's auto-draft quote —
 * split by source type (Travel time entries, Labor time entries, consumed
 * `work_order_articles`, plus an `other` bucket for any manually-added line
 * item) — for `frontend-ui-engineer` to replace the current material-only
 * client-side computation in `./components/work-order-screen.tsx` (Hours
 * section per-bucket costs, "To invoice" KPI tile) with a read of these
 * already-resolved, historically-accurate totals instead of re-deriving them
 * from `work_order_articles` alone.
 */
export async function getWorkOrderCostSummary(
  workOrderId: string,
): Promise<ActionResult<WorkOrderCostSummary>> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail(idResult.error.issues[0]?.message ?? "Invalid work order id.");

  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);
  const { actor } = ctx.context;

  // `can(actor, "planning", "read")`, not the looser `read_own`-inclusive
  // check — see `getUnresolvedWorkOrderTimeEntries`'s own comment above for
  // why (this query's Travel-vs-Labor bucketing embeds `time_entries`, whose
  // RLS restricts an engineer caller to only their own rows — an engineer
  // would see a colleague's synced line item's embed come back `null` and
  // get silently mis-bucketed).
  if (!can(actor, "planning", "read")) {
    return fail("You do not have permission to view this work order.");
  }
  if (!canAny(actor, "quotes", ["read"])) {
    return fail("You do not have permission to view this work order's quote.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: visibleWorkOrderId, error: workOrderError } = await loadVisibleWorkOrderId(supabase, idResult.data);
  if (workOrderError) return fail(mapDbError(workOrderError));
  if (!visibleWorkOrderId) return fail("Work order not found, or you do not have permission to view it.");

  const { data: autoDraftQuoteId, error: autoDraftError } = await findAutoDraftQuoteId(supabase, visibleWorkOrderId);
  if (autoDraftError) return fail(mapDbError(autoDraftError));

  if (!autoDraftQuoteId) {
    const { data: promotedQuote, error: promotedError } = await supabase
      .from("quotes")
      .select("id")
      .eq("work_order_id", visibleWorkOrderId)
      .eq("is_auto_draft", false)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (promotedError) return fail(mapDbError(promotedError));

    return ok({ autoDraftQuoteId: null, hasPromotedQuote: Boolean(promotedQuote), ...ZERO_COST_SUMMARY });
  }

  const { data: lineItems, error: lineItemsError } = await supabase
    .from("quote_line_items")
    .select(
      "quantity, unit_price, discount_percent, source_time_entry_id, source_work_order_article_id, source_time_entry:time_entries!quote_line_items_source_time_entry_id_fkey(entry_type:reference_list_items!time_entries_entry_type_id_fkey(value))",
    )
    .eq("quote_id", autoDraftQuoteId);

  if (lineItemsError) return fail(mapDbError(lineItemsError));

  const summary: WorkOrderCostSummary = {
    autoDraftQuoteId,
    hasPromotedQuote: false,
    ...ZERO_COST_SUMMARY,
  };

  for (const row of (lineItems ?? []) as unknown as CostSummaryLineItemRow[]) {
    const total = lineItemTotal(row);
    summary.grandTotal += total;

    if (row.source_time_entry_id) {
      const entryType = row.source_time_entry?.entry_type?.value;
      if (entryType === "travel") {
        summary.travelTotal += total;
        summary.travelLineItemCount += 1;
      } else {
        // Labor, or (defensively) an unresolved entry_type — the sync
        // trigger only ever writes Labor/Travel here, so this branch is
        // Labor in practice.
        summary.laborTotal += total;
        summary.laborLineItemCount += 1;
      }
    } else if (row.source_work_order_article_id) {
      summary.materialTotal += total;
      summary.materialLineItemCount += 1;
    } else {
      summary.otherTotal += total;
      summary.otherLineItemCount += 1;
    }
  }

  summary.travelTotal = Math.round(summary.travelTotal * 100) / 100;
  summary.laborTotal = Math.round(summary.laborTotal * 100) / 100;
  summary.materialTotal = Math.round(summary.materialTotal * 100) / 100;
  summary.otherTotal = Math.round(summary.otherTotal * 100) / 100;
  summary.grandTotal = Math.round(summary.grandTotal * 100) / 100;

  return ok(summary);
}
