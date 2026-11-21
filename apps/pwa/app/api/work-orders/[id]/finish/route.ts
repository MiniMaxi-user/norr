import { NextResponse } from "next/server";
import { canAny } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getEnabledFeatureKeys } from "@/lib/features/server";
import { mapVolumeReadingError } from "@/lib/asset-volumes/errors";
import type { FinishVolumeReadingInput } from "@/lib/asset-volumes/types";

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
 *    "to_review" reference item (office review gate, product feedback,
 *    2026-09-18 — see `supabase/migrations/20260920110000_work_order_to_
 *    review_status.sql`'s header: an engineer finishing a job from the field
 *    no longer lands it straight on `completed`; a separate owner/planner-
 *    only "Goedkeuren"/Approve action, `approveWorkOrderReview` in
 *    `app/(app)/work-orders/actions.ts`, is what actually flips it on to
 *    `completed` from the desktop app), stamps `completed_at`, and writes
 *    `work_orders.solution` (product feedback, 2026-09-13: the desktop
 *    webapp had nowhere to see how a job was actually resolved) from the
 *    Sign off tab's free-text field — same "first and only sync" reasoning
 *    as the periods/articles above, so this plainly overwrites the column
 *    rather than merging. `completed_at` is still stamped HERE, not on
 *    approval — it represents when the engineer physically finished the job
 *    in the field, not when the office later reviews/approves it.
 *
 * Issue #225 — finishing now REQUIRES (400, before anything is written):
 * a non-empty Solution, and — when the work order's asset has counters
 * configured on its model — at least one volume reading per counter with
 * `work_order_id` = this work order. The body's `volumeReadings` (readings
 * the engineer queued offline) are inserted first (user session, RLS) with
 * `needs_review: true`, so a value that turns out to break the chronological
 * check is stored flagged for office review instead of being rejected; the DB
 * trigger clears the flag again when the value is actually consistent. Inserts
 * are idempotent on the client uuid `id` (a retried finish ignores
 * duplicates). Issue #226: the signature (PNG data URL, required, <= 1 MB) is
 * uploaded to the private `work-order-signatures` bucket at
 * `{organization_id}/{work_order_id}/signature.png` and recorded in
 * `work_order_signatures` (idempotent upserts, user session / RLS), right
 * before the status update.
 *
 * Issue #230 — checklists: the body's `checklistToggles` (items ticked/
 * unticked offline) are applied to THIS work order's standard checklist
 * (items of other checklists are ignored), then every `is_required` item
 * must be checked (400 "Complete the required checklist items: A, B.").
 * Queued volume readings replace the engineer's earlier reading of the same
 * counter on this work order (one per counter per work order). All of this
 * is idempotent and runs before the non-idempotent time_entries/articles
 * inserts below.
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
   * Required (issue #225): an empty value is rejected with 400. */
  solution?: string;
  /** Readings queued offline (issue #225). */
  volumeReadings?: FinishVolumeReadingInput[];
  /** Checklist items toggled offline (issue #230). */
  checklistToggles?: { itemId: string; isChecked: boolean }[];
  /** `canvas.toDataURL()` PNG of the signature (issue #226). Required. */
  signatureDataUrl?: string;
  /** Epoch ms of the sign-off on the device (optional; defaults to now). */
  signedAt?: number;
}

const SIGNATURE_PREFIX = "data:image/png;base64,";
const SIGNATURE_MAX_BYTES = 1024 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

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

const ISO_WITH_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_VOLUME_VALUE = 999_999_999_999.999;
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

function isFinishVolumeReadingInput(value: unknown): value is FinishVolumeReadingInput {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    UUID_RE.test(r.id) &&
    typeof r.volumeItemId === "string" &&
    UUID_RE.test(r.volumeItemId) &&
    typeof r.value === "number" &&
    Number.isFinite(r.value) &&
    r.value >= 0 &&
    r.value <= MAX_VOLUME_VALUE &&
    Number.isInteger(r.value) &&
    typeof r.readAt === "string" &&
    ISO_WITH_OFFSET_RE.test(r.readAt) &&
    !Number.isNaN(Date.parse(r.readAt)) &&
    Date.parse(r.readAt) <= Date.now() + FUTURE_TOLERANCE_MS &&
    (r.notes === null || r.notes === undefined || (typeof r.notes === "string" && r.notes.length <= 2000))
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

  // Body is optional at parse time — an empty/missing body just means no
  // periods/articles/readings to flush (a solution is still required, below).
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
  const rawVolumeReadings: unknown[] = Array.isArray(body.volumeReadings) ? body.volumeReadings : [];
  const volumeReadings = rawVolumeReadings.filter(isFinishVolumeReadingInput);
  // A malformed reading must never be dropped silently (it would surface as
  // a misleading "reading required" error, or lose the engineer's value).
  if (volumeReadings.length !== rawVolumeReadings.length) {
    return NextResponse.json({ error: "One or more volume readings are invalid." }, { status: 400 });
  }

  const rawToggles: unknown[] = Array.isArray(body.checklistToggles) ? body.checklistToggles : [];
  const toggleByItem = new Map<string, boolean>();
  for (const raw of rawToggles) {
    const t = raw as { itemId?: unknown; isChecked?: unknown } | null;
    if (!t || typeof t.itemId !== "string" || !UUID_RE.test(t.itemId) || typeof t.isChecked !== "boolean") {
      return NextResponse.json({ error: "One or more checklist toggles are invalid." }, { status: 400 });
    }
    toggleByItem.set(t.itemId, t.isChecked); // last one wins
  }

  // Issue #225: a Solution is required — checked before anything is written.
  if (!solution) {
    return NextResponse.json({ error: "A solution is required." }, { status: 400 });
  }

  // Issue #226: a signature is required — decoded/validated before any write.
  const signatureDataUrl = typeof body.signatureDataUrl === "string" ? body.signatureDataUrl : "";
  if (!signatureDataUrl) {
    return NextResponse.json({ error: "A signature is required." }, { status: 400 });
  }
  const signatureBase64 = signatureDataUrl.startsWith(SIGNATURE_PREFIX)
    ? signatureDataUrl.slice(SIGNATURE_PREFIX.length)
    : "";
  if (
    !signatureBase64 ||
    signatureBase64.length > Math.ceil((SIGNATURE_MAX_BYTES * 4) / 3) + 4 ||
    !BASE64_RE.test(signatureBase64)
  ) {
    return NextResponse.json({ error: "The signature is invalid or too large." }, { status: 400 });
  }
  const signatureBytes = Buffer.from(signatureBase64, "base64");
  // Must really be a PNG (magic bytes): a corrupt image would make every later
  // work receipt render for this work order fail.
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const isPng = PNG_MAGIC.every((byte, index) => signatureBytes[index] === byte);
  if (!isPng || signatureBytes.length > SIGNATURE_MAX_BYTES) {
    return NextResponse.json({ error: "The signature is invalid or too large." }, { status: 400 });
  }
  const signedAtMs =
    typeof body.signedAt === "number" && Number.isFinite(body.signedAt) && body.signedAt <= Date.now() + FUTURE_TOLERANCE_MS
      ? body.signedAt
      : Date.now();

  const supabase = await createClient();

  // Issue #248: only what the org's active modules need is validated/stored.
  const enabledFeatures = session.organization ? await getEnabledFeatureKeys(session.organization.id) : new Set<string>();
  const metersEnabled = enabledFeatures.has("meters");
  const checklistsEnabled = enabledFeatures.has("checklists");

  // organization_id, to resolve the CALLER'S OWN org's "completed"
  // work_order_status item and (if needed) time_entry_type items below —
  // reference_list_items are tenant-scoped, not a shared global lookup.
  // RLS (`work_orders_select_scoped`) already hides this row entirely if
  // it isn't this engineer's own assigned order, so a 404 here correctly
  // covers both "doesn't exist" and "not yours".
  const { data: workOrder, error: workOrderError } = await supabase
    .from("work_orders")
    .select("organization_id, asset_id")
    .eq("id", id)
    .maybeSingle();

  if (workOrderError) {
    console.error("POST /api/work-orders/[id]/finish: failed to load work order", workOrderError);
    return NextResponse.json({ error: "Failed to load work order." }, { status: 500 });
  }
  if (!workOrder) {
    return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  }

  // Issue #225: volume readings. Insert the queued offline readings (flagged
  // needs_review), then require >= 1 reading per configured counter on THIS
  // work order. Runs before periods/articles/status so a 400 here leaves
  // nothing half-written (the readings inserted above are idempotent on id).
  if (metersEnabled && workOrder.asset_id) {
    // Issue #230: one reading per counter per work order — if several are queued
    // for the same counter, only the last one is kept.
    const lastPerCounter = new Map<string, FinishVolumeReadingInput>();
    for (const reading of volumeReadings) lastPerCounter.set(reading.volumeItemId, reading);
    for (const reading of lastPerCounter.values()) {
      // Atomic replace (delete + insert in one transaction under RLS, so the
      // engineer only replaces their own reading). needs_review = true stores a
      // non-monotonic value flagged instead of rejecting it. p_reading_id makes
      // a retried finish idempotent (the existing reading is returned as-is).
      const { error: readingError } = await supabase.rpc("replace_work_order_volume_reading", {
        p_work_order_id: id,
        p_volume_item_id: reading.volumeItemId,
        p_value: reading.value,
        p_read_at: reading.readAt,
        p_reading_id: reading.id,
        p_needs_review: true,
        p_notes: reading.notes?.trim() ? reading.notes.trim() : null,
      });
      if (readingError) {
        const friendly = mapVolumeReadingError(readingError, reading.value);
        if (friendly) return NextResponse.json({ error: friendly.message }, { status: 400 });
        console.error("POST /api/work-orders/[id]/finish: failed to save volume reading", readingError);
        return NextResponse.json({ error: "Failed to save volume readings." }, { status: 500 });
      }
    }

    const { data: asset, error: assetError } = await supabase
      .from("assets")
      .select("model_id")
      .eq("id", workOrder.asset_id)
      .maybeSingle();
    if (assetError) {
      console.error("POST /api/work-orders/[id]/finish: failed to load asset", assetError);
      return NextResponse.json({ error: "Failed to load asset." }, { status: 500 });
    }

    if (asset?.model_id) {
      const [configuredResult, onWorkOrderResult] = await Promise.all([
        supabase
          .from("asset_model_volumes")
          .select("volume_item_id, sort_order, item:reference_list_items(label)")
          .eq("asset_model_id", asset.model_id)
          .order("sort_order", { ascending: true }),
        supabase.from("asset_volume_readings").select("volume_item_id").eq("work_order_id", id),
      ]);
      if (configuredResult.error || onWorkOrderResult.error) {
        console.error(
          "POST /api/work-orders/[id]/finish: failed to check volume readings",
          configuredResult.error ?? onWorkOrderResult.error,
        );
        return NextResponse.json({ error: "Failed to check volume readings." }, { status: 500 });
      }
      const done = new Set(((onWorkOrderResult.data ?? []) as { volume_item_id: string }[]).map((r) => r.volume_item_id));
      const missing = ((configuredResult.data ?? []) as unknown as { volume_item_id: string; item: { label: string } | null }[])
        .filter((c) => !done.has(c.volume_item_id))
        .map((c) => c.item?.label ?? "Unknown counter");
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `A volume reading is required for: ${missing.join(", ")}.` },
          { status: 400 },
        );
      }
    }
  }

  // Issue #230: checklist. Apply the offline toggles to this work order's
  // checklist, then require every is_required item to be checked. Idempotent
  // (sets absolute values), so it sits before the non-idempotent inserts.
  if (checklistsEnabled) {
    const { data: checklistItems, error: checklistError } = await supabase
      .from("work_order_checklist_items")
      .select("id, label, is_required, is_checked, sort_order, checklist:work_order_checklists!inner(work_order_id)")
      .eq("checklist.work_order_id", id);
    if (checklistError) {
      console.error("POST /api/work-orders/[id]/finish: failed to load checklist", checklistError);
      return NextResponse.json({ error: "Failed to check the checklist." }, { status: 500 });
    }
    const items = (checklistItems ?? []) as unknown as {
      id: string;
      label: string;
      is_required: boolean;
      is_checked: boolean;
      sort_order: number;
    }[];
    for (const item of items) {
      const wanted = toggleByItem.get(item.id);
      if (wanted === undefined || wanted === item.is_checked) continue;
      const { error: toggleError } = await supabase
        .from("work_order_checklist_items")
        .update({ is_checked: wanted })
        .eq("id", item.id);
      if (toggleError) {
        console.error("POST /api/work-orders/[id]/finish: failed to apply checklist toggle", toggleError);
        return NextResponse.json({ error: "Failed to save the checklist." }, { status: 500 });
      }
      item.is_checked = wanted;
    }
    const openRequired = items
      .filter((item) => item.is_required && !item.is_checked)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => item.label);
    if (openRequired.length > 0) {
      return NextResponse.json(
        { error: `Complete the required checklist items: ${openRequired.join(", ")}.` },
        { status: 400 },
      );
    }
  }

  // Issue #226: signature upload + row, idempotent (upsert) so a retried
  // finish simply overwrites. Deliberately BEFORE the non-idempotent
  // time_entries/work_order_articles inserts below: a failure here returns
  // 500 and the PWA retries, which must not duplicate hours/material.
  // Path must be exactly org/work order/signature.png.
  const signaturePath = `${workOrder.organization_id}/${id}/signature.png`;
  const { error: signatureUploadError } = await supabase.storage
    .from("work-order-signatures")
    .upload(signaturePath, signatureBytes, { contentType: "image/png", upsert: true });
  if (signatureUploadError) {
    console.error("POST /api/work-orders/[id]/finish: failed to upload signature", signatureUploadError);
    return NextResponse.json({ error: "Failed to save the signature." }, { status: 500 });
  }
  // Select-then-write, NOT `.upsert()`: PostgREST's merge upsert generates
  // `ON CONFLICT DO UPDATE SET work_order_id = ...`, and `work_order_id` has
  // no UPDATE grant (only storage_path/signed_at) — every finish failed with
  // 42501 → 500 ("check your connection"). Same pattern as the e-mail settings.
  const signedAtIso = new Date(signedAtMs).toISOString();
  const { data: existingSignature, error: existingSignatureError } = await supabase
    .from("work_order_signatures")
    .select("id")
    .eq("work_order_id", id)
    .maybeSingle();
  const { error: signatureRowError } = existingSignatureError
    ? { error: existingSignatureError }
    : existingSignature
      ? await supabase
          .from("work_order_signatures")
          .update({ storage_path: signaturePath, signed_at: signedAtIso })
          .eq("work_order_id", id)
      : await supabase
          .from("work_order_signatures")
          .insert({ work_order_id: id, storage_path: signaturePath, signed_at: signedAtIso });
  if (signatureRowError) {
    console.error("POST /api/work-orders/[id]/finish: failed to save signature row", signatureRowError);
    return NextResponse.json({ error: "Failed to save the signature." }, { status: 500 });
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

  const { data: toReviewItem, error: toReviewItemError } = await supabase
    .from("reference_list_items")
    .select("id")
    .eq("reference_list_id", statusList.id)
    .eq("value", "to_review")
    .maybeSingle();

  if (toReviewItemError || !toReviewItem) {
    console.error(
      "POST /api/work-orders/[id]/finish: organization's work_order_status list has no 'to_review' item",
      toReviewItemError,
    );
    return NextResponse.json({ error: "Failed to resolve the to-review status." }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("work_orders")
    .update({ status_id: toReviewItem.id, completed_at: new Date().toISOString(), solution })
    .eq("id", id);

  if (updateError) {
    console.error("POST /api/work-orders/[id]/finish: failed to update work order", updateError);
    return NextResponse.json({ error: "Failed to mark this work order as awaiting review." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
