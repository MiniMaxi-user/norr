"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Callout, Card, EmptyState, Heading, Inline, Skeleton, Stack, Text } from "@yourorg/ui";
import type { BadgeVariant } from "@yourorg/ui";
import { AlertTriangle, Check, ClipboardList, MapPin } from "@yourorg/ui/icons";
import {
  getCachedWorkItems,
  getLastSyncedAt,
  getPendingSyncWorkOrderIds,
  getSignedWorkOrderIds,
  saveCatalog,
  saveWorkItems,
  saveWorkOrderDetail,
  type CachedWorkItem,
} from "@/lib/offline/db";
import { retryPendingSignOffs } from "@/lib/offline/retry-finish";
import {
  formatClockDigits,
  formatClockHoursMinutes,
  getClockSummaryForOrder,
  getRunningWorkOrderId,
  type ClockSummary,
} from "@/lib/time/clocks";
import type { CatalogArticle, WorkOrderDetailResponse } from "@/lib/work-orders/types";
import { deriveTodayWorkItems, selectNowItem, type TodayWorkItem } from "./derive";
import { PullToRefresh } from "./pull-to-refresh";

interface TodayWorkItemsResponse {
  items: CachedWorkItem[];
  syncedAt: string;
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

function locationLabel(site: CachedWorkItem["site"]): string | null {
  if (!site) return null;
  const parts = [site.addressLine1, site.city].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

/** The Today screen's four-way status pill (IMPLEMENTATION.md §6: "In
 * progress → groen, Urgent → rood-tint, Planned → neutraal, Signed →
 * accent-tint") — mutually exclusive, checked in this priority order.
 * `isUrgent` only surfaces its own tag once an order is neither running nor
 * already signed off; a signed-off urgent job isn't "urgent" anymore, and a
 * currently-running job's own green pill already carries more useful
 * information than its priority would. */
function statusPresentation(item: TodayWorkItem): { label: string; variant: BadgeVariant } {
  if (item.flowStatus === "signed") return { label: "Signed", variant: "accent" };
  if (item.flowStatus === "in_progress") return { label: "In progress", variant: "success" };
  if (item.isUrgent) return { label: "Urgent", variant: "danger" };
  return { label: "Planned", variant: "muted" };
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
export function TodayScreen({ currentUserId }: { currentUserId: string }) {
  const [items, setItems] = useState<CachedWorkItem[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const [loading, setLoading] = useState(true);

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

  const sync = useCallback(async () => {
    try {
      const response = await fetch("/api/workitems/today");
      if (!response.ok) {
        throw new Error(`Unexpected response: ${response.status}`);
      }
      const data = (await response.json()) as TodayWorkItemsResponse;
      await saveWorkItems(data.items, data.syncedAt, currentUserId);
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

  if (loading) {
    return (
      <Stack gap="md">
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={120} />
        <Skeleton height={88} />
        <Skeleton height={88} />
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Text
          style={{
            fontSize: "11px",
            letterSpacing: "0.13em",
            textTransform: "uppercase",
            color: "var(--ui-muted-subtle)",
          }}
        >
          {formatTodayDateLabel(new Date())}
        </Text>
        <Heading level={1} style={{ fontFamily: "var(--ui-font-serif)", margin: 0 }}>
          Today&apos;s work
        </Heading>
      </Stack>

      <PullToRefresh onRefresh={sync}>
        <Stack gap="md">
          {syncFailed && (
            <Callout icon={AlertTriangle}>
              {lastSyncedAt
                ? `Couldn't refresh — last synced ${formatSyncedTime(lastSyncedAt)}.`
                : "No connection, and nothing synced yet on this device."}
            </Callout>
          )}

          {todayItems.length === 0 ? (
            !syncFailed && (
              <EmptyState
                icon={<ClipboardList />}
                heading="No work orders scheduled for today."
                text="As soon as work orders are planned for today, they'll show up here."
              />
            )
          ) : (
            <>
              {nowItem && (
                <Stack gap="sm">
                  <Text
                    style={{
                      fontSize: "11px",
                      letterSpacing: "0.13em",
                      textTransform: "uppercase",
                      color: "var(--ui-muted-subtle)",
                    }}
                  >
                    Now
                  </Text>
                  <TodayWorkItemCard
                    item={nowItem}
                    totalMs={signedTotals[nowItem.id]}
                    runningSummary={runningSummary}
                    pendingSync={pendingSyncIds.has(nowItem.id)}
                    emphasized
                  />
                </Stack>
              )}

              <Stack gap="sm">
                <Text
                  style={{
                    fontSize: "11px",
                    letterSpacing: "0.13em",
                    textTransform: "uppercase",
                    color: "var(--ui-muted-subtle)",
                  }}
                >
                  Later today
                </Text>
                {laterItems.length === 0 ? (
                  <Text tone="muted">Nothing else scheduled today.</Text>
                ) : (
                  <Stack gap="sm">
                    {laterItems.map((item) => (
                      <TodayWorkItemCard
                        key={item.id}
                        item={item}
                        totalMs={signedTotals[item.id]}
                        pendingSync={pendingSyncIds.has(item.id)}
                      />
                    ))}
                  </Stack>
                )}
              </Stack>
            </>
          )}

          <Inline justify="center">
            <Text tone="muted">
              {lastSyncedAt ? `Synced ${formatSyncedTime(lastSyncedAt)}` : "Not synced yet"} · pull to refresh
            </Text>
          </Inline>
        </Stack>
      </PullToRefresh>
    </Stack>
  );
}

/** The Now card's gold "Travel/Work time running" bar (Today.png) — same
 * solid-`--ui-accent`-fill + dark-navy-`--ui-accent-fg`-text pairing as
 * `timer-card.tsx`'s sticky timer, for the same contrast reason documented
 * there. Not its own `<Link>`: the whole Now card is already wrapped in one
 * (nesting an anchor inside an anchor is invalid), so "Open" is a plain
 * styled span — the click target is the card. */
function RunningTimeBar({ summary }: { summary: ClockSummary }) {
  if (!summary.runningKind) return null;
  const ms = summary.runningKind === "travel" ? summary.travelMs : summary.workMs;
  const label = summary.runningKind === "travel" ? "Travel time running" : "Work time running";
  return (
    <Inline
      justify="between"
      align="center"
      gap="sm"
      style={{
        borderRadius: "var(--ui-radius-lg)",
        padding: "0.75rem 0.75rem 0.75rem 1rem",
        background: "var(--ui-accent)",
      }}
    >
      <Stack gap="xs">
        <Text style={{ fontSize: "var(--ui-text-sm)", color: "var(--ui-accent-fg)", opacity: 0.75 }}>{label}</Text>
        <Text
          style={{
            fontSize: "2rem",
            fontWeight: 650,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
            color: "var(--ui-accent-fg)",
          }}
        >
          {formatClockDigits(ms)}
        </Text>
      </Stack>
      <span
        style={{
          flexShrink: 0,
          padding: "0.5rem 1.25rem",
          borderRadius: "var(--ui-radius-full)",
          background: "var(--ui-accent-fg)",
          color: "var(--ui-accent)",
          fontWeight: 600,
          fontSize: "var(--ui-text-sm)",
        }}
      >
        Open
      </span>
    </Inline>
  );
}

function TodayWorkItemCard({
  item,
  totalMs,
  runningSummary,
  pendingSync,
  emphasized,
}: {
  item: TodayWorkItem;
  totalMs?: number;
  runningSummary?: ClockSummary | null;
  /** This device has a not-yet-synced "Finish" for this order (bug report,
   * 2026-09-13) — shown as its own badge, independent of `status`/`signed`
   * below (a pending-sync order still reads as "Signed"). */
  pendingSync?: boolean;
  emphasized?: boolean;
}) {
  const location = locationLabel(item.site);
  const status = statusPresentation(item);
  const signed = item.flowStatus === "signed";
  const clientName = item.client?.name ?? "Unknown client";
  const showingRunningBar = Boolean(emphasized && runningSummary?.runningKind);

  const card = emphasized ? (
    <Card interactive={!signed}>
      <Stack gap="sm">
        <Text tone="muted" style={{ fontSize: "var(--ui-text-sm)" }}>
          {item.scheduledAt ? formatTimeLabel(item.scheduledAt) : "No time scheduled"}
        </Text>

        <Stack gap="xs">
          <Text style={{ fontSize: "var(--ui-text-xl)", fontWeight: 650 }}>{clientName}</Text>
          <Text tone="muted">{item.title}</Text>
          {location && (
            <Inline gap="xs" align="center">
              <MapPin aria-hidden width={14} height={14} />
              <Text tone="muted">{location}</Text>
            </Inline>
          )}
        </Stack>

        {showingRunningBar ? (
          <RunningTimeBar summary={runningSummary as ClockSummary} />
        ) : (
          <Inline gap="xs" align="center">
            {signed && <Check aria-hidden width={14} height={14} style={{ color: "var(--ui-success)" }} />}
            <Badge variant={status.variant}>{status.label}</Badge>
            {!signed && item.type && <Badge color={item.type.color}>{item.type.label}</Badge>}
            {pendingSync && <Badge variant="warning">Not synced</Badge>}
          </Inline>
        )}
      </Stack>
    </Card>
  ) : (
    <Card interactive={!signed}>
      <Inline gap="sm" align="start">
        <Text
          style={{
            flexShrink: 0,
            width: "2.75rem",
            fontVariantNumeric: "tabular-nums",
            color: signed ? "var(--ui-muted-subtle)" : "var(--ui-accent)",
          }}
        >
          {item.scheduledAt ? formatTimeLabel(item.scheduledAt) : "—"}
        </Text>
        <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
          <Text>{clientName}</Text>
          <Text tone="muted">
            {signed && totalMs !== undefined
              ? `Signed · ${formatClockHoursMinutes(totalMs)}`
              : [item.title, location].filter(Boolean).join(" — ")}
          </Text>
        </Stack>
        <Inline gap="xs" align="center" style={{ flexShrink: 0 }}>
          {status.variant !== "muted" && <Badge variant={status.variant}>{status.label}</Badge>}
          {pendingSync && <Badge variant="warning">Not synced</Badge>}
        </Inline>
      </Inline>
    </Card>
  );

  // Finished work orders stay visible in the list (so the day still reads
  // as complete) but are no longer clickable — product feedback,
  // 2026-09-12: reopening a work order that's already been finished (and,
  // now, marked `completed` server-side) has nothing left to do.
  if (signed) {
    return (
      <div aria-disabled="true" style={{ opacity: 0.55 }}>
        {card}
      </div>
    );
  }

  const href = `/work-orders/${item.id}`;
  return (
    <Link
      href={href}
      style={{ display: "block" }}
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
