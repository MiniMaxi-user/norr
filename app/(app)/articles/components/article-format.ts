/**
 * Article prices are stored with up to 4 decimals (`numeric(14,4)`, issue
 * #135), so unlike `formatMoneyWeb` (2 decimals) a price such as 0,0125 is not
 * rounded away. Deterministic (fixed locale), safe to call during render.
 */
const priceFormat = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function formatPriceWeb(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return priceFormat.format(value).replace(/ /g, " ");
}
