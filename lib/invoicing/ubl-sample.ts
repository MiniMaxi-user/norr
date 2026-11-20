/**
 * Realistic Dutch sample data for the UBL fixtures in `test/fixtures/ubl/`
 * (regenerate with `UPDATE_UBL_FIXTURES=1 npm test`). Test/dev helper only.
 */
import type { UblInput, UblInvoice, UblLine } from "./ubl";

const sender: NonNullable<UblInvoice["sender"]> = {
  name: "Van Dijk Kantoorsystemen B.V.",
  kvk_number: "12345678",
  vat_number: "NL123456782B01",
  iban: "NL91 ABNA 0417 1643 00",
  address: { line1: "Stationsstraat 12", line2: null, postal_code: "3511 AB", city: "Utrecht", country: "Nederland" },
};

const recipient: UblInvoice["recipient"] = {
  name: "Bakkerij De Gouden Korst & Zn.",
  vat_number: "NL987654321B01",
  kvk_number: "87654321",
  address: { line1: "Markt 5", line2: null, postal_code: "6811 CG", city: "Arnhem", country: "Nederland" },
};

export const sampleInvoiceInput: UblInput = {
  invoice: {
    id: "00000000-0000-0000-0000-000000000001",
    invoice_number: "2026-0042",
    kind: "invoice",
    invoice_date: "2026-11-19",
    due_date: "2026-12-19",
    currency: "EUR",
    subtotal: 422.85,
    vat_total: 63.6,
    total: 486.45,
    vat_breakdown: [
      { vat_percent: 21, base: 302.85, amount: 63.6 },
      { vat_percent: 0, base: 120, amount: 0 },
    ],
    reference: "PO-2026-118",
    notes: "Thank you for your order.",
    payment_term_days: 30,
    recipient,
    sender,
  },
  lines: [
    {
      sort_order: 1,
      article_number: null,
      description: "Maintenance visit Q4 (2 hours)",
      asset_label: "Canon iR-ADV C3530i - SN X1234",
      quantity: 2,
      unit_price: 85,
      discount_percent: 10,
      vat_percent: 21,
      line_total: 153,
    },
    {
      sort_order: 2,
      article_number: "TON-001",
      description: "Toner cartridge black",
      asset_label: null,
      quantity: 3,
      unit_price: 49.95,
      discount_percent: 0,
      vat_percent: 21,
      line_total: 149.85,
    },
    {
      sort_order: 3,
      article_number: null,
      description: "Training course (VAT exempt)",
      asset_label: null,
      quantity: 1,
      unit_price: 120,
      discount_percent: 0,
      vat_percent: 0,
      line_total: 120,
    },
  ] as UblLine[],
};

/** Credit note for line 1 of the sample invoice; amounts stored negated like in the DB. */
export const sampleCreditNoteInput: UblInput = {
  invoice: {
    ...sampleInvoiceInput.invoice,
    id: "00000000-0000-0000-0000-000000000002",
    invoice_number: "2026-0043",
    kind: "credit_note",
    invoice_date: "2026-11-20",
    due_date: "2026-11-20",
    subtotal: -153,
    vat_total: -32.13,
    total: -185.13,
    vat_breakdown: [{ vat_percent: 21, base: -153, amount: -32.13 }],
    notes: "Credit for maintenance visit invoiced in error.",
  },
  lines: [{ ...(sampleInvoiceInput.lines[0] as UblLine), quantity: -2, line_total: -153 }],
  originalInvoice: { invoice_number: "2026-0042", invoice_date: "2026-11-19" },
};
