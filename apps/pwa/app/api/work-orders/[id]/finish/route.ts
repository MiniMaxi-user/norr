import { NextResponse } from "next/server";
import { canAny } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/work-orders/[id]/finish — "Finish workitem" (product feedback,
 * 2026-09-12). Two things happen here, both real/Supabase-backed, unlike
 * every other #170 mutation which stays local-only per that issue's scope
 * boundary (see `lib/offline/db.ts`'s top doc comment):
 *
 * 1. Flushes this device's locally-logged timer periods and locally-added
 *    articles for this order into the real `time_entries`/
 *    `work_order_articles` tables — WITHOUT this, finishing a job from the
 *    PWA left the desktop webapp showing zero hours and zero articles for
 *    it, even though the engineer logged both (bug report, 2026-09-13).
 *    The client (`work-order-detail.tsx`'s `handleFinish`) sends its full,
 *    already-closed local period/article lists in the request body — this
 *    is the FIRST and ONLY time this data reaches the server (nothing was
 *    synced earlier), so there's no partial-sync/dedupe state to reconcile.
 * 2. Sets `status_id` to the caller's own organization's `work_order_status`
 *    "completed" reference item, stamps `completed_at`, and writes
 *    `work_orders.solution` (product feedback, 2026-09-13: the desktop
 *    webapp had nowhere to see how a job was actually resolved) from the
 *    Sign off tab's free-text field — same "first and only sync" reasoning
 *    as the periods/articles above, so this plainly overwrites the column
 *    rather than merging.
 *
 * Same session -> `canAny()` -> RLS-scoped-query pattern as every other
 * route in this app. `time_entries_insert_scoped`/`work_order_articles_
 * insert_scoped`/`work_orders_update_scoped` (see
 * `supabase/migrations/20260823180000_time_entries_core.sql`,
 * `20260830100000_work_order_articles_and_quote_traceability.sql`,
 * `20260823120000_work_orders_core.sql`) already restrict an engineer to
 * inserting their own rows / updating their own assigned work order — no
 * app-layer filter added on top. `update_own` is the exact permission-
 * matrix action this needs (`packages/rbac/src/permissions.ts`'s `planning`
 * row already grants `engineer` `read_own`/`update_own`/`create_own`).
 *
 * Ordering: articles and time entries are inserted BEFORE the status
 * update, so a failure here never leaves a work order marked `completed`
 * with nothing logged against it — the exact bug this route exists to fix.
 * A failure partway between the two inserts (time entries in, articles
 * failing, say) can in principle double-insert time entries on a client
 * retry, since this isn't wrapped in one Postgres transaction (each insert
 * is its own PostgREST call) — accepted for now (pre-launch; see the
 * project's own "still bouwfase" framing), not solved with a database
 * function/RPC here.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FinishPeriodInput {
  kind: "travel" | "work";
  /** Epoch ms. */
  startedAt: number;
  /** Epoch ms. */
  endedAt: number;
}

interface FinishArticleInput {
  articleId: string;
  quantity: number;
}

interface FinishRequestBody {
  periods?: FinishPeriodInput[];
  articles?: FinishArticleInput[];
  /** Free-text resolution written on the Sign off tab — `work_orders.solution`.
   * Optional, same as a signature: finishing with nothing written is valid. */
  solution?: string;
}

/** Matches `activities.solution`'s app-layer cap
 * (`app/(app)/activities/schema.ts`'s `optionalText(5000)`) — same free-text
 * shape, same ceiling, so the two stay consistent even though they're
 * different columns. */
const SOLUTION_MAX_LENGTH = 5000;

function isFinishPeriodInput(value: unknown): value is FinishPeriodInput {
  if (!value || typeof value !== "object") return false;
  const period = value as Record<string, unknown>;
  return (
    (period.kind === "travel" || period.kind === "work") &&
    typeof period.startedAt === "number" &&
    typeof period.endedAt === "number" &&
    period.endedAt >= period.startedAt
  );
}

function isFinishArticleInput(value: unknown): value is FinishArticleInput {
  if (!value || typeof value !== "object") return false;
  const article = value as Record<string, unknown>;
  return (
    typeof article.articleId === "string" &&
    UUID_RE.test(article.articleId) &&
    typeof article.quantity === "number" &&
    article.quantity > 0
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid work order id." }, { status: 400 });
  }

  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (!canAny({ role: session.role }, "planning", ["update_own"])) {
    return NextResponse.json({ error: "You do not have permission to update this work order." }, { status: 403 });
  }

  // Body is optional (finishing with nothing logged is valid — e.g. a job
  // that turned out to need no visit) — an empty/missing body just means
  // no periods/articles to flush.
  let body: FinishRequestBody = {};
  try {
    const raw = await request.text();
    if (raw) body = JSON.parse(raw) as FinishRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const periods = Array.isArray(body.periods) ? body.periods.filter(isFinishPeriodInput) : [];
  const articles = Array.isArray(body.articles) ? body.articles.filter(isFinishArticleInput) : [];
  const trimmedSolution = typeof body.solution === "string" ? body.solution.trim() : "";
  const solution = trimmedSolution ? trimmedSolution.slice(0, SOLUTION_MAX_LENGTH) : null;

  const supabase = await createClient();

  // organization_id, to resolve the CALLER'S OWN org's "completed"
  // work_order_status item and (if needed) time_entry_type items below —
  // reference_list_items are tenant-scoped, not a shared global lookup.
  // RLS (`work_orders_select_scoped`) already hides this row entirely if
  // it isn't this engineer's own assigned order, so a 404 here correctly
  // covers both "doesn't exist" and "not yours".
  const { data: workOrder, error: workOrderError } = await supabase
    .from("work_orders")
    .select("organization_id")
    .eq("id", id)
    .maybeSingle();

  if (workOrderError) {
    console.error("POST /api/work-orders/[id]/finish: failed to load work order", workOrderError);
    return NextResponse.json({ error: "Failed to load work order." }, { status: 500 });
  }
  if (!workOrder) {
    return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  }

  if (periods.length > 0) {
    const { data: entryTypeList, error: entryTypeListError } = await supabase
      .from("reference_lists")
      .select("id")
      .eq("organization_id", workOrder.organization_id)
      .eq("list_key", "time_entry_type")
      .maybeSingle();

    if (entryTypeListError || !entryTypeList) {
      console.error(
        "POST /api/work-orders/[id]/finish: organization has no time_entry_type reference list",
        entryTypeListError,
      );
      return NextResponse.json({ error: "Failed to log hours." }, { status: 500 });
    }

    const { data: entryTypeItems, error: entryTypeItemsError } = await supabase
      .from("reference_list_items")
      .select("id, value")
      .eq("reference_list_id", entryTypeList.id)
      .in("value", ["travel", "labor"]);

    if (entryTypeItemsError || !entryTypeItems) {
      console.error(
        "POST /api/work-orders/[id]/finish: failed to resolve time_entry_type items",
        entryTypeItemsError,
      );
      return NextResponse.json({ error: "Failed to log hours." }, { status: 500 });
    }

    // The PWA's own clock only has two kinds ("travel"/"work" —
    // `lib/time/clocks.ts`'s `ClockKind`); "work" maps to the reference
    // list's "labor" value (its default entry type — see
    // `20260823180000_time_entries_core.sql`'s seed), matching
    // `/api/work-orders/[id]`'s own GET route, which reads any non-"travel"
    // entry_type back as "work".
    const travelTypeId = entryTypeItems.find((item) => item.value === "travel")?.id;
    const laborTypeId = entryTypeItems.find((item) => item.value === "labor")?.id;
    if (!travelTypeId || !laborTypeId) {
      console.error("POST /api/work-orders/[id]/finish: organization is missing travel/labor time_entry_type items");
      return NextResponse.json({ error: "Failed to log hours." }, { status: 500 });
    }

    const { error: timeEntriesError } = await supabase.from("time_entries").insert(
      periods.map((period) => ({
        work_order_id: id,
        user_id: session.userId,
        entry_type_id: period.kind === "travel" ? travelTypeId : laborTypeId,
        started_at: new Date(period.startedAt).toISOString(),
        ended_at: new Date(period.endedAt).toISOString(),
      })),
    );

    if (timeEntriesError) {
      console.error("POST /api/work-orders/[id]/finish: failed to insert time entries", timeEntriesError);
      return NextResponse.json({ error: "Failed to log hours." }, { status: 500 });
    }
  }

  if (articles.length > 0) {
    const { error: articlesError } = await supabase.from("work_order_articles").insert(
      articles.map((article) => ({
        work_order_id: id,
        article_id: article.articleId,
        quantity: article.quantity,
      })),
    );

    if (articlesError) {
      console.error("POST /api/work-orders/[id]/finish: failed to insert articles", articlesError);
      return NextResponse.json({ error: "Failed to log articles." }, { status: 500 });
    }
  }

  const { data: statusList, error: statusListError } = await supabase
    .from("reference_lists")
    .select("id")
    .eq("organization_id", workOrder.organization_id)
    .eq("list_key", "work_order_status")
    .maybeSingle();

  if (statusListError || !statusList) {
    console.error(
      "POST /api/work-orders/[id]/finish: organization has no work_order_status reference list",
      statusListError,
    );
    return NextResponse.json({ error: "Failed to resolve the completed status." }, { status: 500 });
  }

  const { data: completedItem, error: completedItemError } = await supabase
    .from("reference_list_items")
    .select("id")
    .eq("reference_list_id", statusList.id)
    .eq("value", "completed")
    .maybeSingle();

  if (completedItemError || !completedItem) {
    console.error(
      "POST /api/work-orders/[id]/finish: organization's work_order_status list has no 'completed' item",
      completedItemError,
    );
    return NextResponse.json({ error: "Failed to resolve the completed status." }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("work_orders")
    .update({ status_id: completedItem.id, completed_at: new Date().toISOString(), solution })
    .eq("id", id);

  if (updateError) {
    console.error("POST /api/work-orders/[id]/finish: failed to update work order", updateError);
    return NextResponse.json({ error: "Failed to mark this work order as completed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
