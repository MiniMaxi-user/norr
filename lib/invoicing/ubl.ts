/**
 * Pure UBL 2.1 generator for SI-UBL 2.0 / NLCIUS (EN16931, Peppol BIS Billing 3)
 * e-invoices (#241). No DB, no Next imports: callers map the frozen invoice
 * snapshot (see `app/(app)/quotes/invoice-render.ts`) onto `UblInput`.
 *
 * Sign conventions: credit notes are stored NEGATED in the database (a negated
 * copy of the original invoice, see credit_invoice()). The economic sign is
 * preserved per document kind: an Invoice emits the stored values as they are
 * (a credit line on an invoice, e.g. an under-use credit, stays negative: negative
 * InvoicedQuantity and LineExtensionAmount, PriceAmount positive); a CreditNote
 * emits the stored values negated, so a normal credit note carries positive
 * amounts and an original credit line becomes a negative CreditedQuantity /
 * LineExtensionAmount. Tax subtotals and totals use the same signed values.
 *
 * Discount choice: a discounted line is expressed with a line-level
 * `AllowanceCharge` (allowance) next to the GROSS unit price in
 * `Price/PriceAmount`. The allowance amount is derived as
 * `round(qty * price) - line_total`, so the line net amount equals the frozen
 * `line_total` exactly and rules BR-27 / PEPPOL-EN16931-R120 (line net =
 * qty x price - allowances) hold without rounding drift, which a net unit
 * price with many decimals could not guarantee.
 */

export const UBL_CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0";
export const UBL_PROFILE_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

const NS_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
const NS_CREDIT_NOTE = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2";
const NS_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
const NS_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";

export interface UblAddress {
  line1?: string | null;
  line2?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface UblInvoice {
  id: string;
  invoice_number: string;
  kind: "invoice" | "credit_note";
  invoice_date: string;
  due_date: string;
  currency: string;
  subtotal: number | string;
  vat_total: number | string;
  total: number | string;
  vat_breakdown: { vat_percent: number | string; base: number | string; amount: number | string }[];
  reference: string | null;
  notes: string | null;
  payment_term_days: number;
  recipient: {
    name: string;
    vat_number: string | null;
    kvk_number?: string | null;
    address: UblAddress | null;
  };
  sender: {
    name: string;
    kvk_number: string | null;
    vat_number: string | null;
    iban: string | null;
    address: UblAddress | null;
  } | null;
}

export interface UblLine {
  sort_order?: number;
  article_number: string | null;
  description: string;
  asset_label: string | null;
  quantity: number | string;
  unit_price: number | string;
  discount_percent: number | string;
  vat_percent: number | string;
  line_total: number | string;
}

export interface UblInput {
  invoice: UblInvoice;
  lines: UblLine[];
  /** Required for credit notes: the invoice being credited (BillingReference). */
  originalInvoice?: { invoice_number: string; invoice_date: string } | null;
}

export interface UblMissingField {
  field: string;
  message: string;
}

export type UblBuildResult =
  | { ok: true; xml: string; filename: string }
  | { ok: false; missing: UblMissingField[] };

// ---------------------------------------------------------------- helpers

export function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "") // illegal in XML 1.0
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface XmlNode {
  name: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: (XmlNode | null)[];
}

function node(name: string, text?: string, attrs?: Record<string, string>): XmlNode {
  return { name, text, attrs };
}

function parent(name: string, children: (XmlNode | null)[], attrs?: Record<string, string>): XmlNode {
  return { name, children, attrs };
}

function render(n: XmlNode, depth: number): string {
  const pad = "  ".repeat(depth);
  const attrs = Object.entries(n.attrs ?? {})
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join("");
  if (n.children) {
    const kids = n.children.filter((c): c is XmlNode => c !== null);
    return `${pad}<${n.name}${attrs}>\n${kids.map((c) => render(c, depth + 1)).join("\n")}\n${pad}</${n.name}>`;
  }
  return `${pad}<${n.name}${attrs}>${escapeXml(n.text ?? "")}</${n.name}>`;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Signed amount; `sign` is -1 for stored-negated credit notes, else 1. Never "-0.00". */
function amount(name: string, value: number | string, currency: string, sign = 1): XmlNode {
  const v = round2(sign * Number(value));
  return node(name, (v === 0 ? 0 : v).toFixed(2), { currencyID: currency });
}

/** Unit price: at least 2, at most 4 decimals. */
function priceText(value: number): string {
  return Math.abs(value).toFixed(4).replace(/0{1,2}$/, "");
}

function percentText(value: number | string): string {
  return Number(value).toFixed(2);
}

function trimmed(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

const COUNTRY_NAMES: Record<string, string> = {
  "": "NL",
  nederland: "NL",
  netherlands: "NL",
  "the netherlands": "NL",
  holland: "NL",
  belgie: "BE",
  belgium: "BE",
  duitsland: "DE",
  germany: "DE",
  deutschland: "DE",
  frankrijk: "FR",
  france: "FR",
};

/** ISO 3166-1 alpha-2 from a free-text country; null when unrecognised. */
export function toCountryCode(country: string | null | undefined): string | null {
  const raw = trimmed(country);
  const key = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (key in COUNTRY_NAMES) return COUNTRY_NAMES[key] ?? null;
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return null;
}

export function normalizeVatNumber(value: string): string {
  return value.replace(/[\s.]/g, "").toUpperCase();
}

export function normalizeIban(value: string): string {
  return value.replace(/\s/g, "").toUpperCase();
}

export function sanitizeFilename(invoiceNumber: string): string {
  const safe = invoiceNumber.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "") || "invoice";
  return `${safe}.xml`;
}

function taxCategoryId(vatPercent: number | string): "S" | "Z" {
  return Number(vatPercent) > 0 ? "S" : "Z";
}

// ------------------------------------------------------------- validation

function addressMissing(address: UblAddress | null | undefined): boolean {
  return !address || !trimmed(address.line1) || !trimmed(address.postal_code) || !trimmed(address.city);
}

export function validateUblInput(input: UblInput): UblMissingField[] {
  const missing: UblMissingField[] = [];
  const { invoice, lines } = input;
  const sender = invoice.sender;

  if (!sender || !trimmed(sender.name)) {
    missing.push({ field: "sender.name", message: "Company name is missing — fill it in under Settings → Company" });
  }
  if (!trimmed(sender?.vat_number)) {
    missing.push({ field: "sender.vat_number", message: "Company VAT number is missing — fill it in under Settings → Company" });
  }
  if (!trimmed(sender?.kvk_number)) {
    missing.push({ field: "sender.kvk_number", message: "Company KvK number is missing — fill it in under Settings → Company" });
  }
  if (!trimmed(sender?.iban)) {
    missing.push({ field: "sender.iban", message: "Company IBAN is missing — fill it in under Settings → Company" });
  }
  if (addressMissing(sender?.address)) {
    missing.push({
      field: "sender.address",
      message: "Company address (street, postal code, city) is missing — fill it in under Settings → Company",
    });
  } else if (toCountryCode(sender?.address?.country) === null) {
    missing.push({
      field: "sender.address.country",
      message: "Company country is not recognised — use a country name or 2-letter code under Settings → Company",
    });
  }

  if (!trimmed(invoice.recipient?.name)) {
    missing.push({ field: "recipient.name", message: "Client name is missing — add it on the client" });
  }
  if (addressMissing(invoice.recipient?.address)) {
    missing.push({
      field: "recipient.address",
      message: "Client address (invoice address: street, postal code, city) is missing — add it on the client",
    });
  } else if (toCountryCode(invoice.recipient.address?.country) === null) {
    missing.push({
      field: "recipient.address.country",
      message: "Client country is not recognised — use a country name or 2-letter code on the client",
    });
  }

  if (invoice.kind === "credit_note" && !trimmed(input.originalInvoice?.invoice_number)) {
    missing.push({ field: "originalInvoice", message: "The original invoice of this credit note could not be found" });
  }
  if (lines.length === 0) {
    missing.push({ field: "lines", message: "The invoice has no lines" });
  }
  return missing;
}

// ---------------------------------------------------------------- builders

function addressNode(address: UblAddress): XmlNode {
  return parent("cac:PostalAddress", [
    node("cbc:StreetName", trimmed(address.line1)),
    trimmed(address.line2) ? node("cbc:AdditionalStreetName", trimmed(address.line2)) : null,
    node("cbc:CityName", trimmed(address.city)),
    node("cbc:PostalZone", trimmed(address.postal_code)),
    parent("cac:Country", [node("cbc:IdentificationCode", toCountryCode(address.country) ?? "NL")]),
  ]);
}

interface PartyArgs {
  name: string;
  address: UblAddress;
  vatNumber: string | null;
  kvkNumber: string | null;
}

function partyNode(p: PartyArgs): XmlNode {
  const vat = trimmed(p.vatNumber) ? normalizeVatNumber(p.vatNumber ?? "") : "";
  const kvk = trimmed(p.kvkNumber);
  // Electronic address (BT-34/BT-49): KvK (0106) when known, else NL VAT (9944).
  const endpoint = kvk
    ? node("cbc:EndpointID", kvk, { schemeID: "0106" })
    : vat.startsWith("NL")
      ? node("cbc:EndpointID", vat, { schemeID: "9944" })
      : null;
  return parent("cac:Party", [
    endpoint,
    parent("cac:PartyName", [node("cbc:Name", trimmed(p.name))]),
    addressNode(p.address),
    vat ? parent("cac:PartyTaxScheme", [node("cbc:CompanyID", vat), parent("cac:TaxScheme", [node("cbc:ID", "VAT")])]) : null,
    parent("cac:PartyLegalEntity", [
      node("cbc:RegistrationName", trimmed(p.name)),
      kvk ? node("cbc:CompanyID", kvk, { schemeID: "0106" }) : null,
    ]),
  ]);
}

function taxCategory(tag: string, vatPercent: number | string): XmlNode {
  return parent(tag, [
    node("cbc:ID", taxCategoryId(vatPercent)),
    node("cbc:Percent", percentText(vatPercent)),
    parent("cac:TaxScheme", [node("cbc:ID", "VAT")]),
  ]);
}

function lineNode(line: UblLine, index: number, kind: "invoice" | "credit_note", cur: string): XmlNode {
  const sign = kind === "credit_note" ? -1 : 1;
  const price = Math.abs(Number(line.unit_price));
  const qty = sign * Number(line.quantity) === 0 ? 0 : sign * Number(line.quantity);
  const net = round2(sign * Number(line.line_total));
  // Discount on absolute values so the AllowanceCharge amount is always positive. On a
  // negative line the discount reduces the magnitude, i.e. it is a positive CHARGE
  // against the negative gross (-100 + 10 = -90), keeping qty x price -/+ allowance = net.
  const negativeLine = qty < 0 || net < 0;
  const absGross = round2(Math.abs(qty) * price);
  const allowance = round2(absGross - Math.abs(net));
  const discount = Math.abs(Number(line.discount_percent));
  const qtyTag = kind === "invoice" ? "cbc:InvoicedQuantity" : "cbc:CreditedQuantity";
  const name = line.description.replace(/\s+/g, " ").trim().slice(0, 200) || "-";
  const article = trimmed(line.article_number);
  const asset = trimmed(line.asset_label);

  return parent(kind === "invoice" ? "cac:InvoiceLine" : "cac:CreditNoteLine", [
    node("cbc:ID", String(index + 1)),
    node(qtyTag, String(qty), { unitCode: "C62" }),
    amount("cbc:LineExtensionAmount", net, cur),
    allowance > 0
      ? parent("cac:AllowanceCharge", [
          node("cbc:ChargeIndicator", negativeLine ? "true" : "false"),
          node("cbc:AllowanceChargeReason", "Discount"),
          discount > 0 ? node("cbc:MultiplierFactorNumeric", String(discount)) : null,
          amount("cbc:Amount", allowance, cur),
          amount("cbc:BaseAmount", absGross, cur),
        ])
      : null,
    parent("cac:Item", [
      asset ? node("cbc:Description", asset) : null,
      node("cbc:Name", name),
      article ? parent("cac:SellersItemIdentification", [node("cbc:ID", article)]) : null,
      taxCategory("cac:ClassifiedTaxCategory", line.vat_percent),
    ]),
    parent("cac:Price", [node("cbc:PriceAmount", priceText(price), { currencyID: cur })]),
  ]);
}

function breakdownOf(input: UblInput, sign: number): { vat_percent: number; base: number; amount: number }[] {
  if (input.invoice.vat_breakdown.length > 0) {
    return input.invoice.vat_breakdown.map((e) => ({
      vat_percent: Number(e.vat_percent),
      base: sign * Number(e.base),
      amount: sign * Number(e.amount),
    }));
  }
  // Fallback for snapshots without a breakdown: group the lines by rate.
  const groups = new Map<number, { vat_percent: number; base: number; amount: number }>();
  for (const l of input.lines) {
    const pct = Number(l.vat_percent);
    const g = groups.get(pct) ?? { vat_percent: pct, base: 0, amount: 0 };
    g.base = round2(g.base + sign * Number(l.line_total));
    groups.set(pct, g);
  }
  for (const g of groups.values()) g.amount = round2((g.base * g.vat_percent) / 100);
  return [...groups.values()];
}

export function buildUblXml(input: UblInput): UblBuildResult {
  const missing = validateUblInput(input);
  if (missing.length > 0) return { ok: false, missing };

  const { invoice } = input;
  const sender = invoice.sender!;
  const isCredit = invoice.kind === "credit_note";
  const sign = isCredit ? -1 : 1;
  const cur = trimmed(invoice.currency) || "EUR";
  const buyerReference = trimmed(invoice.reference) || invoice.invoice_number;
  const note = trimmed(invoice.notes);
  const original = input.originalInvoice;

  // Element order follows the UBL 2.1 schema sequence (XSD-validated).
  const children: (XmlNode | null)[] = [
    node("cbc:CustomizationID", UBL_CUSTOMIZATION_ID),
    node("cbc:ProfileID", UBL_PROFILE_ID),
    node("cbc:ID", invoice.invoice_number),
    node("cbc:IssueDate", dateOnly(invoice.invoice_date)),
    // CreditNote has no header-level DueDate in UBL 2.1.
    isCredit ? null : node("cbc:DueDate", dateOnly(invoice.due_date)),
    isCredit ? node("cbc:CreditNoteTypeCode", "381") : node("cbc:InvoiceTypeCode", "380"),
    note ? node("cbc:Note", note) : null,
    node("cbc:DocumentCurrencyCode", cur),
    node("cbc:BuyerReference", buyerReference),
    isCredit && original
      ? parent("cac:BillingReference", [
          parent("cac:InvoiceDocumentReference", [
            node("cbc:ID", original.invoice_number),
          ]),
        ])
      : null,
    parent("cac:AccountingSupplierParty", [
      partyNode({
        name: sender.name,
        address: sender.address!,
        vatNumber: sender.vat_number,
        kvkNumber: sender.kvk_number,
      }),
    ]),
    parent("cac:AccountingCustomerParty", [
      partyNode({
        name: invoice.recipient.name,
        address: invoice.recipient.address!,
        vatNumber: invoice.recipient.vat_number,
        kvkNumber: invoice.recipient.kvk_number ?? null,
      }),
    ]),
    parent("cac:PaymentMeans", [
      node("cbc:PaymentMeansCode", "58"),
      node("cbc:PaymentID", invoice.invoice_number),
      parent("cac:PayeeFinancialAccount", [node("cbc:ID", normalizeIban(sender.iban ?? ""))]),
    ]),
    isCredit || !(invoice.payment_term_days > 0)
      ? null
      : parent("cac:PaymentTerms", [node("cbc:Note", `Payment within ${invoice.payment_term_days} days`)]),
    parent("cac:TaxTotal", [
      amount("cbc:TaxAmount", invoice.vat_total, cur, sign),
      ...breakdownOf(input, sign).map((e) =>
        parent("cac:TaxSubtotal", [
          amount("cbc:TaxableAmount", e.base, cur),
          amount("cbc:TaxAmount", e.amount, cur),
          taxCategory("cac:TaxCategory", e.vat_percent),
        ]),
      ),
    ]),
    parent("cac:LegalMonetaryTotal", [
      amount("cbc:LineExtensionAmount", invoice.subtotal, cur, sign),
      amount("cbc:TaxExclusiveAmount", invoice.subtotal, cur, sign),
      amount("cbc:TaxInclusiveAmount", invoice.total, cur, sign),
      amount("cbc:PayableAmount", invoice.total, cur, sign),
    ]),
    ...[...input.lines]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((l, i) => lineNode(l, i, invoice.kind, cur)),
  ];

  const doc = parent(isCredit ? "CreditNote" : "Invoice", children, {
    xmlns: isCredit ? NS_CREDIT_NOTE : NS_INVOICE,
    "xmlns:cac": NS_CAC,
    "xmlns:cbc": NS_CBC,
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${render(doc, 0)}\n`;
  return { ok: true, xml, filename: sanitizeFilename(invoice.invoice_number) };
}
