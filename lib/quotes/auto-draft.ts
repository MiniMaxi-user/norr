import "server-only";

import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Small shared helpers around a work order's `is_auto_draft = true` quote
 * (issue #109, `supabase/migrations/20260901090000_work_order_auto_draft_quotes.sql`).
 * Deliberately NOT a `"use server"` file (a Server Action file may only
 * export async functions — same reasoning as `lib/rate-overrides/schema.ts`'s
 * header comment) — a plain helper module imported by the Server Action files
 * that actually need it:
 *  - `app/(app)/work-orders/create-quote-actions.ts` (the "Create Quote"
 *    button's promotion path).
 *  - `app/(app)/work-orders/quote-sync-actions.ts` (the read-only "N entries
 *    missing rate" / cost-summary queries the Work Order page consumes).
 *
 * Both callers need the exact same two lookups (find the current auto-draft,
 * and diff its `quote_line_items` against eligible `time_entries`), so this
 * lives in one place rather than being re-derived per file — unlike e.g.
 * `validateClientRateOverrideArticle`/`validateRateOverrideArticle` (small
 * enough that this codebase's own convention is to just duplicate them
 * per-file), these two queries are not trivial one-liners and drifting them
 * apart across two files would be a real bug risk (see
 * `computeUnresolvedTimeEntryIds`'s own comment for why the "eligible" filter
 * must stay identical to the sync trigger's).
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Looks up the work order's current `is_auto_draft = true` quote id, or
 * `null` when none exists — either this work order predates issue #109's
 * `work_orders_create_auto_draft_quote` trigger (no backfill, per that
 * migration's design), or its auto-draft was already promoted
 * (`is_auto_draft -> false`). At most one such row can ever exist per work
 * order (`quotes_one_auto_draft_per_work_order_idx`), so `.maybeSingle()` is
 * safe here.
 */
export async function findAutoDraftQuoteId(supabase: SupabaseServerClient, workOrderId: string) {
  const { data, error } = await supabase
    .from("quotes")
    .select("id")
    .eq("work_order_id", workOrderId)
    .eq("is_auto_draft", true)
    .maybeSingle<{ id: string }>();

  return { data: data?.id ?? null, error };
}

/**
 * Diffs a work order's eligible (Labor/Travel, already-finished) time entries
 * against `quoteId`'s own `quote_line_items.source_time_entry_id` values —
 * whatever's left over is what
 * `sync_time_entry_to_auto_draft_quote`/`sync_time_entry_to_auto_draft_quote_delete`
 * (the DB trigger pair) couldn't resolve a billing rate for, exactly the
 * "queryable" shape issue #109's migration header describes for this purpose.
 *
 * `quoteId` is taken as an explicit parameter rather than re-derived from
 * `is_auto_draft = true` internally — the one caller that needs this
 * mid-promotion (`promoteAutoDraftQuote` in `create-quote-actions.ts`) already
 * has the quote id in hand and calls this either side of flipping
 * `is_auto_draft` to `false`; re-deriving it here by that flag would break the
 * instant it's flipped. Callers that don't already have a quote id (the
 * read-only `getUnresolvedWorkOrderTimeEntries` query) look it up via
 * `findAutoDraftQuoteId` first and pass it in.
 *
 * The "eligible" filter (Labor/Travel type, `ended_at` set) is deliberately
 * kept identical to `sync_time_entry_to_auto_draft_quote`'s own — a
 * still-running or Break-type entry was never a pricing candidate in the
 * first place (same distinction `createQuoteFromWorkOrder`'s own
 * `skippedTimeEntryIds` has always drawn), so it must never show up here as
 * "missing rate" either.
 */
export async function computeUnresolvedTimeEntryIds(
  supabase: SupabaseServerClient,
  workOrderId: string,
  quoteId: string,
) {
  const [eligibleResult, syncedResult] = await Promise.all([
    supabase
      .from("time_entries")
      .select("id, ended_at, time_entry_type:reference_list_items!time_entries_entry_type_id_fkey(value)")
      .eq("work_order_id", workOrderId)
      .not("ended_at", "is", null),
    supabase
      .from("quote_line_items")
      .select("source_time_entry_id")
      .eq("quote_id", quoteId)
      .not("source_time_entry_id", "is", null),
  ]);

  if (eligibleResult.error) return { data: [] as string[], error: eligibleResult.error };
  if (syncedResult.error) return { data: [] as string[], error: syncedResult.error };

  const syncedIds = new Set(
    (syncedResult.data ?? []).map((row) => row.source_time_entry_id as string),
  );

  const eligible = (eligibleResult.data ?? []) as unknown as {
    id: string;
    time_entry_type: { value: string } | null;
  }[];

  const unresolvedIds = eligible
    .filter((entry) => entry.time_entry_type?.value === "labor" || entry.time_entry_type?.value === "travel")
    .filter((entry) => !syncedIds.has(entry.id))
    .map((entry) => entry.id);

  return { data: unresolvedIds, error: null as null };
}
