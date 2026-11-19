"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Callout, EmptyState, Skeleton } from "@yourorg/ui";
import {
  PwaBody,
  PwaDayNav,
  PwaFab,
  PwaHeaderRow,
  PwaNote,
  PwaPageHeader,
  PwaScreen,
  PwaSection,
  PwaStack,
  PwaSyncLine,
  WebBadge,
  WebStatusBadge,
  WebTypeBadge,
  type WebStatusTone,
} from "@yourorg/ui/web";
import { AlertTriangle, Check, ChevronRight, ClipboardList, MapPin, Plus } from "@yourorg/ui/icons";
import { useOnline } from "@/lib/use-online";
import {
  getCachedDayWorkItems,
  getCachedWorkItems,
  getLastSyncedAt,
  getPendingSyncWorkOrderIds,
  getSignedWorkOrderIds,
  saveCachedTimeRoundingSettings,
  saveCatalog,
  saveDayWorkItems,
  saveWorkItems,
  saveWorkOrderDetail,
  saveWorkOrderVolumes,
  type CachedWorkItem,
} from "@/lib/offline/db";
import { DAY_NAV_RANGE, dateStringForOffset, dayOffsetFromToday, parseLocalDate } from "@/lib/today-range";
import { retryPendingPhotoUploads } from "@/lib/offline/photo-sync";
import { retryPendingSignOffs } from "@/lib/offline/retry-finish";
import {
  formatClockDigits,
  formatClockHoursMinutes,
  getClockSummaryForOrder,
  getRunningWorkOrderId,
  type ClockSummary,
} from "@/lib/time/clocks";
import type { CatalogArticle, TimeRoundingSettings, WorkOrderDetailResponse } from "@/lib/work-orders/types";
import type { WorkOrderVolumesResponse } from "@/lib/asset-volumes/types";
import { deriveTodayWorkItems, selectNowItem, type TodayWorkItem } from "./derive";
import { PullToRefresh } from "./pull-to-refresh";

interface TodayWorkItemsResponse {
  items: CachedWorkItem[];
  syncedAt: string;
  /** Issue #198 — the caller's org's travel/work minimum + rounding
   * settings, cached via `saveCachedTimeRoundingSettings` below so it's
   * available offline before any specific work order is opened. */
  timeRoundingSettings: TimeRoundingSettings;
}

/** How many work orders' `/api/work-orders/{id}` + shell-prefetch requests
 * run at once during `warmOfflineCaches` below — bounded (bug report,
 * 2026-09-13: "check of alle items netjes binnengehaald worden") so a 20-30
 * job day doesn't fire that many requests simultaneously, but still fast
 * enough that the warm-up finishes in the background well before the
 * engineer would plausibly go offline and tap into one. Each item in a
 * batch itself fires one shell-prefetch per `WORK_ORDER_SHELL_SECTIONS`
 * entry (bug report, 2026-09-14) — bounded per-item concurrency, not an
 * additional multiplier on this constant. */
const PREFETCH_BATCH_SIZE = 4;

/** Every `?section=` this device needs its own SHELL_CACHE entry for, per
 * work order (bug report, 2026-09-14, see `sw.js`'s own top-of-file comment
 * on this same date) — matches `WORK_ORDER_SECTIONS` in `_nav/bottom-bar.tsx`
 * exactly (that file can't be imported from here, separate route group), plus
 * the bare no-`?section=` URL Today's own work-order links use (defaults to
 * "home" client-side, but is a DIFFERENT cache key from `?section=home`
 * now that `shellCacheKey` keys by the full request again). */
const WORK_ORDER_SHELL_SECTIONS = ["home", "work", "hours", "articles", "photos", "sign"];

/** Posts `{ type: "PREFETCH_SHELL", url }` to the active service worker so
 * it can warm `SHELL_CACHE` for `url` via its own same-origin `fetch()` (see
 * `sw.js`'s `message` handler) — a plain page-context `fetch()` here would
 * NOT be intercepted as a navigation and so would never populate that
 * cache. Degrades to a no-op, never throws, if there's no service worker
 * yet (unsupported browser) or it isn't controlling this page yet (a very
 * first install, before `clients.claim()` has run) — the next successful
 * sync retries. */
async function prefetchShell(url: string): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.ready;
  } catch {
    return;
  }
  navigator.serviceWorker.controller?.postMessage({ type: "PREFETCH_SHELL", url });
}

/**
 * Warms every offline cache a work order needs to actually open and be
 * usable with no network (bug report, 2026-09-13) — called after every
 * successful `/api/workitems/today` fetch, not awaited by the caller (this
 * runs in the background; the Today list itself is already usable the
 * moment `saveWorkItems` above resolves):
 * - `/api/work-orders/{id}` -> `workOrderDetails` (so `getCachedWorkOrderDetail`
 *   has data for every scheduled job, not just ones already opened once).
 * - `/api/work-orders/{id}/volumes` -> `workOrderVolumes` (issue #225: counters
 *   + latest readings, so the Volumes block and the Sign checklist work offline).
 * - the work order's shell HTML, for EVERY section (`WORK_ORDER_SHELL_SECTIONS`,
 *   bug report 2026-09-14 — a section's shell must be cached under its own
 *   exact URL now, see `sw.js`'s top-of-file comment on that date) ->
 *   `SHELL_CACHE`, via the service worker message above, so a first-time
 *   OFFLINE navigation into any of them can be served at all.
 * - `/api/articles/catalog` -> `catalog`, once per sync (tenant-wide
 *   reference data, not per-work-order) so the "Add article" sheet works
 *   offline too.
 * Runs in bounded batches (`PREFETCH_BATCH_SIZE`), and every individual
 * fetch/cache-write is wrapped so one failure (a single 404, a mid-sync
 * disconnect) never aborts the rest of the batch.
 */
async function warmOfflineCaches(items: CachedWorkItem[], currentUserId: string): Promise<void> {
  try {
    const response = await fetch("/api/articles/catalog");
    if (response.ok) {
      const data = (await response.json()) as { articles: CatalogArticle[] };
      await saveCatalog(data.articles, currentUserId);
    }
  } catch {
    // No network (unlikely right after a successful today-list fetch, but
    // not impossible) — the catalog sheet still falls back to whatever it
    // cached last time.
  }

  for (let i = 0; i < items.length; i += PREFETCH_BATCH_SIZE) {
    const batch = items.slice(i, i + PREFETCH_BATCH_SIZE);
    await Promise.all(
      batch.map(async (item) => {
        try {
          const response = await fetch(`/api/work-orders/${item.id}`);
          if (response.ok) {
            const detail = (await response.json()) as WorkOrderDetailResponse;
            await saveWorkOrderDetail(item.id, detail, currentUserId);
          }
        } catch {
          // Leaves whatever was cached before (or nothing) — a later sync
          // retries every item again from scratch.
        }
        // Issue #225: counters + latest values, so volumes work offline.
        try {
          const volumesResponse = await fetch(`/api/work-orders/${item.id}/volumes`);
          if (volumesResponse.ok) {
            await saveWorkOrderVolumes(item.id, (await volumesResponse.json()) as WorkOrderVolumesResponse, currentUserId);
          }
        } catch {
          // Leaves whatever was cached before; the next sync retries.
        }
        await prefetchShell(`/work-orders/${item.id}`);
        await Promise.all(
          WORK_ORDER_SHELL_SECTIONS.map((section) => prefetchShell(`/work-orders/${item.id}?section=${section}`)),
        );
      }),
    );
  }
}

/** `"HH:mm"` — reimplementation of the root app's own one-liner
 * (`app/(app)/planning/date-utils.ts`'s `formatTimeLabel`); apps/pwa can't
 * import across the two separate Next.js projects, see that file's own doc
 * comment for the same caveat already applied in `lib/today-range.ts`. */
function formatTimeLabel(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `"09:12"` — for the sync line only (IMPLEMENTATION.md §6: "Synced 09:12
 * · pull to refresh"), deliberately just the time, not the full date the
 * old Dutch-copy `Callout` used. */
function formatSyncedTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `"Friday 12 September"` (rendered as "FRIDAY 12 SEPTEMBER" via CSS
 * `text-transform`, not `.toUpperCase()`, so it stays correct for any
 * locale) — the header's date line above "Today's work"
 * (`docs/designinstructieskanweg/Today.png`). Built from two separate
 * `Intl.DateTimeFormat` calls, not one combined `weekday`+`day`+`month`
 * formatter, because at least Chrome's `en-GB` inserts a comma after the
 * weekday ("Friday, 12 September") that the reference design doesn't have. */
function formatTodayDateLabel(date: Date): string {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" }).format(date);
  return `${weekday} ${dayMonth}`;
}

/** `"Wed 20 Nov"` — the day switcher's label (issue #229). */
function formatDayNavLabel(date: Date): string {
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date);
  const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
  return `${weekday} ${dayMonth}`;
}

/** Overline above another day's title: "Tomorrow", "2 days ago", ... */
function relativeDayLabel(offset: number): string {
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  return offset > 0 ? `In ${offset} days` : `${-offset} days ago`;
}

/** Issue #229: background-caches the six other days' lists (list only — the
 * list endpoint never checks a work order out) so they open offline. */
async function prefetchOtherDayLists(currentUserId: string): Promise<void> {
  for (let offset = -DAY_NAV_RANGE; offset <= DAY_NAV_RANGE; offset += 1) {
    if (offset === 0) continue;
    const date = dateStringForOffset(offset);
    try {
      const response = await fetch(`/api/workitems/today?date=${date}`);
      if (!response.ok) continue;
      const data = (await response.json()) as TodayWorkItemsResponse;
      await saveDayWorkItems(date, data.items, data.syncedAt, currentUserId);
    } catch {
      return; // offline / mid-sync disconnect — the next sync retries.
    }
  }
}

function locationLabel(site: CachedWorkItem["site"]): string | null {
  if (!site) return null;
  const parts = [site.addressLine1, site.city].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

/** The Today screen's four-way status badge (IMPLEMENTATION.md §6) —
 * mutually exclusive, checked in this priority order. Calm grey for the
 * normal states (Planned, Signed), coloured only for what needs attention
 * (DS Badge rules): In progress (the running step) and Urgent.
 * `isUrgent` only surfaces its own tag once an order is neither running nor
 * already signed off; a signed-off urgent job isn't "urgent" anymore, and a
 * currently-running job's own badge carries more useful information than its
 * priority would. */
function statusPresentation(item: TodayWorkItem): { label: string; tone: WebStatusTone } {
  if (item.flowStatus === "signed") return { label: "Signed", tone: "neutral" };
  if (item.flowStatus === "in_progress") return { label: "In progress", tone: "info" };
  if (item.isUrgent) return { label: "Urgent", tone: "danger" };
  return { label: "Planned", tone: "neutral" };
}

/** A breakdown ("storing") work order — the red "N breakdown" badge in the
 * header. Matched on the activity type's label (the Today API carries the
 * type's label + colour, not its raw value), same two spellings the web
 * Planning backlog recognises. */
function isBreakdown(item: Pick<CachedWorkItem, "type">): boolean {
  return /^(breakdown|storing)$/i.test(item.type?.label?.trim() ?? "");
}

/**
 * The Today overview (issue #170, IMPLEMENTATION.md §6) — a "Now" card and a
 * "Later today" list (product feedback, 2026-09-12 removed the search box
 * and status-filter row IMPLEMENTATION.md §6 originally specced — the
 * product owner decided against them for this screen). Supersedes issue
 * #169's plain flat list (still the same underlying fetch/cache/offline
 * reconciliation this file inherits, see the three states documented
 * below) with the full designed screen: local-only state (a running clock,
 * a local sign-off — `derive.ts`) folded together with the real, synced
 * `work_orders` rows into one simplified Planned/In progress/Signed model.
 *
 * Three states this reconciles, matching issue #169's original acceptance
 * criteria (still true here, the fetch/cache layer didn't change):
 * 1. Fresh online load — fetch succeeds, cache is replaced, list renders.
 * 2. Offline reload with a prior successful sync — fetch fails, falls back
 *    to the cached list + a "couldn't refresh" notice.
 * 3. Offline reload with no prior sync ever — fetch fails, cache is empty,
 *    a distinct "no connection and nothing cached yet" notice.
 *
 * `currentUserId` scopes the offline cache (`lib/offline/db.ts`) to the
 * signed-in engineer — see that file's `ensureCacheBelongsTo` doc comment.
 */
export function TodayScreen({
  currentUserId,
  createdNumber,
}: {
  currentUserId: string;
  /** Number of a work order just created and sent to planning (issue #223,
   * `?created=` on the URL) — shown once as a confirmation. */
  createdNumber?: string | null;
}) {
  const router = useRouter();
  const online = useOnline();
  const [createdNotice] = useState(createdNumber ?? null);
  useEffect(() => {
    if (createdNumber) router.replace("/today");
  }, [createdNumber, router]);

  const [items, setItems] = useState<CachedWorkItem[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  // Issue #229 — day navigation (today-3 ... today+3). `todayDate` is fixed
  // at mount; `selectedDate === todayDate` keeps today's exact behaviour.
  const [todayDate] = useState(() => dateStringForOffset(0));
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const selectedDateRef = useRef(selectedDate);
  const isToday = selectedDate === todayDate;
  const dayOffset = dayOffsetFromToday(selectedDate) ?? 0;
  const selectedDateObj = parseLocalDate(selectedDate) ?? new Date();

  const goToDay = useCallback((offset: number) => {
    const next = dateStringForOffset(offset);
    selectedDateRef.current = next;
    setItems([]);
    setSyncFailed(false);
    setLoading(true);
    setSelectedDate(next);
  }, []);

  // This device's own local state — a running clock (at most one, app-wide)
  // and every work order signed off locally — folded into the derived
  // Planned/In progress/Signed model below (`derive.ts`). Re-read every time
  // `items` changes (a fresh sync/refresh is exactly when a stale running-
  // order id would otherwise linger) as well as right after mount.
  const [runningWorkOrderId, setRunningWorkOrderId] = useState<string | null>(null);
  const [signedWorkOrderIds, setSignedWorkOrderIds] = useState<ReadonlySet<string>>(new Set());
  const [signedTotals, setSignedTotals] = useState<Record<string, number>>({});
  // Every work order this device has a still-not-synced "Finish" for (bug
  // report, 2026-09-13) — drives the card's "Not synced" badge. Re-read
  // alongside `signedWorkOrderIds`/`runningWorkOrderId` above since a
  // successful background retry (`retryPendingSignOffs`) changes it without
  // any network re-sync.
  const [pendingSyncIds, setPendingSyncIds] = useState<ReadonlySet<string>>(new Set());

  const refreshLocalState = useCallback(async () => {
    const [running, signed, pendingSync] = await Promise.all([
      getRunningWorkOrderId(currentUserId),
      getSignedWorkOrderIds(currentUserId),
      getPendingSyncWorkOrderIds(currentUserId),
    ]);
    setRunningWorkOrderId(running);
    setSignedWorkOrderIds(signed);
    setPendingSyncIds(pendingSync);
  }, [currentUserId]);

  // Other days: read-only list, cached per day, never warms detail caches
  // (opening `/api/work-orders/{id}` checks the order out).
  const syncDay = useCallback(
    async (date: string) => {
      try {
        const response = await fetch(`/api/workitems/today?date=${date}`);
        if (!response.ok) {
          throw new Error(`Unexpected response: ${response.status}`);
        }
        const data = (await response.json()) as TodayWorkItemsResponse;
        await saveDayWorkItems(date, data.items, data.syncedAt, currentUserId);
        if (selectedDateRef.current !== date) return;
        setItems(data.items);
        setLastSyncedAt(data.syncedAt);
        setSyncFailed(false);
      } catch {
        const cached = await getCachedDayWorkItems(date, currentUserId);
        if (selectedDateRef.current !== date) return;
        setItems(cached?.items ?? []);
        setLastSyncedAt(cached?.syncedAt ?? null);
        setSyncFailed(true);
      } finally {
        if (selectedDateRef.current === date) setLoading(false);
      }
    },
    [currentUserId],
  );

  const syncToday = useCallback(async () => {
    try {
      const response = await fetch("/api/workitems/today");
      if (!response.ok) {
        throw new Error(`Unexpected response: ${response.status}`);
      }
      const data = (await response.json()) as TodayWorkItemsResponse;
      await saveWorkItems(data.items, data.syncedAt, currentUserId);
      await saveCachedTimeRoundingSettings(data.timeRoundingSettings, currentUserId);
      setItems(data.items);
      setLastSyncedAt(data.syncedAt);
      setSyncFailed(false);
      // Not awaited — this device's Today list is already usable the
      // moment `saveWorkItems` above resolves; the offline-cache warm-up
      // for every work order/the catalog runs in the background (bug
      // report, 2026-09-13, see `warmOfflineCaches`'s own doc comment).
      void warmOfflineCaches(data.items, currentUserId);
      // Bug report, 2026-09-14: re-warms `/today`'s own SHELL_CACHE entry on
      // every successful authenticated sync, not just at service-worker
      // install time — self-heals a previously-poisoned entry (see
      // `sw.js`'s top-of-file comment on this same date) and keeps it fresh
      // for engineers who mostly navigate via soft `Link` clicks, which
      // never touch SHELL_CACHE on their own.
      void prefetchShell("/today");
      void prefetchOtherDayLists(currentUserId);
    } catch {
      // Any failure — network error or non-2xx — falls back to whatever's
      // cached locally; never a bare error screen (issue #169's offline
      // acceptance criteria, still honored here).
      const [cached, cachedSyncedAt] = await Promise.all([
        getCachedWorkItems(currentUserId),
        getLastSyncedAt(currentUserId),
      ]);
      setItems(cached);
      setLastSyncedAt(cachedSyncedAt);
      setSyncFailed(true);
    } finally {
      setLoading(false);
    }
    await refreshLocalState();
  }, [currentUserId, refreshLocalState]);

  const sync = useCallback(async () => {
    if (selectedDate === todayDate) {
      await syncToday();
    } else {
      await syncDay(selectedDate);
    }
  }, [selectedDate, todayDate, syncToday, syncDay]);

  // Retries any "Finish workitem" that failed to reach the server (bug
  // report, 2026-09-13) — once on mount, and again on every `online` event,
  // since that's the moment a retry is actually likely to succeed. Runs
  // independently of `sync()` above (a pending Finish has nothing to do
  // with whether today's list itself needs refreshing) and always finishes
  // by re-reading local state so a just-cleared badge disappears
  // immediately rather than waiting for the next unrelated re-render.
  useEffect(() => {
    let cancelled = false;
    async function retryAndRefresh() {
      await retryPendingSignOffs(currentUserId);
      // Issue #224: also flush any queued work order photos.
      await retryPendingPhotoUploads(currentUserId);
      if (!cancelled) await refreshLocalState();
    }
    void retryAndRefresh();
    function onOnline() {
      void retryAndRefresh();
    }
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [currentUserId, refreshLocalState]);

  useEffect(() => {
    void sync();
  }, [sync]);

  // Re-check local state (running clock / signed set) whenever the tab
  // regains focus — covers "finished and signed a job in the work-order
  // detail screen, then tapped Today in the bottom bar" without requiring a
  // full network re-sync just to pick up a purely local change.
  useEffect(() => {
    function onFocus() {
      void refreshLocalState();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshLocalState]);

  const todayItems = useMemo(
    () => deriveTodayWorkItems(items, runningWorkOrderId, signedWorkOrderIds),
    [items, runningWorkOrderId, signedWorkOrderIds],
  );
  const nowItem = useMemo(() => selectNowItem(todayItems), [todayItems]);

  // Real elapsed totals for Signed rows' subline (IMPLEMENTATION.md §6:
  // "zijn werkelijke totaaltijd als subregel") — fetched once per newly-
  // signed id rather than kept ticking, since a signed order's clock is
  // closed for good (`finishWorkOrderClock`) and its total can't change.
  useEffect(() => {
    const ids = todayItems.filter((item) => item.flowStatus === "signed").map((item) => item.id);
    const missing = ids.filter((id) => !(id in signedTotals));
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(
      missing.map(async (id) => {
        const summary = await getClockSummaryForOrder(id, currentUserId, Date.now());
        return [id, summary.travelMs + summary.workMs] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setSignedTotals((current) => ({ ...current, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signedTotals` is read, not a dependency: this effect only ever ADDS missing entries, re-running it because it changed would just recompute the same values.
  }, [todayItems, currentUserId]);

  const laterItems = useMemo(
    () => todayItems.filter((item) => item.id !== nowItem?.id),
    [todayItems, nowItem],
  );

  // The Now card's gold "Travel/Work time running" bar (Today.png) — ticks
  // every second while the Now item has a running clock, cleared the moment
  // it doesn't (finished, or the Now item changed). Recomputed from
  // `startedAt` each tick via `computeClockSummary`, same "never accumulate
  // on an interval" rule `lib/time/clocks.ts`'s own doc comment spells out —
  // this just re-reads that fresh value on a 1s cadence to paint it.
  const [runningSummary, setRunningSummary] = useState<ClockSummary | null>(null);
  const nowItemId = nowItem?.isRunning ? nowItem.id : null;
  useEffect(() => {
    if (!nowItemId) {
      setRunningSummary(null);
      return;
    }
    let cancelled = false;
    async function tick() {
      const summary = await getClockSummaryForOrder(nowItemId as string, currentUserId, Date.now());
      if (!cancelled) setRunningSummary(summary);
    }
    void tick();
    const interval = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [nowItemId, currentUserId]);

  const dateLabel = formatTodayDateLabel(new Date());
  const headerOverline = isToday ? dateLabel : relativeDayLabel(dayOffset);
  const headerTitle = isToday ? "Today" : formatTodayDateLabel(selectedDateObj);
  const dayNav = (
    <PwaDayNav
      label={formatDayNavLabel(selectedDateObj)}
      onPrev={() => goToDay(dayOffset - 1)}
      onNext={() => goToDay(dayOffset + 1)}
      prevDisabled={dayOffset <= -DAY_NAV_RANGE}
      nextDisabled={dayOffset >= DAY_NAV_RANGE}
      onToday={isToday ? undefined : () => goToDay(0)}
    />
  );

  if (loading) {
    return (
      <PwaScreen>
        <PwaPageHeader overline={headerOverline} title={headerTitle}>
          {dayNav}
        </PwaPageHeader>
        <PwaBody>
          <Skeleton height={44} />
          <Skeleton height={120} />
          <Skeleton height={88} />
          <Skeleton height={88} />
        </PwaBody>
      </PwaScreen>
    );
  }

  const breakdownCount = todayItems.filter(isBreakdown).length;

  return (
    <PwaScreen>
      <PwaPageHeader overline={headerOverline} title={headerTitle}>
        {dayNav}
        <PwaHeaderRow>
          <WebBadge size="touch">
            {todayItems.length} {todayItems.length === 1 ? "work order" : "work orders"}
          </WebBadge>
          {breakdownCount > 0 && (
            <WebBadge size="touch" variant="danger">
              {breakdownCount} {breakdownCount === 1 ? "breakdown" : "breakdowns"}
            </WebBadge>
          )}
        </PwaHeaderRow>
      </PwaPageHeader>

      <PwaBody>
        <PullToRefresh onRefresh={sync}>
          <PwaStack>
            {createdNotice && (
              <Callout icon={Check}>Work order {createdNotice} created and sent to planning.</Callout>
            )}
            {!online && <Callout icon={AlertTriangle}>You need an internet connection to create a work order.</Callout>}

            {!isToday && <PwaNote>View only — work orders open on their day.</PwaNote>}

            {syncFailed && (
              <Callout icon={AlertTriangle}>
                {lastSyncedAt
                  ? `Couldn't refresh — last synced ${formatSyncedTime(lastSyncedAt)}.`
                  : isToday
                    ? "No connection, and nothing synced yet on this device."
                    : "Not synced yet — connect to load this day."}
              </Callout>
            )}

            {todayItems.length === 0 ? (
              !syncFailed && (
                <EmptyState
                  icon={<ClipboardList />}
                  heading={isToday ? "No work orders scheduled for today." : "No work orders scheduled for this day."}
                  text={
                    isToday
                      ? "As soon as work orders are planned for today, they'll show up here."
                      : "Work orders planned for this day will show up here."
                  }
                />
              )
            ) : !isToday ? (
              <PwaSection label="Scheduled">
                <PwaStack gap="sm">
                  {todayItems.map((item) => (
                    <TodayWorkItemCard key={item.id} item={item} totalMs={signedTotals[item.id]} readOnly />
                  ))}
                </PwaStack>
              </PwaSection>
            ) : (
              <>
                {nowItem && (
                  <PwaSection label="Now">
                    <TodayWorkItemCard
                      item={nowItem}
                      totalMs={signedTotals[nowItem.id]}
                      runningSummary={runningSummary}
                      pendingSync={pendingSyncIds.has(nowItem.id)}
                      emphasized
                    />
                  </PwaSection>
                )}

                <PwaSection label="Later today">
                  {laterItems.length === 0 ? (
                    <PwaNote>Nothing else scheduled today.</PwaNote>
                  ) : (
                    <PwaStack gap="sm">
                      {laterItems.map((item) => (
                        <TodayWorkItemCard
                          key={item.id}
                          item={item}
                          totalMs={signedTotals[item.id]}
                          pendingSync={pendingSyncIds.has(item.id)}
                        />
                      ))}
                    </PwaStack>
                  )}
                </PwaSection>
              </>
            )}

            <PwaSyncLine>
              {lastSyncedAt ? `Synced ${formatSyncedTime(lastSyncedAt)}` : "Not synced yet"} · pull down to refresh
            </PwaSyncLine>
          </PwaStack>
        </PullToRefresh>
      </PwaBody>
      {/* Creating a work order needs a connection (issue #223) — disabled
          offline, the explanation is the callout in the body. */}
      <PwaFab disabled={!online} onClick={() => router.push("/work-orders/new")}>
        <Plus aria-hidden />
        Work order
      </PwaFab>
    </PwaScreen>
  );
}

/** The Now card's "Travel/Work time running" strip (Today.png) — a navy
 * surface with a gold action (gold is for dark surfaces, DS 08), the running
 * digits in mono. Not its own `<Link>`: the whole Now card is already
 * wrapped in one (nesting an anchor inside an anchor is invalid), so "Open" is
 * a plain styled span — the click target is the card. */
function RunningTimeBar({ summary }: { summary: ClockSummary }) {
  if (!summary.runningKind) return null;
  const ms = summary.runningKind === "travel" ? summary.travelMs : summary.workMs;
  const label = summary.runningKind === "travel" ? "Travel time running" : "Work time running";
  return (
    <div className="pwa-running">
      <span>
        <span className="pwa-running-label">{label}</span>
        <span className="pwa-running-digits">{formatClockDigits(ms)}</span>
      </span>
      <span className="pwa-running-open">Open</span>
    </div>
  );
}

function TodayWorkItemCard({
  item,
  totalMs,
  runningSummary,
  pendingSync,
  emphasized,
  readOnly,
}: {
  item: TodayWorkItem;
  totalMs?: number;
  runningSummary?: ClockSummary | null;
  /** This device has a not-yet-synced "Finish" for this order (bug report,
   * 2026-09-13) — shown as its own badge, independent of `status`/`signed`
   * below (a pending-sync order still reads as "Signed"). */
  pendingSync?: boolean;
  emphasized?: boolean;
  /** Issue #229: another day's card — no link, no chevron (opening a work
   * order checks it out, so it only opens on its own day). */
  readOnly?: boolean;
}) {
  const location = locationLabel(item.site);
  const status = statusPresentation(item);
  const signed = item.flowStatus === "signed";
  const clientName = item.client?.name ?? "Unknown client";
  const showingRunningBar = Boolean(emphasized && runningSummary?.runningKind);
  const timeLabel = item.scheduledAt ? formatTimeLabel(item.scheduledAt) : emphasized ? "No time scheduled" : "—";
  // Items cached before #218 lack workOrderNumber until the next sync.
  const number = item.workOrderNumber ?? "";

  // "Now" = large card, "Later today" = compact list card (DS 08 section 4).
  const card = emphasized ? (
    <>
      <div className="pwa-work-card-top">
        <span className="pwa-work-card-time">{timeLabel}</span>
        {!signed && <ChevronRight aria-hidden className="pwa-work-card-chevron" />}
      </div>
      <p className="pwa-work-card-client">{clientName}</p>
      <p className="pwa-work-card-ref">
        {number && <span className="pwa-work-card-number">{number}</span>}
        {item.externalReference && <span>{item.externalReference}</span>}
      </p>
      {location && (
        <p className="pwa-work-card-address">
          <MapPin aria-hidden />
          {location}
        </p>
      )}

      {showingRunningBar ? (
        <RunningTimeBar summary={runningSummary as ClockSummary} />
      ) : (
        <div className="pwa-work-card-foot">
          {!signed && item.type && (
            <WebTypeBadge size="touch" color={item.type.color}>
              {item.type.label}
            </WebTypeBadge>
          )}
          <WebStatusBadge tone={status.tone} size="touch">
            {status.label}
          </WebStatusBadge>
          {pendingSync && (
            <WebStatusBadge tone="warning" size="touch">
              Not synced
            </WebStatusBadge>
          )}
        </div>
      )}
    </>
  ) : (
    <>
      <span className="pwa-work-card-time">{timeLabel}</span>
      <div className="pwa-work-card-main">
        <p className="pwa-work-card-client">{clientName}</p>
        {signed && totalMs !== undefined ? (
          <p className="pwa-work-card-ref">{`Signed · ${formatClockHoursMinutes(totalMs)}`}</p>
        ) : (
          <>
            <p className="pwa-work-card-ref">
              {number && <span className="pwa-work-card-number">{number}</span>}
              {item.externalReference && <span>{item.externalReference}</span>}
            </p>
            {location && (
              <p className="pwa-work-card-address">
                <MapPin aria-hidden />
                {location}
              </p>
            )}
          </>
        )}
        <div className="pwa-work-card-foot">
          {!signed && item.type && (
            <WebTypeBadge size="touch" color={item.type.color}>
              {item.type.label}
            </WebTypeBadge>
          )}
          {status.tone !== "neutral" && (
            <WebStatusBadge tone={status.tone} size="touch">
              {status.label}
            </WebStatusBadge>
          )}
          {pendingSync && (
            <WebStatusBadge tone="warning" size="touch">
              Not synced
            </WebStatusBadge>
          )}
        </div>
      </div>
      {!signed && !readOnly && <ChevronRight aria-hidden className="pwa-work-card-chevron" />}
    </>
  );

  // Finished work orders stay visible in the list (so the day still reads
  // as complete) but are no longer clickable — product feedback,
  // 2026-09-12: reopening a work order that's already been finished (and,
  // now, marked `completed` server-side) has nothing left to do.
  if (signed || readOnly) {
    return (
      <div className="pwa-work-card" data-compact={emphasized ? undefined : "true"} aria-disabled={signed ? "true" : undefined}>
        {card}
      </div>
    );
  }

  const href = `/work-orders/${item.id}`;
  return (
    <Link
      href={href}
      className="pwa-work-card"
      data-compact={emphasized ? undefined : "true"}
      onClick={(event) => {
        // Bug report, 2026-09-13: a first-time offline open of a work order
        // used to fail outright — Next's client-side transition fetches a
        // fresh RSC payload for the destination route, which isn't (and
        // structurally can't be) served by `sw.js`'s navigation fallback
        // (that only ever sees real `mode: "navigate"` browser requests).
        // Forcing a genuine document navigation here instead lets the
        // browser issue exactly that kind of request, which the shell this
        // order's sync-time prefetch warmed (`warmOfflineCaches` above) CAN
        // answer. Only forced while actually offline — online, the normal
        // client-side transition is faster and stays.
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          event.preventDefault();
          window.location.assign(href);
        }
      }}
    >
      {card}
    </Link>
  );
}
