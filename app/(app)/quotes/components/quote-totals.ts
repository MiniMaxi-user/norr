import type { QuoteLineItemRecord } from "../actions";

/** A line's price per unit after its discount. Display-layer only: the stored
 * `unit_price` stays the pre-discount price (same as `computeTotal` in
 * `../actions.ts`). */
export function netUnitPrice(item: Pick<QuoteLineItemRecord, "unit_price" | "discount_percent">): number {
  return Number(item.unit_price) * (1 - Number(item.discount_percent) / 100);
}

/** Pre-VAT total of one line. */
export function lineTotal(item: Pick<QuoteLineItemRecord, "quantity" | "unit_price" | "discount_percent">): number {
  return Number(item.quantity) * netUnitPrice(item);
}

/** A line's VAT rate in percent, from its linked article (`0` for a free-text
 * line: `quote_line_items` has no VAT column of its own). */
export function lineVatPercent(item: Pick<QuoteLineItemRecord, "article">): number {
  const raw = item.article?.vat_rate?.value;
  return raw ? Number(raw) : 0;
}

export interface QuoteTotals {
  subtotal: number;
  vat: number;
  total: number;
  /** Lines without a VAT rate (no linked article): none is counted for them. */
  linesWithoutVat: number;
}

export function quoteTotals(lineItems: QuoteLineItemRecord[]): QuoteTotals {
  let subtotal = 0;
  let vat = 0;
  let linesWithoutVat = 0;
  for (const item of lineItems) {
    const net = lineTotal(item);
    subtotal += net;
    vat += net * (lineVatPercent(item) / 100);
    if (!item.article?.vat_rate) linesWithoutVat += 1;
  }
  return { subtotal, vat, total: subtotal + vat, linesWithoutVat };
}
