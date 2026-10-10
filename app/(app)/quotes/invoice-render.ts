import "server-only";

import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { getOrganizationCompanySettings } from "../settings/company-actions";
import { InvoiceDocument, type InvoicePdfAddress, type InvoicePdfLineItem, type InvoicePdfVatBreakdownEntry } from "./invoice-pdf";

/**
 * Shared invoice PDF rendering (issues #119/#211). NOT a "use server" file:
 * used by the on-demand route handler (`./[id]/invoice/route.ts`) and by the
 * best-effort e-mail step of `invoiceQuote` (`./invoice-actions.ts`). PDFs are
 * rendered from live data every time and never stored; the invoice date is the
 * invoice row's own `generated_at`, the due date is 30 days later.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// ---------------------------------------------------------------------------
// Shared: resolving a client's own postal address for the PDF, and computing
// the money figures from a quote's line items. Both are used only by
// `generateInvoice` below, but pulled out as standalone functions to keep
// that function's own body readable.
// ---------------------------------------------------------------------------

interface SiteAddressRow {
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  is_invoice_address: boolean;
  is_primary: boolean;
}

/**
 * Picks the "best" address to show for a client on the invoice: its
 * `is_invoice_address` site if it has one (the acceptance criterion's own
 * "FACTUUR AAN" requirement), falling back to its `is_primary` site, then
 * simply the first site (alphabetical by address, matching `getClient`'s own
 * site ordering in `../clients/actions.ts`) — rather than rendering no
 * address at all just because a client hasn't explicitly flagged one of its
 * sites as the invoice address. Used for BOTH the recipient (the quote's own
 * client) and the sender (the tenant's own `ownClient`) — there is no
 * separate concept of "the organization's own address" anywhere in this
 * schema, only Sites belonging to its own Client row (`organizations.
 * own_client_id`), so the same resolution applies to both. Returns `null`
 * when the client has no sites at all (renders no address block, not a
 * broken one).
 */
async function resolveClientAddress(
  supabase: SupabaseServerClient,
  clientId: string,
): Promise<InvoicePdfAddress | null> {
  const { data, error } = await supabase
    .from("sites")
    .select("address_line1,address_line2,postal_code,city,country,is_invoice_address,is_primary")
    .eq("client_id", clientId)
    .order("address_line1", { ascending: true });

  if (error || !data || data.length === 0) return null;

  const rows = data as SiteAddressRow[];
  const firstRow = rows[0];
  if (!firstRow) return null; // unreachable given the length check above; satisfies strict indexing
  const chosen = rows.find((s) => s.is_invoice_address) ?? rows.find((s) => s.is_primary) ?? firstRow;

  return {
    line1: chosen.address_line1,
    line2: chosen.address_line2,
    postalCode: chosen.postal_code,
    city: chosen.city,
    country: chosen.country,
  };
}

interface InvoiceQuoteLineItemRow {
  description: string;
  /** Snapshotted at the moment an article was picked (migration
   * `20260903130000_quote_line_items_article_number.sql`) — the row's own
   * plain column, independent of `article_id`/the joined `article` below.
   * Read in preference to the joined article's own `article_number` (see
   * `computeInvoiceLineItems`) since it survives the source article later
   * being deleted (`article_id` is `on delete set null`), unlike the join. */
  article_number: string | null;
  quantity: number | string;
  unit_price: number | string;
  discount_percent: number | string;
  asset_id: string | null;
  article: {
    article_number: string;
    vat_rate: { value: string | number } | null;
  } | null;
}

interface InvoiceAssetLabelRow {
  id: string;
  serial_number: string | null;
  asset_model: { name: string } | null;
}

/** Combines an asset's serial number and model name into the single display
 * string the reference PDF's "SERIENR. / MODEL" column expects — mirrors
 * `quote-line-items-panel.tsx`'s own "degrade gracefully" convention for an
 * optional field (only one half missing still renders the other; both
 * missing renders nothing at all, resolved to `null` here so the PDF's own
 * `?? "—"` fallback applies exactly like every other optional column). */
function formatAssetLabel(asset: Pick<InvoiceAssetLabelRow, "serial_number" | "asset_model"> | undefined): string | null {
  if (!asset) return null;
  const parts = [asset.serial_number, asset.asset_model?.name].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" / ") : null;
}

interface ComputedLineItems {
  lineItems: InvoicePdfLineItem[];
  subtotal: number;
  vatBreakdown: InvoicePdfVatBreakdownEntry[];
  vatTotal: number;
  total: number;
}

/**
 * Replicates `quote-line-items-panel.tsx`'s exact math server-side (per that
 * file's own doc comment, referenced by this feature's hand-off): a line's
 * pre-VAT total is `quantity * unitPrice * (1 - discountPercent / 100)`, its
 * VAT rate is `0` when it has no linked article (`lineVatPercent`'s own
 * reasoning — there is no VAT-rate column on `quote_line_items` itself), and
 * VAT is computed PER LINE then summed — so mixed VAT rates on one quote are
 * handled correctly (each line contributes to its own rate's bucket in
 * `vatBreakdown`, sorted highest-first, matching the reference PDF's single-
 * rate "Btw 21%" line as the one-rate special case of the same general
 * mechanism). Rounds each displayed money figure independently to 2 decimal
 * places (money precision) only at the end, not per intermediate step, same
 * "avoid floating-point summation artifacts" reasoning as `computeTotal` in
 * `../quotes/actions.ts`.
 */
function computeInvoiceLineItems(
  rows: readonly InvoiceQuoteLineItemRow[],
  assetLabelById: ReadonlyMap<string, string | null>,
): ComputedLineItems {
  const vatBuckets = new Map<number, number>();
  let subtotalRaw = 0;

  const lineItems: InvoicePdfLineItem[] = rows.map((row) => {
    const quantity = Number(row.quantity);
    const unitPrice = Number(row.unit_price);
    const discountPercent = Number(row.discount_percent);
    const vatPercent = row.article?.vat_rate?.value ? Number(row.article.vat_rate.value) : 0;

    const lineTotal = quantity * unitPrice * (1 - discountPercent / 100);
    subtotalRaw += lineTotal;
    vatBuckets.set(vatPercent, (vatBuckets.get(vatPercent) ?? 0) + lineTotal * (vatPercent / 100));

    return {
      // Read the row's OWN snapshotted `article_number` column in
      // preference to the joined article's — the row's own column survives
      // the source article later being deleted (`article_id on delete set
      // null`), unlike the join. Falls back to the joined article's number
      // only in the defensive case where the row's own column is somehow
      // null but a live article is still linked (shouldn't normally happen
      // post-backfill/going-forward).
      articleNumber: row.article_number ?? row.article?.article_number ?? null,
      description: row.description,
      // `?? null` here on purpose: no asset linked at all (id is `null`)
      // and "linked but its label couldn't be resolved" (id present but
      // missing from the map — shouldn't happen, same defensive-only
      // reasoning as `quote-line-items-panel.tsx`'s own "Unknown asset"
      // fallback) both degrade to the same blank cell.
      assetLabel: row.asset_id ? (assetLabelById.get(row.asset_id) ?? null) : null,
      quantity,
      unitPrice,
      discountPercent,
      vatPercent,
      lineTotal: Math.round(lineTotal * 100) / 100,
    };
  });

  const vatBreakdown: InvoicePdfVatBreakdownEntry[] = Array.from(vatBuckets.entries())
    .sort(([a], [b]) => b - a)
    .map(([vatPercent, amount]) => ({ vatPercent, amount: Math.round(amount * 100) / 100 }));

  const subtotal = Math.round(subtotalRaw * 100) / 100;
  const vatTotal = Math.round(vatBreakdown.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;

  return { lineItems, subtotal, vatBreakdown, vatTotal, total: Math.round((subtotal + vatTotal) * 100) / 100 };
}

// "en-GB" (not "nl-NL") to match `invoice-pdf.tsx`'s own English-copy switch
// — this formats month names ("3 September 2026"), so leaving it Dutch would
// leave a Dutch month name bleeding into an otherwise all-English PDF.
const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export interface RenderedInvoice {
  pdf: Buffer;
  invoiceId: string;
  invoiceNumber: string;
  quoteName: string;
  clientName: string;
  total: number;
  dueDateLabel: string;
  invoiceDateLabel: string;
}

export type InvoiceRenderErrorCode = "not_invoiced" | "not_found" | "failed";

export const INVOICE_PAYMENT_TERM_DAYS = 30;

export function formatInvoiceTotal(total: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(total);
}

/**
 * Loads the invoice for `quoteId` (RLS-scoped via `supabase`) plus everything
 * the PDF needs and renders it. Returns `{ error }` instead of throwing.
 */
export async function renderInvoicePdfForQuote(
  supabase: SupabaseServerClient,
  quoteId: string,
): Promise<
  | { rendered: RenderedInvoice; error?: undefined; code?: undefined }
  | { rendered?: undefined; error: string; code: InvoiceRenderErrorCode }
> {
  const { data: invoiceRow, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, invoice_number, generated_at")
    .eq("quote_id", quoteId)
    .maybeSingle<{ id: string; invoice_number: string; generated_at: string }>();
  if (invoiceError) return { error: invoiceError.message, code: "failed" };
  if (!invoiceRow) return { error: "This quote has not been invoiced yet.", code: "not_invoiced" };

  const { data: quoteRow, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "id, client_id, site_id, name, notes, work_order_id," +
        " client:clients!quotes_client_id_fkey(id,name,vat_number)," +
        " work_order:work_orders!quotes_work_order_id_fkey(id,title)",
    )
    .eq("id", quoteId)
    .maybeSingle<{
      id: string;
      client_id: string;
      site_id: string | null;
      name: string;
      notes: string | null;
      work_order_id: string | null;
      client: { id: string; name: string; vat_number: string | null } | null;
      work_order: { id: string; title: string } | null;
    }>();
  if (quoteError) return { error: quoteError.message, code: "failed" };
  if (!quoteRow) return { error: "Quote not found, or you do not have permission to view it.", code: "not_found" };
  if (!quoteRow.client) return { error: "This quote's client could not be found.", code: "failed" };

  const { data: lineItemRows, error: lineItemsError } = await supabase
    .from("quote_line_items")
    .select(
      "description, article_number, quantity, unit_price, discount_percent, asset_id," +
        " article:articles!quote_line_items_article_id_fkey(article_number, vat_rate:reference_list_items!articles_vat_rate_item_id_fkey(value))",
    )
    .eq("quote_id", quoteId)
    .order("sort_order", { ascending: true });
  if (lineItemsError) return { error: lineItemsError.message, code: "failed" };

  const lineItemRowsTyped = (lineItemRows ?? []) as unknown as InvoiceQuoteLineItemRow[];
  const assetIds = Array.from(new Set(lineItemRowsTyped.map((row) => row.asset_id).filter((id): id is string => Boolean(id))));

  const { data: assetLabelRowsData, error: assetLabelRowsError } = await supabase
    .from("assets")
    .select("id, serial_number, asset_model:asset_models!assets_model_id_fkey(name)")
    .in("id", assetIds);
  if (assetLabelRowsError) return { error: assetLabelRowsError.message, code: "failed" };

  const assetLabelById = new Map<string, string | null>(
    (assetLabelRowsData as unknown as InvoiceAssetLabelRow[]).map((asset) => [asset.id, formatAssetLabel(asset)]),
  );

  const companySettings = await getOrganizationCompanySettings();
  if (!companySettings.data) return { error: companySettings.error ?? "Could not load organization settings.", code: "failed" };
  const ownClient = companySettings.data.ownClient;
  if (!ownClient) {
    return { error: "Configure your own company details in Settings → Company before generating an invoice.", code: "failed" };
  }

  const [senderAddress, recipientAddress] = await Promise.all([
    resolveClientAddress(supabase, ownClient.id),
    resolveClientAddress(supabase, quoteRow.client_id),
  ]);

  const computed = computeInvoiceLineItems(lineItemRowsTyped, assetLabelById);

  const invoiceDate = new Date(invoiceRow.generated_at);
  const dueDate = addDays(invoiceDate, INVOICE_PAYMENT_TERM_DAYS);
  const invoiceDateLabel = dateFormatter.format(invoiceDate);
  const dueDateLabel = dateFormatter.format(dueDate);

  const pdfElement = createElement(InvoiceDocument, {
    invoiceNumber: invoiceRow.invoice_number,
    invoiceDateLabel,
    dueDateLabel,
    reference: quoteRow.name,
    workOrderReference: quoteRow.work_order?.title ?? null,
    notes: quoteRow.notes,
    sender: {
      name: ownClient.name,
      kvkNumber: ownClient.kvkNumber,
      vatNumber: ownClient.vatNumber,
      address: senderAddress,
      logoUrl: ownClient.logoUrl,
    },
    recipient: {
      name: quoteRow.client.name,
      vatNumber: quoteRow.client.vat_number,
      address: recipientAddress,
    },
    lineItems: computed.lineItems,
    subtotal: computed.subtotal,
    vatBreakdown: computed.vatBreakdown,
    vatTotal: computed.vatTotal,
    total: computed.total,
    iban: ownClient.iban,
  }) as unknown as ReactElement<DocumentProps>;

  try {
    const pdf = await renderToBuffer(pdfElement);
    return {
      rendered: {
        pdf,
        invoiceId: invoiceRow.id,
        invoiceNumber: invoiceRow.invoice_number,
        quoteName: quoteRow.name,
        clientName: quoteRow.client.name,
        total: computed.total,
        dueDateLabel,
        invoiceDateLabel,
      },
    };
  } catch {
    return { error: "Could not render the invoice PDF.", code: "failed" };
  }
}
