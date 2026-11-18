import type { LivePanelData } from "@yourorg/ui/web-client";
import { formatDateTimeWeb } from "@/lib/format/web";
import type { TimelineItem } from "@yourorg/ui/web";
import type { WarehouseRecord, WarehouseStockRecord } from "../actions";
import { resolveStockStatus } from "./stock-status";

/** Tab ids of the warehouse page and the `setLastUsedView` key they share. */
export type WarehouseDetailTab = "overview" | "stock";
export const WAREHOUSE_TAB_IDS: WarehouseDetailTab[] = ["overview", "stock"];
export const WAREHOUSE_DETAIL_VIEW_KEY = "inventory-detail";

/** Stock lines with a minimum that are at/below zero or below it. */
export function lowStockRows(stock: WarehouseStockRecord[]): WarehouseStockRecord[] {
  return stock.filter((row) => resolveStockStatus(row.quantity, row.min_threshold) === "low");
}

/**
 * LivePanel of the Warehouse page — only when something needs restocking now:
 * at least one stock line is below its minimum ("attention"), or one is out
 * of stock (quantity 0 with a minimum: "urgent"). The one action already
 * exists as a view: jump to the Stock tab filtered to Below minimum. Returns
 * `null` otherwise (no minimums set, or all lines are fine).
 */
export function getWarehouseLivePanel(
  stock: WarehouseStockRecord[],
  onShowLow: () => void,
): LivePanelData | null {
  const low = lowStockRows(stock);
  if (low.length === 0) return null;
  const outOfStock = low.filter((row) => row.quantity <= 0);
  const count = `${low.length} ${low.length === 1 ? "article" : "articles"}`;
  return {
    variant: outOfStock.length > 0 ? "urgent" : "attention",
    title: "BELOW MINIMUM STOCK",
    value: count,
    context:
      outOfStock.length > 0
        ? `${outOfStock.length} out of stock — restock before the next job`
        : "At or below the minimum you set per article",
    actions: [{ label: "Show articles", onClick: onShowLow }],
  };
}

const MAX_ITEMS = 8;

/**
 * The Warehouse page's TIMELINE, built from data the page already loads: the
 * warehouse's own created/renamed stamps, when each article was added, and
 * the last count of a line. Newest first; the data has no author.
 */
export function buildWarehouseTimeline(warehouse: WarehouseRecord, stock: WarehouseStockRecord[]): TimelineItem[] {
  const events: { id: string; at: string; title: string }[] = [
    { id: "warehouse-created", at: warehouse.created_at, title: "Warehouse created" },
  ];
  const created = new Date(warehouse.created_at).getTime();
  const updated = new Date(warehouse.updated_at).getTime();
  if (Number.isFinite(created) && Number.isFinite(updated) && updated - created > 60_000) {
    events.push({ id: "warehouse-updated", at: warehouse.updated_at, title: "Details changed" });
  }
  for (const row of stock) {
    const number = row.article?.article_number ?? "Unknown article";
    events.push({ id: `added-${row.id}`, at: row.created_at, title: `Article added · ${number}` });
    if (row.last_counted_at) {
      events.push({ id: `counted-${row.id}`, at: row.last_counted_at, title: `Counted · ${number}` });
    }
  }
  return events
    .filter((event) => !Number.isNaN(new Date(event.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_ITEMS)
    .map<TimelineItem>((event, index) => ({
      id: event.id,
      title: event.title,
      at: formatDateTimeWeb(event.at),
      status: index === 0 ? "latest" : "default",
    }));
}
