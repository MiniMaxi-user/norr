"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, EmptyState, Callout, IconButton, Inline, Skeleton, Stack, Text } from "@yourorg/ui";
import { AlertTriangle, Building2, ClipboardList, Clock, RefreshCw } from "@yourorg/ui/icons";
import {
  getCachedWorkItems,
  getLastSyncedAt,
  saveWorkItems,
  type CachedWorkItem,
} from "@/lib/offline/db";
import { PullToRefresh } from "./pull-to-refresh";

interface TodayWorkItemsResponse {
  items: CachedWorkItem[];
  syncedAt: string;
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

/** `"do 12 sep 2026, 14:32"` — for the "last synced" notice only. */
function formatSyncedAt(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function locationLabel(site: CachedWorkItem["site"]): string | null {
  if (!site) return null;
  const parts = [site.name, [site.addressLine1, site.city].filter(Boolean).join(", ")].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Today's-work-orders list for the logged-in engineer (issue #169). A
 * client component (not the page itself) because it needs to read/write
 * IndexedDB (Dexie, `lib/offline/db.ts`) and keep working with zero network
 * — both impossible from a Server Component.
 *
 * Three states this reconciles, matching the story's acceptance criteria:
 * 1. Fresh online load — fetch succeeds, cache is replaced, list renders.
 * 2. Offline reload with a prior successful sync — fetch fails, falls back
 *    to the cached list + a "couldn't refresh" notice.
 * 3. Offline reload with no prior sync ever — fetch fails, cache is empty,
 *    a distinct "no connection and nothing cached yet" notice (not the
 *    "confirmed zero work orders today" empty state, which only ever comes
 *    from a *successful* sync returning an empty array).
 *
 * `currentUserId` scopes the offline cache (`lib/offline/db.ts`) to the
 * signed-in engineer — see that file's `ensureCacheBelongsTo` doc comment
 * for why (a shared/handed-down device showing a *different* engineer's
 * cached work orders is a real confidentiality issue, not hypothetical,
 * QA finding on issue #169).
 */
export function WorkItemsList({ currentUserId }: { currentUserId: string }) {
  const [items, setItems] = useState<CachedWorkItem[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // Tracks any in-flight sync AFTER the initial load (pull-to-refresh or the
  // manual refresh button below) — kept separate from `loading` so a manual
  // refresh disables the button without re-showing the initial skeleton.
  const [refreshing, setRefreshing] = useState(false);

  const sync = useCallback(async () => {
    setRefreshing(true);
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
      // acceptance criteria).
      const [cached, cachedSyncedAt] = await Promise.all([
        getCachedWorkItems(currentUserId),
        getLastSyncedAt(currentUserId),
      ]);
      setItems(cached);
      setLastSyncedAt(cachedSyncedAt);
      setSyncFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    void sync();
  }, [sync]);

  if (loading) {
    return (
      <Stack gap="sm">
        <Skeleton height={88} />
        <Skeleton height={88} />
        <Skeleton height={88} />
      </Stack>
    );
  }

  return (
    <PullToRefresh onRefresh={sync}>
      <Stack gap="md">
        {/* Visible fallback for the pull-to-refresh gesture (QA finding on
            issue #169): a swipe is the primary way to re-sync, but anyone
            who can't perform that gesture — switch control, limited
            mobility, a keyboard-only or desktop session — needs a real
            control too. */}
        <Inline justify="end">
          <IconButton
            variant="ghost"
            aria-label="Werkorders verversen"
            onClick={() => void sync()}
            disabled={refreshing}
          >
            <RefreshCw aria-hidden className={refreshing ? "ui-icon-spin" : undefined} />
          </IconButton>
        </Inline>

        {syncFailed && (
          <Callout icon={AlertTriangle}>
            {lastSyncedAt
              ? `Kon niet verversen — laatste synchronisatie: ${formatSyncedAt(lastSyncedAt)}.`
              : "Geen verbinding en nog geen eerder opgehaalde werkorders."}
          </Callout>
        )}

        {items.length === 0 ? (
          !syncFailed && (
            <EmptyState
              icon={<ClipboardList />}
              heading="Geen werkorders gepland voor vandaag."
              text="Zodra er werkorders voor vandaag worden ingepland, verschijnen ze hier."
            />
          )
        ) : (
          <Stack gap="sm">
            {items.map((item) => (
              <WorkItemCard key={item.id} item={item} />
            ))}
          </Stack>
        )}
      </Stack>
    </PullToRefresh>
  );
}

function WorkItemCard({ item }: { item: CachedWorkItem }) {
  const location = locationLabel(item.site);

  return (
    <Card>
      <Stack gap="sm">
        <Inline justify="between" align="start" gap="sm">
          <Text>{item.title}</Text>
          {item.status && (
            <Badge color={item.status.color} variant="muted">
              {item.status.label}
            </Badge>
          )}
        </Inline>

        <Stack gap="xs">
          <Text tone="muted">{item.client?.name ?? "Onbekende klant"}</Text>
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
              <Text tone="muted">Geen tijd ingepland</Text>
            )}
          </Inline>
          {item.type && <Badge color={item.type.color}>{item.type.label}</Badge>}
        </Inline>
      </Stack>
    </Card>
  );
}
