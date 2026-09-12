/**
 * Offline cache for the engineer's "today's work orders" list (issue #169).
 * A single Dexie/IndexedDB database with two tables:
 *
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
 * Read-only cache for now — no offline-write outbox. That's an explicitly
 * separate, later story per the architecture in #167.
 */
import Dexie, { type Table } from "dexie";

export interface CachedWorkItemReference {
  label: string;
  color: string | null;
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
  status: CachedWorkItemReference | null;
  type: CachedWorkItemReference | null;
}

interface MetaRow {
  key: string;
  value: string;
}

const LAST_SYNCED_AT_KEY = "lastSyncedAt";
/** Which engineer's data is currently cached (see the user-scoping note
 * below) — not shown in the UI, purely a guard. */
const USER_ID_KEY = "userId";

class WorkItemsDatabase extends Dexie {
  workitems!: Table<CachedWorkItem, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("norr-pwa");
    this.version(1).stores({
      workitems: "id",
      meta: "key",
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
 */
async function ensureCacheBelongsTo(currentUserId: string): Promise<void> {
  const row = await db.meta.get(USER_ID_KEY);
  if (row?.value === currentUserId) return;
  await db.transaction("rw", db.workitems, db.meta, async () => {
    await db.workitems.clear();
    await db.meta.delete(LAST_SYNCED_AT_KEY);
    await db.meta.put({ key: USER_ID_KEY, value: currentUserId });
  });
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
