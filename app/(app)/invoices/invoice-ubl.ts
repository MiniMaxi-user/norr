import "server-only";

import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { buildUblXml, sanitizeFilename, type UblInput, type UblLine, type UblMissingField } from "@/lib/invoicing/ubl";

/**
 * UBL e-invoice of one invoice / credit note (issue #241). NOT a "use server"
 * file: shared by `./[id]/ubl/route.ts` and the e-mail step in
 * `../quotes/invoice-email.ts`. Everything is built from the frozen invoice
 * SNAPSHOT (`invoices` snapshot columns + `invoice_lines`), under the caller's
 * own session (RLS). The XML is stored once in the private `invoices` bucket at
 * `{organization_id}/{quote_id}/{invoice_number}.xml` and `invoices.ubl_path`
 * is set once (DB-guarded), so every later request serves the same file.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const BUCKET = "invoices";

interface UblInvoiceRow {
  id: string;
  organization_id: string;
  quote_id: string;
  kind: "invoice" | "credit_note";
  credits_invoice_id: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  payment_term_days: number;
  currency: string | null;
  subtotal: number | string;
  vat_total: number | string;
  total: number | string;
  vat_breakdown: { vat_percent: number | string; base: number | string; amount: number | string }[] | null;
  reference: string | null;
  notes: string | null;
  recipient: NonNullable<UblInput["invoice"]["recipient"]>;
  sender: UblInput["invoice"]["sender"];
  ubl_path: string | null;
}

const UBL_INVOICE_COLUMNS =
  "id, organization_id, quote_id, kind, credits_invoice_id, invoice_number, invoice_date, due_date, payment_term_days, currency," +
  " subtotal, vat_total, total, vat_breakdown, reference, notes, recipient, sender, ubl_path";

const UBL_LINE_COLUMNS =
  "sort_order, article_number, description, asset_label, quantity, unit_price, discount_percent, vat_percent, line_total";

/** Canonical storage path; the DB guard on `invoices.ubl_path` enforces the same shape. */
export function invoiceUblPath(row: Pick<UblInvoiceRow, "organization_id" | "quote_id" | "invoice_number">): string {
  return `${row.organization_id}/${row.quote_id}/${row.invoice_number}.xml`;
}

export type InvoiceUblErrorCode = "not_found" | "failed";

export type InvoiceUblOutcome =
  | {
      ok: true;
      xml: string;
      filename: string;
      invoiceNumber: string;
      /** Storage path of the stored file; null when it could not be stored (download-only mode). */
      path: string | null;
    }
  | { ok: false; code: InvoiceUblErrorCode; error: string; missing?: undefined }
  | { ok: false; code: "missing_fields"; error: string; missing: UblMissingField[] };

async function download(supabase: SupabaseServerClient, path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return await data.text();
}

/**
 * The UBL file of invoice/credit note `invoiceId`. The stored file when there
 * is one; otherwise it is built from the snapshot and stored (first use).
 *
 * `requireStored`: when true (e-mail attachment) a file that could not be
 * stored/linked is an error, because the outbox references the stored file.
 * When false (download) storing is best effort: a read-only role cannot set
 * `ubl_path`, and still gets its download.
 */
export async function getInvoiceUbl(
  supabase: SupabaseServerClient,
  invoiceId: string,
  options: { requireStored?: boolean } = {},
): Promise<InvoiceUblOutcome> {
  const { data, error } = await supabase.from("invoices").select(UBL_INVOICE_COLUMNS).eq("id", invoiceId).maybeSingle();
  if (error) return { ok: false, code: "failed", error: error.message };
  if (!data) return { ok: false, code: "not_found", error: "Invoice not found." };
  const invoice = data as unknown as UblInvoiceRow;
  const filename = sanitizeFilename(invoice.invoice_number);

  if (invoice.ubl_path) {
    const stored = await download(supabase, invoice.ubl_path);
    if (stored === null) {
      return { ok: false, code: "failed", error: `The stored UBL file of invoice ${invoice.invoice_number} could not be read.` };
    }
    return { ok: true, xml: stored, filename, invoiceNumber: invoice.invoice_number, path: invoice.ubl_path };
  }

  const { data: lineData, error: linesError } = await supabase
    .from("invoice_lines")
    .select(UBL_LINE_COLUMNS)
    .eq("invoice_id", invoice.id)
    .order("sort_order", { ascending: true });
  if (linesError) return { ok: false, code: "failed", error: linesError.message };

  let originalInvoice: UblInput["originalInvoice"] = null;
  if (invoice.kind === "credit_note" && invoice.credits_invoice_id) {
    const { data: original } = await supabase
      .from("invoices")
      .select("invoice_number, invoice_date")
      .eq("id", invoice.credits_invoice_id)
      .maybeSingle<{ invoice_number: string; invoice_date: string }>();
    originalInvoice = original ?? null;
  }

  const built = buildUblXml({
    invoice: {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      kind: invoice.kind,
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date,
      currency: invoice.currency || "EUR",
      subtotal: invoice.subtotal,
      vat_total: invoice.vat_total,
      total: invoice.total,
      vat_breakdown: invoice.vat_breakdown ?? [],
      reference: invoice.reference,
      notes: invoice.notes,
      payment_term_days: invoice.payment_term_days,
      recipient: invoice.recipient,
      sender: invoice.sender,
    },
    lines: (lineData ?? []) as unknown as UblLine[],
    originalInvoice,
  });
  if (!built.ok) {
    return {
      ok: false,
      code: "missing_fields",
      error: `The UBL file cannot be created: ${built.missing.map((m) => m.message).join("; ")}`,
      missing: built.missing,
    };
  }

  const path = invoiceUblPath(invoice);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, new Blob([built.xml], { type: "application/xml" }), { contentType: "application/xml", upsert: false });

  let stored = !uploadError;
  let xml = built.xml;
  if (uploadError) {
    // Someone else stored it first: serve that file, so every request returns the same document.
    const existing = await download(supabase, path);
    if (existing !== null) {
      xml = existing;
      stored = true;
    }
  }

  let linked = false;
  if (stored) {
    const { data: updated, error: pathError } = await supabase
      .from("invoices")
      .update({ ubl_path: path })
      .eq("id", invoice.id)
      .is("ubl_path", null)
      .select("id");
    linked = !pathError && (updated?.length ?? 0) > 0;
    if (!linked) {
      // Maybe a concurrent request linked it already.
      const { data: again } = await supabase
        .from("invoices")
        .select("ubl_path")
        .eq("id", invoice.id)
        .maybeSingle<{ ubl_path: string | null }>();
      linked = again?.ubl_path === path;
    }
  }

  if (options.requireStored && !linked) {
    return { ok: false, code: "failed", error: `The UBL file of invoice ${invoice.invoice_number} could not be stored.` };
  }
  return { ok: true, xml, filename, invoiceNumber: invoice.invoice_number, path: linked ? path : null };
}

/** Builds + stores the UBL file (see `getInvoiceUbl` with `requireStored`). */
export async function ensureInvoiceUbl(supabase: SupabaseServerClient, invoiceId: string): Promise<InvoiceUblOutcome> {
  return getInvoiceUbl(supabase, invoiceId, { requireStored: true });
}
