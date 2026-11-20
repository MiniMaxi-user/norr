/**
 * Pure CSV export of invoices for bookkeeping (#241): one row per invoice per
 * VAT rate. `;` delimiter, UTF-8 BOM, CRLF, dot decimals, RFC 4180 quoting.
 */

export interface InvoiceCsvRow {
  invoice_number: string;
  kind: "invoice" | "credit_note";
  invoice_date: string;
  subtotal?: number | string | null;
  vat_total?: number | string | null;
  vat_breakdown: { vat_percent: number | string; base: number | string; amount: number | string }[];
  recipient: { name: string; vat_number: string | null };
}

export const INVOICE_CSV_HEADERS = [
  "Invoice number",
  "Type",
  "Invoice date",
  "Client",
  "Client VAT number",
  "Base",
  "VAT rate",
  "VAT amount",
  "Total",
] as const;

const DELIMITER = ";";

/** Neutralise spreadsheet formula injection in TEXT cells only. */
export function guardFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function text(value: string | null | undefined): string {
  return quote(guardFormula(value ?? ""));
}

function decimal(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2);
}

export function buildInvoiceCsv(rows: InvoiceCsvRow[]): string {
  const lines: string[] = [INVOICE_CSV_HEADERS.join(DELIMITER)];
  for (const row of rows) {
    // Credit notes are exported negative regardless of how they were stored.
    const sign = row.kind === "credit_note" ? -1 : 1;
    const entries =
      row.vat_breakdown.length > 0
        ? row.vat_breakdown.map((e) => ({ rate: Number(e.vat_percent), base: Number(e.base), vat: Number(e.amount) }))
        : [{ rate: 0, base: Number(row.subtotal ?? 0), vat: Number(row.vat_total ?? 0) }];
    for (const e of entries) {
      const base = sign * Math.abs(e.base);
      const vat = sign * Math.abs(e.vat);
      lines.push(
        [
          text(row.invoice_number),
          row.kind === "credit_note" ? "Credit note" : "Invoice",
          row.invoice_date.slice(0, 10),
          text(row.recipient.name),
          text(row.recipient.vat_number),
          decimal(base),
          decimal(e.rate),
          decimal(vat),
          decimal(base + vat),
        ].join(DELIMITER),
      );
    }
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
