/**
 * Shared number display formatter (issue #221 asset volumes). Readings are
 * stored with up to 3 decimals; whole numbers render without a fraction.
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
