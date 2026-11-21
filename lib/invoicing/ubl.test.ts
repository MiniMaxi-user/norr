import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildUblXml, escapeXml, sanitizeFilename, toCountryCode, validateUblInput, type UblInput } from "./ubl";
import { sampleCreditNoteInput, sampleInvoiceInput } from "./ubl-sample";

function xmlOf(input: UblInput): string {
  const result = buildUblXml(input);
  if (!result.ok) throw new Error(result.missing.map((m) => m.message).join("; "));
  return result.xml;
}

/** Tag names of the direct children of the document root, in order. */
function topLevel(xml: string): string[] {
  const body = xml.split("\n").slice(2, -2); // drop declaration, root open/close
  return body.filter((l) => /^ {2}<[^/]/.test(l)).map((l) => /^ {2}<([\w:]+)/.exec(l)![1]!);
}

function amounts(xml: string, tag: string): number[] {
  return [...xml.matchAll(new RegExp(`<${tag} currencyID="EUR">([\\d.]+)</${tag}>`, "g"))].map((m) => Number(m[1]));
}

describe("escapeXml", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeXml(`a & b < c > d "e" 'f'`)).toBe("a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;");
  });
  it("drops control characters illegal in XML 1.0", () => {
    expect(escapeXml("a\u0001b\u000Bc")).toBe("abc");
  });
});

describe("helpers", () => {
  it("maps countries to ISO-2", () => {
    expect(toCountryCode("Nederland")).toBe("NL");
    expect(toCountryCode("The Netherlands")).toBe("NL");
    expect(toCountryCode("")).toBe("NL");
    expect(toCountryCode(null)).toBe("NL");
    expect(toCountryCode("be")).toBe("BE");
    expect(toCountryCode("België")).toBe("BE");
    expect(toCountryCode("Atlantis")).toBeNull();
  });
  it("sanitises filenames", () => {
    expect(sanitizeFilename("2026/0042 a")).toBe("2026_0042_a.xml");
    expect(sanitizeFilename("../x")).toBe("_x.xml");
  });
});

describe("buildUblXml - invoice", () => {
  const xml = xmlOf(sampleInvoiceInput);

  it("is an Invoice with UTF-8 declaration, NLCIUS ids and type code 380", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<Invoice xmlns=')).toBe(true);
    expect(xml).toContain("<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0</cbc:CustomizationID>");
    expect(xml).toContain("<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>");
    expect(xml).toContain("<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>");
    expect(xml).toContain("<cbc:DueDate>2026-12-19</cbc:DueDate>");
  });

  it("orders top-level elements per the UBL 2.1 Invoice schema", () => {
    expect(topLevel(xml)).toEqual([
      "cbc:CustomizationID",
      "cbc:ProfileID",
      "cbc:ID",
      "cbc:IssueDate",
      "cbc:DueDate",
      "cbc:InvoiceTypeCode",
      "cbc:Note",
      "cbc:DocumentCurrencyCode",
      "cbc:BuyerReference",
      "cac:AccountingSupplierParty",
      "cac:AccountingCustomerParty",
      "cac:PaymentMeans",
      "cac:PaymentTerms",
      "cac:TaxTotal",
      "cac:LegalMonetaryTotal",
      "cac:InvoiceLine",
      "cac:InvoiceLine",
      "cac:InvoiceLine",
    ]);
  });

  it("carries KvK (0106), VAT, SEPA payment means with stripped IBAN, and escapes names", () => {
    expect(xml).toContain('<cbc:CompanyID schemeID="0106">12345678</cbc:CompanyID>');
    expect(xml).toContain('<cbc:CompanyID schemeID="0106">87654321</cbc:CompanyID>');
    expect(xml).toContain("<cbc:CompanyID>NL123456782B01</cbc:CompanyID>");
    expect(xml).toContain("<cbc:Name>Bakkerij De Gouden Korst &amp; Zn.</cbc:Name>");
    expect(xml).toContain("<cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>");
    expect(xml).toContain("<cbc:PaymentID>2026-0042</cbc:PaymentID>");
    expect(xml).toContain("<cbc:ID>NL91ABNA0417164300</cbc:ID>");
    expect(xml).toContain("<cbc:Note>Payment within 30 days</cbc:Note>");
    expect(xml).toContain("<cbc:IdentificationCode>NL</cbc:IdentificationCode>");
  });

  it("uses reference as BuyerReference and falls back to the invoice number", () => {
    expect(xml).toContain("<cbc:BuyerReference>PO-2026-118</cbc:BuyerReference>");
    const fallback = xmlOf({ ...sampleInvoiceInput, invoice: { ...sampleInvoiceInput.invoice, reference: null } });
    expect(fallback).toContain("<cbc:BuyerReference>2026-0042</cbc:BuyerReference>");
  });

  it("emits one TaxSubtotal per VAT rate with S/Z categories and consistent sums", () => {
    expect(xml.match(/<cac:TaxSubtotal>/g)).toHaveLength(2);
    expect(xml).toContain("<cbc:ID>S</cbc:ID>");
    expect(xml).toContain("<cbc:ID>Z</cbc:ID>");
    const taxable = amounts(xml, "cbc:TaxableAmount");
    expect(taxable).toEqual([302.85, 120]);
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="EUR">422.85</cbc:LineExtensionAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="EUR">486.45</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">486.45</cbc:PayableAmount>');
    const lineNets = amounts(xml, "cbc:LineExtensionAmount");
    // [LegalMonetaryTotal, line1, line2, line3]
    expect(lineNets[0]).toBeCloseTo(lineNets.slice(1).reduce((a, b) => a + b, 0), 2);
  });

  it("expresses a discount as a line allowance so qty x price - allowance = line net", () => {
    const line1 = xml.split("<cac:InvoiceLine>")[1]!;
    expect(line1).toContain('<cbc:InvoicedQuantity unitCode="C62">2</cbc:InvoicedQuantity>');
    expect(line1).toContain('<cbc:LineExtensionAmount currencyID="EUR">153.00</cbc:LineExtensionAmount>');
    expect(line1).toContain('<cbc:Amount currencyID="EUR">17.00</cbc:Amount>');
    expect(line1).toContain('<cbc:BaseAmount currencyID="EUR">170.00</cbc:BaseAmount>');
    expect(line1).toContain('<cbc:PriceAmount currencyID="EUR">85.00</cbc:PriceAmount>');
    expect(170 - 17).toBe(153);
    // Undiscounted lines carry no allowance; article number appears when set.
    const line2 = xml.split("<cac:InvoiceLine>")[2]!;
    expect(line2).not.toContain("<cac:AllowanceCharge>");
    expect(line2).toContain("<cac:SellersItemIdentification>");
    expect(line1).not.toContain("<cac:SellersItemIdentification>");
  });

  it("orders line children per the UBL schema", () => {
    const line1 = xml.split("<cac:InvoiceLine>")[1]!;
    const order = [...line1.matchAll(/^ {4}<([\w:]+)/gm)].map((m) => m[1]);
    expect(order).toEqual(["cbc:ID", "cbc:InvoicedQuantity", "cbc:LineExtensionAmount", "cac:AllowanceCharge", "cac:Item", "cac:Price"]);
  });
});

describe("buildUblXml - credit note", () => {
  const xml = xmlOf(sampleCreditNoteInput);

  it("is a CreditNote (381) with BillingReference and no DueDate / payment terms", () => {
    expect(xml).toContain("<CreditNote xmlns=");
    expect(xml).toContain("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>");
    expect(xml).not.toContain("DueDate");
    expect(xml).not.toContain("PaymentTerms");
    expect(xml).toContain("<cac:CreditNoteLine>");
    expect(xml).toContain('<cbc:CreditedQuantity unitCode="C62">2</cbc:CreditedQuantity>');
    expect(topLevel(xml)).toEqual([
      "cbc:CustomizationID",
      "cbc:ProfileID",
      "cbc:ID",
      "cbc:IssueDate",
      "cbc:CreditNoteTypeCode",
      "cbc:Note",
      "cbc:DocumentCurrencyCode",
      "cbc:BuyerReference",
      "cac:BillingReference",
      "cac:AccountingSupplierParty",
      "cac:AccountingCustomerParty",
      "cac:PaymentMeans",
      "cac:TaxTotal",
      "cac:LegalMonetaryTotal",
      "cac:CreditNoteLine",
    ]);
    // BR-NL-24: the preceding invoice's issue date is not recommended, so only its number is referenced.
    expect(xml).toContain("<cac:InvoiceDocumentReference>\n      <cbc:ID>2026-0042</cbc:ID>\n    </cac:InvoiceDocumentReference>");
  });

  it("carries positive amounts although they are stored negated", () => {
    expect(xml).not.toMatch(/>-\d/);
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">185.13</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:TaxAmount currencyID="EUR">32.13</cbc:TaxAmount>');
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="EUR">153.00</cbc:LineExtensionAmount>');
    expect(xml).toContain('<cbc:Amount currencyID="EUR">17.00</cbc:Amount>');
  });
});

describe("validateUblInput", () => {
  it("passes complete input", () => {
    expect(validateUblInput(sampleInvoiceInput)).toEqual([]);
  });

  it("names the Settings location for missing company data", () => {
    const missing = validateUblInput({
      ...sampleInvoiceInput,
      invoice: {
        ...sampleInvoiceInput.invoice,
        sender: { ...sampleInvoiceInput.invoice.sender!, vat_number: null, kvk_number: " ", iban: null, address: null },
      },
    });
    const messages = missing.map((m) => m.message);
    expect(messages).toContain("Company VAT number is missing — fill it in under Settings → Company");
    expect(messages).toContain("Company KvK number is missing — fill it in under Settings → Company");
    expect(messages).toContain("Company IBAN is missing — fill it in under Settings → Company");
    expect(messages.some((m) => m.startsWith("Company address"))).toBe(true);
  });

  it("reports a missing sender entirely and missing client data", () => {
    const result = buildUblXml({
      ...sampleInvoiceInput,
      invoice: {
        ...sampleInvoiceInput.invoice,
        sender: null,
        recipient: { name: "", vat_number: null, address: null },
      },
      lines: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const fields = result.missing.map((m) => m.field);
    expect(fields).toEqual(
      expect.arrayContaining(["sender.name", "sender.vat_number", "sender.kvk_number", "sender.iban", "sender.address", "recipient.name", "recipient.address", "lines"]),
    );
    expect(result.missing.find((m) => m.field === "recipient.address")!.message).toContain("add it on the client");
  });

  it("requires the original invoice for credit notes", () => {
    const missing = validateUblInput({ ...sampleCreditNoteInput, originalInvoice: null });
    expect(missing.map((m) => m.field)).toEqual(["originalInvoice"]);
  });
});

describe("fixtures", () => {
  const dir = resolve(__dirname, "../../test/fixtures/ubl");
  const cases: [string, UblInput][] = [
    ["invoice.xml", sampleInvoiceInput],
    ["credit-note.xml", sampleCreditNoteInput],
  ];

  it.each(cases)("%s matches the generator output", (file, input) => {
    const path = resolve(dir, file);
    const xml = xmlOf(input);
    if (process.env.UPDATE_UBL_FIXTURES === "1") {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, xml, "utf8");
    }
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(xml);
  });
});

describe("buildUblXml - negative lines (credit lines on an invoice)", () => {
  const signed = (xml: string, tag: string) =>
    [...xml.matchAll(new RegExp(`<${tag}[^>]*>(-?[0-9.]+)</${tag}>`, "g"))].map((m) => Number(m[1]));

  // 1 charge of 100 + 1 credit line of -30 (stored negative on the invoice), 21% VAT.
  const invoiceInput: UblInput = {
    ...sampleInvoiceInput,
    invoice: {
      ...sampleInvoiceInput.invoice,
      subtotal: 70,
      vat_total: 14.7,
      total: 84.7,
      vat_breakdown: [{ vat_percent: 21, base: 70, amount: 14.7 }],
    },
    lines: [
      { ...sampleInvoiceInput.lines[0]!, quantity: 1, unit_price: 100, discount_percent: 0, vat_percent: 21, line_total: 100 },
      {
        ...sampleInvoiceInput.lines[0]!,
        description: "Under-use credit",
        quantity: -3,
        unit_price: 10,
        discount_percent: 0,
        vat_percent: 21,
        line_total: -30,
        sort_order: 1,
      },
    ],
  };

  it("keeps a credit line negative on an invoice with a positive price", () => {
    const xml = xmlOf(invoiceInput);
    expect(signed(xml, "cbc:InvoicedQuantity")).toEqual([1, -3]);
    expect(xml).toMatch(/<cbc:LineExtensionAmount currencyID="EUR">-30.00</);
    expect(xml).toMatch(/<cbc:PriceAmount currencyID="EUR">10.00</);
    expect(xml).not.toMatch(/<cbc:PriceAmount currencyID="EUR">-/);
    expect(signed(xml, "cbc:TaxableAmount")).toEqual([70]);
    expect(signed(xml, "cbc:PayableAmount")).toEqual([84.7]);
    expect(xml).not.toContain("AllowanceCharge");
  });

  it("credit note of that invoice: charge becomes a negative-stored positive credit, credit line becomes negative", () => {
    const stored = {
      ...invoiceInput,
      invoice: {
        ...invoiceInput.invoice,
        kind: "credit_note" as const,
        invoice_number: "CN-1",
        subtotal: -70,
        vat_total: -14.7,
        total: -84.7,
        vat_breakdown: [{ vat_percent: 21, base: -70, amount: -14.7 }],
      },
      lines: invoiceInput.lines.map((l) => ({
        ...l,
        quantity: -Number(l.quantity),
        line_total: -Number(l.line_total),
      })),
      originalInvoice: { invoice_number: "INV-1", invoice_date: "2026-01-01" },
    };
    const xml = xmlOf(stored);
    expect(signed(xml, "cbc:CreditedQuantity")).toEqual([1, -3]);
    expect(signed(xml, "cbc:LineExtensionAmount")).toEqual([70, 100, -30]);
    expect(signed(xml, "cbc:TaxableAmount")).toEqual([70]);
    expect(signed(xml, "cbc:TaxAmount")).toEqual([14.7, 14.7]);
    expect(signed(xml, "cbc:PayableAmount")).toEqual([84.7]);
    expect(xml).toMatch(/<cbc:PriceAmount currencyID="EUR">10.00</);
  });

  it("all-positive fixtures keep positive amounts", () => {
    const inv = xmlOf(sampleInvoiceInput);
    const cn = xmlOf(sampleCreditNoteInput);
    expect(inv).not.toMatch(/>-[0-9]/);
    expect(cn).not.toMatch(/>-[0-9]/);
    expect(amounts(cn, "cbc:PayableAmount")[0]).toBeGreaterThan(0);
  });
});

describe("buildUblXml - negative line with a discount", () => {
  it("emits a positive allowance/charge amount and keeps the net negative", () => {
    const xml = xmlOf({
      ...sampleInvoiceInput,
      invoice: { ...sampleInvoiceInput.invoice, subtotal: -90, vat_total: -18.9, total: -108.9, vat_breakdown: [{ vat_percent: 21, base: -90, amount: -18.9 }] },
      lines: [
        { ...sampleInvoiceInput.lines[0]!, quantity: -1, unit_price: 100, discount_percent: 10, vat_percent: 21, line_total: -90 },
      ],
    });
    expect(xml).toMatch(/<cbc:LineExtensionAmount currencyID="EUR">-90.00</);
    expect(xml).toMatch(/<cbc:ChargeIndicator>true</);
    expect(xml).toMatch(/<cbc:AllowanceChargeReason>Discount</);
    expect(xml).toMatch(/<cbc:Amount currencyID="EUR">10.00</);
    expect(xml).toMatch(/<cbc:BaseAmount currencyID="EUR">100.00</);
  });
});
