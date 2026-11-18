import type { StatusTone } from "@yourorg/ui/web-client";

export type StockStatus = "low" | "near" | "ok" | "none";

/**
 * Row status rule of a warehouse's stock (issue #181): `none` when no
 * minimum threshold is set (the rule does not apply). Otherwise `low` at/below
 * zero or strictly below the threshold ("below minimum"), `near` within 20%
 * above it, `ok` safely above that margin.
 */
export function resolveStockStatus(quantity: number, minThreshold: number | null): StockStatus {
  if (minThreshold === null) return "none";
  if (quantity <= 0 || quantity < minThreshold) return "low";
  if (quantity <= minThreshold * 1.2) return "near";
  return "ok";
}

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  low: "Below minimum",
  near: "Near minimum",
  ok: "OK",
  none: "No minimum",
};

export const STOCK_STATUS_TONE: Record<StockStatus, StatusTone> = {
  low: "danger",
  near: "warning",
  ok: "success",
  none: "neutral",
};

/** Up to 3 decimals (matches `warehouseStockQuantitySchema`), trailing zeros
 * trimmed, as an input value. */
export function quantityInputValue(value: number | null): string {
  return value === null ? "" : String(Math.round(value * 1000) / 1000);
}
