import "server-only";

import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getClientLogoUrl } from "@/lib/clients/logo-url";
import { InvoiceDocument, type InvoicePdfAddress, type InvoicePdfLineItem } from "./invoice-pdf";

/**
 * Invoice PDF: render once, store, serve the stored file (issues #227/#232).
 * NOT a "use server" file: used by the route handler (`./[id]/invoice/route.ts`)
 * and the e-mail step in `./invoice-actions.ts`.
 *
 * Everything printed comes from the invoice SNAPSHOT (`invoices` snapshot
 * columns + `invoice_lines`, written by the DB function `create_invoice` /
 * `snapshot_invoice`), never from the live quote, articles or client. The PDF
 * is rendered from that snapshot the first time it is needed (right after
 * invoicing, or on first open of an invoice that predates stored PDFs), stored
 * in the private `invoices` bucket at `{organization_id}/{quote_id}/{invoice_number}.pdf`
 * and `invoices.pdf_path` is set (once, DB-guarded). From then on the stored
 * file is returned as-is. Every call runs under the caller's own session (RLS).
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const BUCKET = "invoices";

interface SnapshotAddressJson {
  line1: string | null;
  line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
}

interface InvoiceRow {
  id: string;
  organization_id: string;
  quote_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  payment_term_days: number;
  subtotal: number | string;
  vat_total: number | string;
  total: number | string;
  vat_breakdown: { vat_percent: number | string; base: number | string; amount: number | string }[];
  reference: string | null;
  work_order_reference: string | null;
  notes: string | null;
  recipient: { name: string; vat_number: string | null; address: SnapshotAddressJson | null };
  sender: {
    name: string;
    kvk_number: string | null;
    vat_number: string | null;
    iban: string | null;
    logo_path: string | null;
    address: SnapshotAddressJson | null;
  } | null;
  pdf_path: string | null;
}

interface InvoiceLineRow {
  article_number: string | null;
  description: string;
  asset_label: string | null;
  quantity: number | string;
  unit_price: number | string;
  discount_percent: number | string;
  vat_percent: number | string;
  line_total: number | string;
}

const INVOICE_COLUMNS =
  "id, organization_id, quote_id, invoice_number, invoice_date, due_date, payment_term_days, subtotal, vat_total, total," +
  " vat_breakdown, reference, work_order_reference, notes, recipient, sender, pdf_path";

// "en-GB" (not "nl-NL") to match `invoice-pdf.tsx`'s English copy.
const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** `YYYY-MM-DD` (a Postgres `date`) as "19 November 2026". */
export function formatInvoiceDate(isoDate: string): string {
  return dateFormatter.format(new Date(`${isoDate}T00:00:00Z`));
}

export function formatInvoiceTotal(total: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(total);
}

function toAddress(json: SnapshotAddressJson | null | undefined): InvoicePdfAddress | null {
  if (!json) return null;
  return {
    line1: json.line1,
    line2: json.line2,
    postalCode: json.postal_code,
    city: json.city,
    country: json.country,
  };
}

/** Canonical storage path; the DB guard on `invoices.pdf_path` enforces the same shape. */
export function invoicePdfPath(row: Pick<InvoiceRow, "organization_id" | "quote_id" | "invoice_number">): string {
  return `${row.organization_id}/${row.quote_id}/${row.invoice_number}.pdf`;
}

async function renderFromSnapshot(
  supabase: SupabaseServerClient,
  invoice: InvoiceRow,
): Promise<{ pdf: Buffer; error?: undefined } | { pdf?: undefined; error: string }> {
  const { data: lineData, error: linesError } = await supabase
    .from("invoice_lines")
    .select("article_number, description, asset_label, quantity, unit_price, discount_percent, vat_percent, line_total")
    .eq("invoice_id", invoice.id)
    .order("sort_order", { ascending: true });
  if (linesError) return { error: linesError.message };

  if (!invoice.sender) {
    return { error: "Configure your own company details in Settings → Company before generating an invoice." };
  }

  const lineItems: InvoicePdfLineItem[] = ((lineData ?? []) as InvoiceLineRow[]).map((line) => ({
    articleNumber: line.article_number,
    description: line.description,
    assetLabel: line.asset_label,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unit_price),
    discountPercent: Number(line.discount_percent),
    vatPercent: Number(line.vat_percent),
    lineTotal: Number(line.line_total),
  }));

  const element = createElement(InvoiceDocument, {
    invoiceNumber: invoice.invoice_number,
    invoiceDateLabel: formatInvoiceDate(invoice.invoice_date),
    dueDateLabel: formatInvoiceDate(invoice.due_date),
    reference: invoice.reference ?? "",
    workOrderReference: invoice.work_order_reference,
    notes: invoice.notes,
    sender: {
      name: invoice.sender.name,
      kvkNumber: invoice.sender.kvk_number,
      vatNumber: invoice.sender.vat_number,
      address: toAddress(invoice.sender.address),
      logoUrl: getClientLogoUrl(invoice.sender.logo_path, null),
    },
    recipient: {
      name: invoice.recipient.name,
      vatNumber: invoice.recipient.vat_number,
      address: toAddress(invoice.recipient.address),
    },
    lineItems,
    subtotal: Number(invoice.subtotal),
    vatBreakdown: invoice.vat_breakdown.map((entry) => ({
      vatPercent: Number(entry.vat_percent),
      amount: Number(entry.amount),
    })),
    vatTotal: Number(invoice.vat_total),
    total: Number(invoice.total),
    iban: invoice.sender.iban,
    paymentTermDays: invoice.payment_term_days,
  }) as unknown as ReactElement<DocumentProps>;

  try {
    return { pdf: await renderToBuffer(element) };
  } catch {
    return { error: "Could not render the invoice PDF." };
  }
}

async function download(supabase: SupabaseServerClient, path: string): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export interface InvoicePdf {
  pdf: Buffer;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  reference: string;
  total: number;
  invoiceDateLabel: string;
  dueDateLabel: string;
}

export type InvoicePdfErrorCode = "not_invoiced" | "failed";

/**
 * The invoice PDF of `quoteId`: the stored file when there is one; otherwise
 * render it from the snapshot, store it and record `pdf_path` (first open).
 * Two concurrent first opens are safe: the loser's upload fails because the
 * object exists (no upsert), and it then reads the winner's file.
 */
export async function getInvoicePdfForQuote(
  supabase: SupabaseServerClient,
  quoteId: string,
): Promise<{ result: InvoicePdf; error?: undefined; code?: undefined } | { result?: undefined; error: string; code: InvoicePdfErrorCode }> {
  const { data, error } = await supabase.from("invoices").select(INVOICE_COLUMNS).eq("quote_id", quoteId).maybeSingle();
  if (error) return { error: error.message, code: "failed" };
  if (!data) return { error: "This quote has not been invoiced yet.", code: "not_invoiced" };
  const invoice = data as unknown as InvoiceRow;

  const meta = {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    clientName: invoice.recipient.name,
    reference: invoice.reference ?? "",
    total: Number(invoice.total),
    invoiceDateLabel: formatInvoiceDate(invoice.invoice_date),
    dueDateLabel: formatInvoiceDate(invoice.due_date),
  };

  if (invoice.pdf_path) {
    const stored = await download(supabase, invoice.pdf_path);
    if (!stored) return { error: `The stored PDF of invoice ${invoice.invoice_number} could not be read.`, code: "failed" };
    return { result: { pdf: stored, ...meta } };
  }

  const rendered = await renderFromSnapshot(supabase, invoice);
  if (!rendered.pdf) return { error: rendered.error, code: "failed" };

  const path = invoicePdfPath(invoice);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, rendered.pdf, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    // Someone else stored it first: serve that file, so every open shows the same document.
    const existing = await download(supabase, path);
    if (!existing) {
      return { error: `Invoice ${invoice.invoice_number} could not be stored: ${uploadError.message}`, code: "failed" };
    }
    await supabase.from("invoices").update({ pdf_path: path }).eq("id", invoice.id).is("pdf_path", null);
    return { result: { pdf: existing, ...meta } };
  }

  const { error: pathError } = await supabase
    .from("invoices")
    .update({ pdf_path: path })
    .eq("id", invoice.id)
    .is("pdf_path", null);
  if (pathError) {
    return { error: `Invoice ${invoice.invoice_number} was stored but could not be linked: ${pathError.message}`, code: "failed" };
  }

  return { result: { pdf: rendered.pdf, ...meta } };
}
