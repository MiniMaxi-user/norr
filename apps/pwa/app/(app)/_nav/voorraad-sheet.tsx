"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Callout, Dialog, EmptyState, IconButton, Inline, Input, Skeleton, Stack, Text } from "@yourorg/ui";
import type { BadgeVariant } from "@yourorg/ui";
import { AlertTriangle, Boxes, RefreshCw, X } from "@yourorg/ui/icons";
import { getCachedMyStock, getMyStockLastSyncedAt, saveMyStock } from "@/lib/offline/db";
import type { MyStockItem } from "@/lib/inventory/types";

type StockStatus = "danger" | "warning" | "success" | null;

/**
 * Row status color rule — deliberately the SAME business rule as the web
 * app's equivalent view (`app/(app)/inventory/components/warehouse-stock-
 * row.tsx`'s own `resolveStockStatus`, issue #181), reimplemented here
 * rather than shared since apps/pwa can't import across the two separate
 * Next.js projects (same caveat `today-screen.tsx`'s `formatTimeLabel`
 * documents). Keep these two in sync if the rule ever changes: `null` (no
 * badge) when no `minThreshold` is set, red at/below zero or strictly below
 * the threshold, orange within 20% above it, green beyond that margin.
 */
function resolveStockStatus(quantity: number, minThreshold: number | null): StockStatus {
  if (minThreshold === null) return null;
  if (quantity <= 0 || quantity < minThreshold) return "danger";
  const closeMargin = minThreshold * 1.2;
  if (quantity <= closeMargin) return "warning";
  return "success";
}

const STATUS_VARIANT: Record<Exclude<StockStatus, null>, BadgeVariant> = {
  danger: "danger",
  warning: "warning",
  success: "success",
};

const STATUS_LABEL: Record<Exclude<StockStatus, null>, string> = {
  danger: "Laag",
  warning: "Bijna op",
  success: "Op peil",
};

function formatQuantity(value: number): string {
  // Up to 3 decimals, trimmed of trailing zeros — matches the web app's own
  // `formatQuantity` in `warehouse-stock-row.tsx`.
  return String(Math.round(value * 1000) / 1000);
}

function formatSyncedAt(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The "Voorraad" (stock) view (issue #182), reached from the Profile sheet
 * (`profile-sheet.tsx`'s "Voorraad" row) — the engineer's own warehouse
 * stock: article number, description, unit, current quantity, and
 * `minThreshold` framed as "Gewenste voorraad" (this schema has no separate
 * "desired stock" column — see `MyStockItem`'s own doc comment). Never shows
 * a price (AC: "Engineer ziet geen prijs") — `/api/inventory/my-stock`
 * itself never selects one, so there is nothing to omit here either.
 *
 * A `Dialog size="sheet"` opened from `ProfileSheet`, the same shape every
 * other Profile drill-in/sub-action in this app already uses (`ArticleCatalogSheet`,
 * `EditHoursDialog`) — `ProfileSheet` closes itself first (see its own
 * "Voorraad" row handler) rather than stacking two sheets at once.
 *
 * Offline: loads straight from the local `myStock` Dexie cache on open (no
 * network fetch needed just to view what's already synced), and offers a
 * manual "Synchroniseren" button + "Laatste synchronisatie" timestamp (AC:
 * "web is altijd waarheid" — a manual sync is a full overwrite of the local
 * cache from `/api/inventory/my-stock`, never a merge, see `saveMyStock`).
 * Search is a client-side filter over this already-loaded list — this
 * dataset is small and per-engineer, no server round-trip needed.
 */
export function VoorraadSheet({
  open,
  onOpenChange,
  currentUserId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string;
}) {
  const [stock, setStock] = useState<MyStockItem[] | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Loads whatever's already cached the moment the sheet opens — reset back
  // to "loading" every time it's reopened so a stale previous session's list
  // never flashes before this device's own cache is (re-)read.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    void (async () => {
      const [cached, cachedSyncedAt] = await Promise.all([
        getCachedMyStock(currentUserId),
        getMyStockLastSyncedAt(currentUserId),
      ]);
      if (cancelled) return;
      setStock(cached);
      setLastSyncedAt(cachedSyncedAt);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, currentUserId]);

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      const response = await fetch("/api/inventory/my-stock");
      if (!response.ok) throw new Error(`Unexpected response: ${response.status}`);
      const data = (await response.json()) as { stock: MyStockItem[] };
      const syncedAt = new Date().toISOString();
      await saveMyStock(data.stock, syncedAt, currentUserId);
      setStock(data.stock);
      setLastSyncedAt(syncedAt);
    } catch {
      setError("Synchroniseren mislukt. Probeer het opnieuw zodra je online bent.");
    } finally {
      setSyncing(false);
    }
  }

  const filtered = useMemo(() => {
    if (!stock) return [];
    const q = query.trim().toLowerCase();
    if (!q) return stock;
    return stock.filter(
      (item) => item.articleNumber.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
    );
  }, [stock, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sheet">
      <Dialog.Header>
        <div className="ui-dialog-sheet-handle" />
        <Text style={{ fontWeight: 650 }}>Voorraad</Text>
        <IconButton variant="ghost" aria-label="Sluiten" onClick={() => onOpenChange(false)}>
          <X aria-hidden />
        </IconButton>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          <Input
            type="search"
            placeholder="Zoek op artikelnummer of naam"
            aria-label="Zoek in voorraad"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          {error && <Callout icon={AlertTriangle}>{error}</Callout>}

          {stock === null ? (
            <Stack gap="sm">
              <Skeleton height={56} />
              <Skeleton height={56} />
              <Skeleton height={56} />
            </Stack>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Boxes />}
              heading={stock.length === 0 ? "Nog geen voorraad gesynchroniseerd." : "Geen artikelen gevonden."}
            />
          ) : (
            <Stack gap="xs">
              {filtered.map((item) => (
                <StockRow key={item.id} item={item} />
              ))}
            </Stack>
          )}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Stack gap="xs" style={{ width: "100%" }}>
          <Button variant="outline" fullWidth onClick={() => void handleSync()} disabled={syncing}>
            <Inline gap="xs" align="center" justify="center">
              <RefreshCw aria-hidden width={16} height={16} />
              {syncing ? "Synchroniseren…" : "Synchroniseren"}
            </Inline>
          </Button>
          <Text tone="muted" style={{ textAlign: "center" }}>
            {lastSyncedAt ? `Laatste synchronisatie: ${formatSyncedAt(lastSyncedAt)}` : "Nog niet gesynchroniseerd"}
          </Text>
        </Stack>
      </Dialog.Footer>
    </Dialog>
  );
}

function StockRow({ item }: { item: MyStockItem }) {
  const status = resolveStockStatus(item.quantity, item.minThreshold);
  return (
    <div style={{ padding: "0.625rem 0.25rem", borderBottom: "1px solid var(--ui-surface-hover)" }}>
      <Inline justify="between" align="start" gap="sm">
        <Stack gap="xs" style={{ minWidth: 0 }}>
          <Text>{item.description}</Text>
          <Text tone="muted">{item.articleNumber}</Text>
        </Stack>
        {status && <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>}
      </Inline>
      <Inline gap="md" style={{ marginTop: "0.375rem" }}>
        <Text tone="muted">
          Huidige voorraad: <strong>{formatQuantity(item.quantity)}{item.unit ? ` ${item.unit}` : ""}</strong>
        </Text>
        <Text tone="muted">
          Gewenste voorraad: {item.minThreshold === null ? "—" : formatQuantity(item.minThreshold)}
        </Text>
      </Inline>
    </div>
  );
}
