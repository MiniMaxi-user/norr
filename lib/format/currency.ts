/**
 * Shared currency display formatter (issue #83) — consolidates what were
 * several near-identical local copies (`formatValue`/`formatTotal`/
 * `formatMoney`) across Contracts/Quotes/Clients. All hardcode USD, same as
 * every copy this replaces — no multi-currency support exists yet.
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
