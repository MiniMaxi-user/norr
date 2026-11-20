import { describe, expect, it } from "vitest";
import { buildInvoiceCsv, guardFormula, type InvoiceCsvRow } from "./invoice-csv";

function row(overrides: Partial<InvoiceCsvRow> = {}): InvoiceCsvRow {
  return {
    invoice_number: "2026-0001",
    kind: "invoice",
    invoice_date: "2026-11-19",
    vat_breakdown: [
      { vat_percent: 21, base: 100, amount: 21 },
      { vat_percent: 9, base: 50, amount: 4.5 },
    ],
    recipient: { name: "Acme B.V.", vat_number: "NL123456782B01" },
    ...overrides,
  };
}

function parse(csv: string): string[][] {
  return csv
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter((l) => l !== "")
    .map((l) => l.split(";"));
}

describe("buildInvoiceCsv", () => {
  it("starts with a BOM, uses CRLF and English headers", () => {
    const csv = buildInvoiceCsv([row()]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(parse(csv)[0]).toEqual([
      "Invoice number",
      "Type",
      "Invoice date",
      "Client",
      "Client VAT number",
      "Base",
      "VAT rate",
      "VAT amount",
      "Total",
    ]);
  });

  it("emits one row per VAT rate with base + VAT as Total", () => {
    const rows = parse(buildInvoiceCsv([row()]));
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(["2026-0001", "Invoice", "2026-11-19", "Acme B.V.", "NL123456782B01", "100.00", "21.00", "21.00", "121.00"]);
    expect(rows[2]!.slice(5)).toEqual(["50.00", "9.00", "4.50", "54.50"]);
  });

  it("emits a single rate-0 row for an invoice without breakdown", () => {
    const rows = parse(buildInvoiceCsv([row({ vat_breakdown: [], subtotal: 80, vat_total: 0 })]));
    expect(rows).toHaveLength(2);
    expect(rows[1]!.slice(5)).toEqual(["80.00", "0.00", "0.00", "80.00"]);
  });

  it("exports credit notes negative, whether stored negated or not", () => {
    for (const sign of [-1, 1]) {
      const rows = parse(
        buildInvoiceCsv([
          row({ kind: "credit_note", vat_breakdown: [{ vat_percent: 21, base: sign * 100, amount: sign * 21 }] }),
        ]),
      );
      expect(rows[1]![1]).toBe("Credit note");
      expect(rows[1]!.slice(5)).toEqual(["-100.00", "21.00", "-21.00", "-121.00"]);
    }
  });

  it("quotes cells with delimiter, quotes and newlines (RFC 4180)", () => {
    const csv = buildInvoiceCsv([row({ recipient: { name: 'Jansen; "De Bouw"\nB.V.', vat_number: null } })]);
    expect(csv).toContain('"Jansen; ""De Bouw""\nB.V."');
  });

  it("guards text cells against formula injection but leaves numbers alone", () => {
    const csv = buildInvoiceCsv([
      row({
        kind: "credit_note",
        recipient: { name: "=HYPERLINK(\"http://evil\")", vat_number: "@SUM(A1)" },
        vat_breakdown: [{ vat_percent: 21, base: 100, amount: 21 }],
      }),
    ]);
    const line = csv.split("\r\n")[1] ?? "";
    expect(line).toContain("'=HYPERLINK");
    expect(line).toContain("'@SUM(A1)");
    expect(line.endsWith(";-100.00;21.00;-21.00;-121.00")).toBe(true);
    expect(guardFormula("+31 6")).toBe("'+31 6");
    expect(guardFormula("-x")).toBe("'-x");
    expect(guardFormula("Normal")).toBe("Normal");
  });
});
