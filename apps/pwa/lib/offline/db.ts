/**
 * Offline store for the engineer PWA. A single Dexie/IndexedDB database.
 *
 * Issue #169 tables (read-only cache):
 * - `workitems` — the mapped `/api/workitems/today` response items
 *   (camelCase, same shape the API already returns — see that route's own
 *   doc comment for the contract), keyed by `id`.
 * - `meta` — a single key/value row storing `lastSyncedAt` (the API
 *   response's own `syncedAt`), so the UI can say "last synced at ..." even
 *   after a full page reload with no network.
 *
 * This MVP's list is always "today's full set" (no incremental
 * create/update/delete of individual work orders from this screen — it's
 * read-only, see issue #169's "out of scope" notes), so every successful
 * sync does a full bulk replace of `workitems` rather than a merge/diff.
 *
 * Issue #170 tables (the local side of the timer/outbox during a job —
 * see that issue's "Notes / out of scope": no generic
 * `POST /api/sync/outbox` processor. Product feedback, 2026-09-12,
 * added a real, specific flush instead: finishing a work order
 * (`POST /api/work-orders/[id]/finish`) now posts these periods/articles
 * to the server's own `time_entries`/`work_order_articles` as part of
 * marking it `completed` — see that route's doc comment. Until finish,
 * everything below stays purely local):
 * - `clockPeriods` — one row per travel/work period, `{kind, startedAt,
 *   endedAt}` per work order (`endedAt: null` while running). A sequence of
 *   periods, not a summed duration, per IMPLEMENTATION.md §5 — the running
 *   elapsed time for any period is always *recomputed* from `startedAt` (see
 *   `lib/time/clocks.ts`), never accumulated on an interval tick, so it
 *   survives a closed app or a backgrounded tab.
 * - `signoffs` — one row per work order once its work receipt has been
 *   signed locally (`Finish work order` → `Send work receipt`), keyed by
 *   `workOrderId`. Local-only for the same reason as the periods above — no
 *   server write yet.
 * - `localArticles` — articles added from the "Add article" catalog sheet
 *   while working a job. Local-only (§ scope boundary): these are NOT the
 *   same rows as the server's `work_order_articles` (read via
 *   `/api/work-orders/[id]`) — that read path stays real/Supabase-backed,
 *   this is only the not-yet-synced additions made from this device.
 * - `localPhotos` — photos taken from the Photos tab, stored as `Blob`s.
 *   Local-only — this story never posts photos anywhere, unlike periods/
 *   articles above.
 * - `workOrderDetails` — a read-through cache of `/api/work-orders/[id]`'s
 *   response, one row per work order this device has successfully
 *   fetched at least once. Product feedback, 2026-09-12: opening a work
 *   order while offline previously always failed (this story originally
 *   scoped the detail read as real/online-only, see
 *   `work-order-detail.tsx`'s own doc comment) — now it falls back to
 *   this cache the same way the Today list already falls back to
 *   `workitems` when `/api/workitems/today` fails.
 *
 * All issue #170 tables are scoped to the current engineer exactly like
 * `workitems`/`meta` already are — see `ensureCacheBelongsTo`.
 */
import Dexie, { type Table } from "dexie";
import type { WorkOrderDetailResponse } from "@/lib/work-orders/types";

export interface CachedWorkItemReference {
  label: string;
  color: string | null;
}

/** Adds the reference list item's raw `value` (e.g. `"in_progress"`) on top
 * of `CachedWorkItemReference` — only `status` carries this (see
 * `deriveTodayFlowStatus` in `app/(app)/today/derive.ts`, which needs it to
 * fold the real `work_order_status` lifecycle into this screen's simplified
 * Planned/In progress/Signed buckets, issue #170 IMPLEMENTATION.md §6). */
export interface CachedWorkItemStatus extends CachedWorkItemReference {
  value: string | null;
}

export interface CachedWorkItemParty {
  id: string;
  name: string;
}

export interface CachedWorkItemSite {
  id: string;
  addressLine1: string | null;
  city: string | null;
}

/** Mirrors `/api/workitems/today`'s per-item response shape exactly —
 * nothing extra added for the cache. */
export interface CachedWorkItem {
  id: string;
  title: string;
  scheduledAt: string | null;
  client: CachedWorkItemParty | null;
  site: CachedWorkItemSite | null;
  status: CachedWorkItemStatus | null;
  type: CachedWorkItemReference | null;
  /** Issue #170 — the Today screen's "Urgent" tag/status-pill treatment
   * (IMPLEMENTATION.md §6), derived server-side from the work order's
   * `work_order_priority` (see `/api/workitems/today`'s own doc comment on
   * `work_order_priority` for why it's priority, not status). */
  isUrgent: boolean;
}

interface MetaRow {
  key: string;
  value: string;
}

/** A single travel/work period on a work order's timer (issue #170,
 * IMPLEMENTATION.md §5). `endedAt: null` means it's the currently-running
 * period — at most one row across the WHOLE database should ever have
 * `endedAt: null` at a time (max one order, one kind, running app-wide; see
 * `lib/time/clocks.ts`, which owns enforcing that, not this file). Auto-
 * incrementing `id` (not `workOrderId`) as the primary key, since a work
 * order accumulates many periods over its lifetime — this is the audit
 * trail IMPLEMENTATION.md §5 calls for, not a summed duration. */
export interface ClockPeriod {
  id?: number;
  workOrderId: string;
  userId: string;
  kind: "travel" | "work";
  /** Epoch ms. */
  startedAt: number;
  /** Epoch ms, or `null` while running. */
  endedAt: number | null;
}

/** One row per work order once its work receipt has been signed locally
 * (Sign off tab's `Finish work order` → `Send work receipt`). Local-only —
 * see this file's own top doc comment on the #170 tables' scope boundary. */
export interface LocalSignOff {
  workOrderId: string;
  userId: string;
  /** Epoch ms. */
  signedAt: number;
  /** `canvas.toDataURL()` PNG of the signature. */
  signatureDataUrl: string;
  /** Free-text resolution, synced to `work_orders.solution` on Finish
   * (product feedback, 2026-09-13) — kept alongside the signature so a
   * failed offline Finish attempt (periods/articles stay local, see
   * `work-order-detail.tsx`'s `handleFinish`) re-shows this as a draft on
   * reopen, same as the signature already does via `initialDataUrl`. */
  solution: string | null;
}

/** An article added from the "Add article" catalog sheet, not yet synced to
 * the server's `work_order_articles` (out of scope for this story — see
 * this file's own top doc comment). Repeated taps on the same catalog item
 * increment `quantity` on the existing row rather than adding a duplicate
 * (matches the catalog sheet's own "tap again for a second" copy). */
export interface LocalArticle {
  id?: number;
  workOrderId: string;
  userId: string;
  articleId: string;
  articleNumber: string;
  description: string;
  quantity: number;
}

/** A photo taken from the Photos tab, not yet synced anywhere — local-only,
 * see this file's own top doc comment. */
export interface LocalPhoto {
  id?: number;
  workOrderId: string;
  userId: string;
  /** Epoch ms. */
  takenAt: number;
  blob: Blob;
}

/** A read-through cache of one `/api/work-orders/[id]` response (product
 * feedback, 2026-09-12) — see this file's own top doc comment on why. */
export interface CachedWorkOrderDetail {
  workOrderId: string;
  userId: string;
  detail: WorkOrderDetailResponse;
  /** Epoch ms — shown as this screen's own "last synced" notice while
   * offline, same idea as the Today list's `lastSyncedAt`. */
  cachedAt: number;
}

const LAST_SYNCED_AT_KEY = "lastSyncedAt";
/** Which engineer's data is currently cached (see the user-scoping note
 * below) — not shown in the UI, purely a guard. */
const USER_ID_KEY = "userId";

class WorkItemsDatabase extends Dexie {
  workitems!: Table<CachedWorkItem, string>;
  meta!: Table<MetaRow, string>;
  clockPeriods!: Table<ClockPeriod, number>;
  signoffs!: Table<LocalSignOff, string>;
  localArticles!: Table<LocalArticle, number>;
  localPhotos!: Table<LocalPhoto, number>;
  workOrderDetails!: Table<CachedWorkOrderDetail, string>;

  constructor() {
    super("norr-pwa");
    this.version(1).stores({
      workitems: "id",
      meta: "key",
    });
    // Issue #170 — the local timer/outbox tables. `[userId+endedAt]` on
    // `clockPeriods` was meant to be what `lib/time/clocks.ts` queries to
    // find "every currently-running period for this engineer, across every
    // work order" in one indexed lookup (`endedAt` is `null` while
    // running) — superseded by version(3) below, see that comment for why
    // this compound index can never actually be queried for `endedAt:
    // null`.
    this.version(2).stores({
      workitems: "id",
      meta: "key",
      clockPeriods: "++id, workOrderId, [userId+endedAt], [workOrderId+kind]",
      signoffs: "workOrderId, userId",
      localArticles: "++id, [workOrderId+articleId]",
      localPhotos: "++id, workOrderId",
    });
    // v3: IndexedDB excludes a record from a compound index entirely when
    // ANY one of its key-path values is `null` (per spec, `null`/
    // `undefined` are not valid IDB keys) — and `endedAt` IS `null` on
    // exactly the row this whole timer depends on finding: the currently-
    // running period. That made `getOpenClockPeriods`'s
    // `.where({ userId, endedAt: null })` build an invalid `[userId,
    // null]` key range and throw a `DataError` on every call — so
    // Start/Stop silently did nothing; the running clock could never be
    // found (or, therefore, closed before starting a new one). Fixed by
    // indexing `userId` alone and filtering `endedAt === null` in JS (see
    // `getOpenClockPeriods` below) instead of relying on a compound index
    // that structurally cannot represent "endedAt is null".
    this.version(3).stores({
      workitems: "id",
      meta: "key",
      clockPeriods: "++id, workOrderId, userId, [workOrderId+kind]",
      signoffs: "workOrderId, userId",
      localArticles: "++id, [workOrderId+articleId]",
      localPhotos: "++id, workOrderId",
    });
    // v4 — the work-order-detail read-through cache (product feedback,
    // 2026-09-12), keyed by workOrderId like signoffs above.
    this.version(4).stores({
      workitems: "id",
      meta: "key",
      clockPeriods: "++id, workOrderId, userId, [workOrderId+kind]",
      signoffs: "workOrderId, userId",
      localArticles: "++id, [workOrderId+articleId]",
      localPhotos: "++id, workOrderId",
      workOrderDetails: "workOrderId, userId",
    });
  }
}

// A single shared instance — Dexie itself is safe to instantiate once and
// reuse across the app (it lazily opens the underlying IndexedDB
// connection). Constructing this at module scope is fine even though this
// file is imported from a "use client" component: Dexie no-ops/throws
// harmlessly if ever evaluated outside a browser, and nothing here runs
// eagerly at import time besides the constructor.
const db = new WorkItemsDatabase();

/**
 * Cross-user leak guard (QA finding on issue #169): IndexedDB is per
 * browser-profile, not per logged-in-account, so a shared/handed-down
 * device — a completely realistic scenario for field engineers — could
 * otherwise show Engineer B a cache that Engineer A's earlier session
 * populated (nothing about `logOutAction` clears client-side storage, and
 * can't from a server action anyway). Every read/write here is scoped to
 * `currentUserId`: if the cache belongs to a different user (or no user has
 * synced yet), it's wiped before use rather than ever handed back.
 *
 * Issue #170 widened the wipe to the local-outbox tables too — a
 * handed-down device must not show Engineer B a *running timer*, a signed
 * work receipt, pending articles/photos that actually belong to Engineer
 * A's still-open job, or (product feedback, 2026-09-12) a *cached work
 * order detail* Engineer A had open. Same reasoning, same mechanism, just
 * more tables.
 */
async function ensureCacheBelongsTo(currentUserId: string): Promise<void> {
  const row = await db.meta.get(USER_ID_KEY);
  if (row?.value === currentUserId) return;
  await db.transaction(
    "rw",
    [db.workitems, db.meta, db.clockPeriods, db.signoffs, db.localArticles, db.localPhotos, db.workOrderDetails],
    async () => {
      await db.workitems.clear();
      await db.meta.delete(LAST_SYNCED_AT_KEY);
      await db.clockPeriods.clear();
      await db.signoffs.clear();
      await db.localArticles.clear();
      await db.localPhotos.clear();
      await db.workOrderDetails.clear();
      await db.meta.put({ key: USER_ID_KEY, value: currentUserId });
    },
  );
}

/** Bulk-replaces the entire cached work-item list with `items` and records
 * `syncedAt` as the last-successful-sync timestamp — correct for this
 * MVP's "today's full set" semantics (no incremental merge). Stamps the
 * cache with `currentUserId` so a later session for a different engineer on
 * the same device never reads it back (see `ensureCacheBelongsTo`). */
export async function saveWorkItems(
  items: CachedWorkItem[],
  syncedAt: string,
  currentUserId: string,
): Promise<void> {
  await db.transaction("rw", db.workitems, db.meta, async () => {
    await db.workitems.clear();
    if (items.length > 0) {
      await db.workitems.bulkAdd(items);
    }
    await db.meta.put({ key: LAST_SYNCED_AT_KEY, value: syncedAt });
    await db.meta.put({ key: USER_ID_KEY, value: currentUserId });
  });
}

/** All cached work items belonging to `currentUserId`, ordered by
 * `scheduledAt` (nulls last) — same ordering the API itself returns,
 * re-applied here since Dexie's stored order isn't guaranteed to survive
 * `clear()` + `bulkAdd()` round-trips. Returns `[]` (after wiping the stale
 * cache) if the cache belongs to a different user — see
 * `ensureCacheBelongsTo`. */
export async function getCachedWorkItems(currentUserId: string): Promise<CachedWorkItem[]> {
  await ensureCacheBelongsTo(currentUserId);
  const items = await db.workitems.toArray();
  return items.slice().sort((a, b) => {
    if (a.scheduledAt === b.scheduledAt) return 0;
    if (a.scheduledAt === null) return 1;
    if (b.scheduledAt === null) return -1;
    return a.scheduledAt < b.scheduledAt ? -1 : 1;
  });
}

/** The last successful sync's `syncedAt` for `currentUserId`, or `null` if
 * this device has never synced for them (including right after a stale
 * different-user cache was wiped — see `ensureCacheBelongsTo`). */
export async function getLastSyncedAt(currentUserId: string): Promise<string | null> {
  await ensureCacheBelongsTo(currentUserId);
  const row = await db.meta.get(LAST_SYNCED_AT_KEY);
  return row?.value ?? null;
}

/* ------------------------------------------------------------------------ *
 * Issue #170 — local timer/outbox tables. The state-transition RULES (only
 * one order running app-wide, travel/work mutually exclusive within one
 * order, `Finish` closes the running period) live in `lib/time/clocks.ts`,
 * which calls the plain row accessors below — kept here so every #170
 * accessor goes through the same `ensureCacheBelongsTo` user-scoping guard
 * the #169 functions above already use.
 * ------------------------------------------------------------------------ */

/** Every currently-running period (`endedAt: null`) for `currentUserId`,
 * across every work order — at most one, by construction (see
 * `lib/time/clocks.ts`), but returned as a list since nothing here enforces
 * that invariant itself. */
export async function getOpenClockPeriods(currentUserId: string): Promise<ClockPeriod[]> {
  await ensureCacheBelongsTo(currentUserId);
  // Not `.where({ userId, endedAt: null })` — see the `version(3)` comment
  // in this file's constructor on why querying a compound index for a
  // `null` component throws instead of matching.
  const rows = await db.clockPeriods.where({ userId: currentUserId }).toArray();
  return rows.filter((row) => row.endedAt === null);
}

/** Every period (open or closed) logged against `workOrderId` by
 * `currentUserId` — the full audit trail IMPLEMENTATION.md §5 calls for,
 * oldest first. */
export async function getClockPeriodsForOrder(
  workOrderId: string,
  currentUserId: string,
): Promise<ClockPeriod[]> {
  await ensureCacheBelongsTo(currentUserId);
  const rows = await db.clockPeriods.where({ workOrderId }).toArray();
  return rows.filter((row) => row.userId === currentUserId).sort((a, b) => a.startedAt - b.startedAt);
}

/** Inserts a new running period (`endedAt: null`) and returns its id. Does
 * NOT close any other open period — that's `lib/time/clocks.ts`'s job
 * (enforcing "max one order running" is a policy decision, not something
 * this plain accessor should silently do). */
export async function startClockPeriod(period: Omit<ClockPeriod, "id" | "endedAt">): Promise<number> {
  return db.clockPeriods.add({ ...period, endedAt: null });
}

/** Closes a specific period by id. No-op if it's already closed or doesn't
 * exist (defensive — a double-tap racing two `stop` calls should not throw). */
export async function endClockPeriod(id: number, endedAt: number): Promise<void> {
  await db.clockPeriods.update(id, { endedAt });
}

/** Local sign-off for `workOrderId` by `currentUserId`, or `null` if not
 * (yet) signed on this device. */
export async function getLocalSignOff(
  workOrderId: string,
  currentUserId: string,
): Promise<LocalSignOff | null> {
  await ensureCacheBelongsTo(currentUserId);
  const row = await db.signoffs.get(workOrderId);
  return row && row.userId === currentUserId ? row : null;
}

/** Records `workOrderId` as signed locally — see this file's own top doc
 * comment on why this never reaches the server in this story. */
export async function saveLocalSignOff(signOff: LocalSignOff): Promise<void> {
  await db.signoffs.put(signOff);
}

/** Every work order id `currentUserId` has locally signed off on this
 * device — the Today screen's "Signed" bucket (`app/(app)/today/derive.ts`)
 * reads this in one batch rather than one `getLocalSignOff` call per row. */
export async function getSignedWorkOrderIds(currentUserId: string): Promise<Set<string>> {
  await ensureCacheBelongsTo(currentUserId);
  const rows = await db.signoffs.where({ userId: currentUserId }).toArray();
  return new Set(rows.map((row) => row.workOrderId));
}

/** Articles added from the catalog sheet for `workOrderId`, not yet synced. */
export async function getLocalArticles(
  workOrderId: string,
  currentUserId: string,
): Promise<LocalArticle[]> {
  await ensureCacheBelongsTo(currentUserId);
  const rows = await db.localArticles.where({ workOrderId }).toArray();
  return rows.filter((row) => row.userId === currentUserId);
}

/** Adds one of `articleId` to `workOrderId`'s local (not-yet-synced) article
 * list — a second tap on the same catalog item increments the existing
 * row's `quantity` instead of inserting a duplicate (matches the catalog
 * sheet's own "tap again for a second" copy). */
export async function addLocalArticle(input: {
  workOrderId: string;
  userId: string;
  articleId: string;
  articleNumber: string;
  description: string;
}): Promise<void> {
  await db.transaction("rw", db.localArticles, async () => {
    const existing = await db.localArticles
      .where({ workOrderId: input.workOrderId })
      .filter((row) => row.userId === input.userId && row.articleId === input.articleId)
      .first();
    if (existing?.id !== undefined) {
      await db.localArticles.update(existing.id, { quantity: existing.quantity + 1 });
      return;
    }
    await db.localArticles.add({
      workOrderId: input.workOrderId,
      userId: input.userId,
      articleId: input.articleId,
      articleNumber: input.articleNumber,
      description: input.description,
      quantity: 1,
    });
  });
}

/** Removes a single locally-added article row (the "×" button — only ever
 * offered on rows from `localArticles`, never on the server-synced rows
 * `/api/work-orders/[id]` returns, since removing one of those would be a
 * write against the server — out of scope here, see this file's top doc
 * comment). */
export async function removeLocalArticle(id: number): Promise<void> {
  await db.localArticles.delete(id);
}

/** Adjusts a local article row's `quantity` by `delta` (the tap-to-reveal
 * +/- stepper on the Articles tab — same local-only scope as `removeLocalArticle`
 * above, never called for a server-synced row). A decrement that would take
 * `quantity` to 0 or below removes the row entirely instead of leaving a
 * zero-quantity line. */
export async function updateLocalArticleQuantity(id: number, delta: number): Promise<void> {
  await db.transaction("rw", db.localArticles, async () => {
    const existing = await db.localArticles.get(id);
    if (!existing) return;
    const quantity = existing.quantity + delta;
    if (quantity <= 0) {
      await db.localArticles.delete(id);
      return;
    }
    await db.localArticles.update(id, { quantity });
  });
}

/** Photos taken for `workOrderId`, not yet synced anywhere. */
export async function getLocalPhotos(workOrderId: string, currentUserId: string): Promise<LocalPhoto[]> {
  await ensureCacheBelongsTo(currentUserId);
  const rows = await db.localPhotos.where({ workOrderId }).toArray();
  return rows.filter((row) => row.userId === currentUserId).sort((a, b) => a.takenAt - b.takenAt);
}

/** Stores a newly-taken photo locally. */
export async function addLocalPhoto(photo: Omit<LocalPhoto, "id">): Promise<void> {
  await db.localPhotos.add(photo);
}

/* ------------------------------------------------------------------------ *
 * Work-order-detail read-through cache (product feedback, 2026-09-12) — see
 * this file's own top doc comment on `workOrderDetails`.
 * ------------------------------------------------------------------------ */

/** Caches `/api/work-orders/[id]`'s response for `workOrderId`, scoped to
 * `currentUserId` — overwrites whatever was cached before (this is a
 * point-in-time snapshot, not something merged/diffed). */
export async function saveWorkOrderDetail(
  workOrderId: string,
  detail: WorkOrderDetailResponse,
  currentUserId: string,
): Promise<void> {
  await db.workOrderDetails.put({ workOrderId, userId: currentUserId, detail, cachedAt: Date.now() });
}

/** The cached `/api/work-orders/[id]` response for `workOrderId`, or `null`
 * if this device has never successfully fetched it (or the cache belongs
 * to a different user — see `ensureCacheBelongsTo`). */
export async function getCachedWorkOrderDetail(
  workOrderId: string,
  currentUserId: string,
): Promise<CachedWorkOrderDetail | null> {
  await ensureCacheBelongsTo(currentUserId);
  const row = await db.workOrderDetails.get(workOrderId);
  return row && row.userId === currentUserId ? row : null;
}

/**
 * Deletes every locally-logged period/article for `workOrderId` belonging
 * to `currentUserId` — called right after a successful `POST
 * /api/work-orders/[id]/finish` (product feedback fix, 2026-09-13). Without
 * this, `handleFinish` re-sending this device's FULL period/article
 * history on any later call for the same order (a retried tap, or
 * re-opening an already-finished order and tapping Finish again) would
 * re-insert everything a second time into the server's `time_entries`/
 * `work_order_articles` — a materially bigger version of the "partial
 * failure between two inserts" risk that route's own doc comment already
 * accepts (QA finding, 2026-09-13). `finishWorkOrderClock`
 * (`lib/time/clocks.ts`) only closes the running period; it was never this
 * file's job to also decide when synced data is safe to delete, so that
 * decision (and this call) lives at the call site instead.
 */
export async function clearSyncedWorkOrderData(workOrderId: string, currentUserId: string): Promise<void> {
  await db.transaction("rw", db.clockPeriods, db.localArticles, async () => {
    const periods = await db.clockPeriods.where({ workOrderId }).toArray();
    const periodIds = periods
      .filter((period) => period.userId === currentUserId && period.id !== undefined)
      .map((period) => period.id as number);
    if (periodIds.length > 0) await db.clockPeriods.bulkDelete(periodIds);

    const articles = await db.localArticles.where({ workOrderId }).toArray();
    const articleIds = articles
      .filter((article) => article.userId === currentUserId && article.id !== undefined)
      .map((article) => article.id as number);
    if (articleIds.length > 0) await db.localArticles.bulkDelete(articleIds);
  });
}
