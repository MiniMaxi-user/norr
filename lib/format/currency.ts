/**
 * Shared currency display formatter (issue #83, currency fixed to EUR by
 * issue #108 — "We ondersteunen geen andere valuta op dit moment") —
 * consolidates what were several near-identical local copies
 * (`formatValue`/`formatTotal`/`formatMoney`) across Contracts/Quotes/
 * Clients. Hardcodes EUR; no multi-currency support exists yet.
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "EUR" });
}
