"use client";

import { useEffect, useMemo, useState } from "react";
import { Callout, Dialog, EmptyState, IconButton, Input, Skeleton } from "@yourorg/ui";
import { PwaNote, PwaStack, WebButton, WebStatusBadge, type WebStatusTone } from "@yourorg/ui/web";
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

// Calm for the normal state, coloured only for what needs attention (DS
// Badge rules): "OK" stays grey, low / near-threshold stock is coloured.
const STATUS_TONE: Record<Exclude<StockStatus, null>, WebStatusTone> = {
  danger: "danger",
  warning: "warning",
  success: "neutral",
};

const STATUS_LABEL: Record<Exclude<StockStatus, null>, string> = {
  danger: "Low stock",
  warning: "Near threshold",
  success: "OK",
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
 * The Stock view (issue #182), reached from the Profile sheet
 * (`profile-sheet.tsx`'s "Stock" row) — the engineer's own warehouse
 * stock: article number, description, unit, current quantity ("Current"),
 * and `minThreshold` ("Min" — this schema has no separate "desired stock"
 * column, see `MyStockItem`'s own doc comment; labels translated to English
 * per product request, 2026-09-14). Never shows a price (AC: "Engineer ziet
 * geen prijs") — `/api/inventory/my-stock` itself never selects one, so
 * there is nothing to omit here either.
 *
 * A `Dialog size="sheet"` opened from `ProfileSheet`, the same shape every
 * other Profile drill-in/sub-action in this app already uses (`ArticleCatalogSheet`,
 * `EditHoursDialog`) — `ProfileSheet` closes itself first (see its own
 * "Stock" row handler) rather than stacking two sheets at once.
 *
 * Offline: loads straight from the local `myStock` Dexie cache on open (no
 * network fetch needed just to view what's already synced), and offers a
 * manual "Sync" button + "Last synced" timestamp (AC: "web is altijd
 * waarheid" — a manual sync is a full overwrite of the local cache from
 * `/api/inventory/my-stock`, never a merge, see `saveMyStock`). Search is a
 * client-side filter over this already-loaded list — this dataset is small
 * and per-engineer, no server round-trip needed.
 */
export function StockSheet({
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
      setError("Sync failed. Try again once you're online.");
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
        <p className="pwa-sheet-title">Stock</p>
        <IconButton variant="ghost" aria-label="Close" onClick={() => onOpenChange(false)}>
          <X aria-hidden />
        </IconButton>
      </Dialog.Header>
      <Dialog.Body>
        <PwaStack>
          <Input
            type="search"
            placeholder="Search by article number or name"
            aria-label="Search stock"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          {error && <Callout icon={AlertTriangle}>{error}</Callout>}

          {stock === null ? (
            <PwaStack gap="sm">
              <Skeleton height={56} />
              <Skeleton height={56} />
              <Skeleton height={56} />
            </PwaStack>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Boxes />}
              heading={stock.length === 0 ? "No stock synced yet." : "No articles found."}
            />
          ) : (
            <div className="pwa-pick-list">
              {filtered.map((item) => (
                <StockRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </PwaStack>
      </Dialog.Body>
      <Dialog.Footer>
        <PwaStack gap="sm" className="pwa-fill">
          <WebButton size="touch" block onClick={() => void handleSync()} disabled={syncing}>
            <RefreshCw aria-hidden />
            {syncing ? "Syncing…" : "Sync"}
          </WebButton>
          <PwaNote align="center">{lastSyncedAt ? `Last synced: ${formatSyncedAt(lastSyncedAt)}` : "Not synced yet"}</PwaNote>
        </PwaStack>
      </Dialog.Footer>
    </Dialog>
  );
}

function StockRow({ item }: { item: MyStockItem }) {
  const status = resolveStockStatus(item.quantity, item.minThreshold);
  return (
    <div className="pwa-pick-row">
      <div>
        <div>{item.description}</div>
        <div className="pwa-list-sub">{item.articleNumber}</div>
        <div className="pwa-pick-meta">
          <span>
            Current: <strong>{formatQuantity(item.quantity)}{item.unit ? ` ${item.unit}` : ""}</strong>
          </span>
          <span>Min: {item.minThreshold === null ? "—" : formatQuantity(item.minThreshold)}</span>
        </div>
      </div>
      {status && (
        <WebStatusBadge tone={STATUS_TONE[status]} size="touch">
          {STATUS_LABEL[status]}
        </WebStatusBadge>
      )}
    </div>
  );
}
