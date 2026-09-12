"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Callout, Card, EmptyState, Heading, Input, Inline, Skeleton, Stack, Text } from "@yourorg/ui";
import type { BadgeVariant } from "@yourorg/ui";
import { AlertTriangle, Building2, Check, ClipboardList, Clock, Search } from "@yourorg/ui/icons";
import {
  getCachedWorkItems,
  getLastSyncedAt,
  getSignedWorkOrderIds,
  saveWorkItems,
  type CachedWorkItem,
} from "@/lib/offline/db";
import { formatClockHoursMinutes, getClockSummaryForOrder, getRunningWorkOrderId } from "@/lib/time/clocks";
import { deriveTodayWorkItems, selectNowItem, type TodayFlowStatus, type TodayWorkItem } from "./derive";
import { initialsOf, ProfileSheet } from "./profile-sheet";
import { PullToRefresh } from "./pull-to-refresh";

interface TodayWorkItemsResponse {
  items: CachedWorkItem[];
  syncedAt: string;
}

const STATUS_FILTERS: { value: TodayFlowStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In progress" },
  { value: "signed", label: "Signed" },
];

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

/** Matches the Today screen's search box against title, client name, and
 * site address/city (IMPLEMENTATION.md §6 also lists "ordernummer" — the
 * real schema has no separate human-readable order number distinct from the
 * work order's own `id`/`title`, see `lib/work-orders/types.ts`, so that
 * part of the spec has nothing additional to match against here; a raw UUID
 * isn't something anyone would type into a search box). */
function matchesQuery(item: CachedWorkItem, query: string): boolean {
  if (!query) return true;
  const haystack = [item.title, item.client?.name, item.site?.addressLine1, item.site?.city]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

/**
 * The Today overview (issue #170, IMPLEMENTATION.md §6) — search, status
 * filters, a "Now" card, and the "Later today" list. Supersedes issue
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
  fullName,
  email,
}: {
  currentUserId: string;
  fullName: string | null;
  email: string;
}) {
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

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TodayFlowStatus | "all">("all");
  const [profileOpen, setProfileOpen] = useState(false);

  const refreshLocalState = useCallback(async () => {
    const [running, signed] = await Promise.all([
      getRunningWorkOrderId(currentUserId),
      getSignedWorkOrderIds(currentUserId),
    ]);
    setRunningWorkOrderId(running);
    setSignedWorkOrderIds(signed);
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

  const laterItems = useMemo(() => {
    const withoutNow = todayItems.filter((item) => item.id !== nowItem?.id);
    return withoutNow
      .filter((item) => matchesQuery(item, query))
      .filter((item) => statusFilter === "all" || item.flowStatus === statusFilter);
  }, [todayItems, nowItem, query, statusFilter]);

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
    <>
      <Stack gap="md">
        <Inline justify="between" align="center">
          <Heading level={1} style={{ fontFamily: "var(--ui-font-serif)" }}>
            Today
          </Heading>
          <button
            type="button"
            aria-label="Open profile"
            onClick={() => setProfileOpen(true)}
            style={{
              width: "2.75rem",
              height: "2.75rem",
              flexShrink: 0,
              borderRadius: "var(--ui-radius-full)",
              background: "var(--ui-surface)",
              border: "1px solid var(--ui-border)",
              color: "var(--ui-fg)",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            {initialsOf(fullName, email)}
          </button>
        </Inline>

        <div style={{ position: "relative" }}>
          <Search
            aria-hidden
            width={16}
            height={16}
            style={{
              position: "absolute",
              left: "0.875rem",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--ui-muted-subtle)",
              pointerEvents: "none",
            }}
          />
          <Input
            aria-label="Search work orders"
            placeholder="Search title, client, address…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            style={{ paddingLeft: "2.25rem", minHeight: 44 }}
          />
        </div>

        <div className="ui-pill-filter-row" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setStatusFilter(filter.value)}
              className={
                statusFilter === filter.value ? "ui-pill-filter ui-pill-filter-active" : "ui-pill-filter"
              }
            >
              {filter.label}
            </button>
          ))}
        </div>

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
                    <TodayWorkItemCard item={nowItem} totalMs={signedTotals[nowItem.id]} emphasized />
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
                    <Text tone="muted">No other work orders match.</Text>
                  ) : (
                    <Stack gap="sm">
                      {laterItems.map((item) => (
                        <TodayWorkItemCard key={item.id} item={item} totalMs={signedTotals[item.id]} />
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

      <ProfileSheet
        open={profileOpen}
        onOpenChange={setProfileOpen}
        fullName={fullName}
        email={email}
        currentUserId={currentUserId}
        isOnline={!syncFailed}
      />
    </>
  );
}

function TodayWorkItemCard({
  item,
  totalMs,
  emphasized,
}: {
  item: TodayWorkItem;
  totalMs?: number;
  emphasized?: boolean;
}) {
  const location = locationLabel(item.site);
  const status = statusPresentation(item);
  const signed = item.flowStatus === "signed";

  return (
    <Link href={`/work-orders/${item.id}`} style={{ display: "block", opacity: signed ? 0.55 : 1 }}>
      <Card interactive tone={emphasized && item.isRunning ? "accent" : "default"}>
        <Stack gap="sm">
          <Inline justify="between" align="start" gap="sm">
            <Text>{item.title}</Text>
            <Inline gap="xs" align="center">
              {signed && <Check aria-hidden width={14} height={14} style={{ color: "var(--ui-success)" }} />}
              <Badge variant={status.variant}>{status.label}</Badge>
            </Inline>
          </Inline>

          <Stack gap="xs">
            <Text tone="muted">{item.client?.name ?? "Unknown client"}</Text>
            {location && (
              <Inline gap="xs" align="center">
                <Building2 aria-hidden width={14} height={14} />
                <Text tone="muted">{location}</Text>
              </Inline>
            )}
          </Stack>

          <Inline justify="between" align="center" gap="sm">
            <Inline gap="xs" align="center">
              {item.scheduledAt ? (
                <>
                  <Clock aria-hidden width={14} height={14} />
                  <Text tone="muted">{formatTimeLabel(item.scheduledAt)}</Text>
                </>
              ) : (
                <Text tone="muted">No time scheduled</Text>
              )}
            </Inline>
            {signed && totalMs !== undefined && (
              <Text tone="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatClockHoursMinutes(totalMs)} total
              </Text>
            )}
            {!signed && item.type && <Badge color={item.type.color}>{item.type.label}</Badge>}
          </Inline>
        </Stack>
      </Card>
    </Link>
  );
}
