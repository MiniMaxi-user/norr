"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { MAX_BATCH_INVOICE_QUOTES } from "./invoice-batch";
import { kickEmailOutbox } from "@/lib/email/outbox";
import { getInvoicePdfById } from "./invoice-render";
import { getLatestInvoiceOutboxStatus, type OutboxMailStatus } from "@/lib/email/outbox-status";
import { sendInvoiceEmailById, type InvoiceEmailOutcome as EmailOutcome } from "./invoice-email";

/**
 * Server Actions for invoicing a quote (issues #119, #211, #227, #232, #233,
 * #234-#236).
 *
 * Flow of `invoiceQuote` ("Generate invoice"):
 *  1. `invoicing` feature + `can(actor, "invoicing", "create")` (owner /
 *     finance / administratie), Zod-validated id.
 *  2. The DB function `create_invoice` does the rest in ONE transaction: role
 *     and quote checks (no live invoice yet, not an auto-draft, not
 *     rejected/expired, has lines, own company configured), the sequential
 *     number, the `invoices` row and the snapshot (`invoice_lines`, totals,
 *     VAT breakdown, payment term + due date, addresses). The existing AFTER
 *     INSERT triggers set the quote to Invoiced, advance the contract period
 *     and move a Completed source work order to Invoiced. There is no direct
 *     INSERT grant on `invoices`.
 *  3. The PDF is rendered from that snapshot and stored (`invoices.pdf_path`),
 *     so every later open and e-mail uses exactly this document.
 *  4. Best effort: e-mail the stored PDF to the client's invoice contact (see
 *     `sendInvoiceEmailById`). Invoicing succeeds even when storing or
 *     e-mailing fails; opening the PDF later stores it then.
 *
 * Since #236 a quote can hold several invoices (credited ones, their credit
 * notes and one live invoice), so everything below works by invoice id.
 *
 * Every query runs under the caller's own session (RLS is the real backstop);
 * no service-role client.
 */

const uuidSchema = z.string().uuid("Invalid id.");

export type InvoiceEmailOutcome = EmailOutcome;

export interface InvoiceQuoteResult {
  invoiceId: string;
  invoiceNumber: string;
  /** Whether the quote now has status 'invoiced' (set by the DB trigger on
   * invoices, re-read after the insert). */
  statusUpdated: boolean;
  email: InvoiceEmailOutcome;
}

/** `create_invoice` raises its own user-facing messages (not invoiced twice,
 * no lines, company details missing, …) with these codes; show those as-is
 * instead of `mapDbError`'s generic text. */
function invoiceDbError(error: { code?: string; message: string }): string {
  if (error.code && ["P0002", "23505", "23514"].includes(error.code)) return error.message;
  if (error.code === "42501") return "Only an owner, finance or administratie member can generate invoices.";
  return mapDbError(error);
}

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * The shared core of "Generate invoice" for ONE quote (used by `invoiceQuote`
 * and, per quote, by `invoiceQuotes`): create the invoice, store the PDF,
 * re-read the quote status and queue the e-mail. `kick: false` skips starting
 * the e-mail processor so a batch can kick it once at the end.
 */
async function invoiceQuoteCore(
  supabase: SupabaseServerClient,
  organizationId: string,
  organizationName: string,
  quoteId: string,
  kick: boolean,
): Promise<ActionResult<InvoiceQuoteResult>> {
  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, client_id")
    .eq("id", quoteId)
    .maybeSingle<{ id: string; client_id: string }>();
  if (quoteError) return fail(mapDbError(quoteError));
  if (!quote) return fail("Quote not found, or you do not have permission to view it.");

  const { data: invoiceId, error: createError } = await supabase.rpc("create_invoice", { p_quote_id: quote.id });
  if (createError) return fail(invoiceDbError(createError));
  if (!invoiceId) return fail("Could not create the invoice.");

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, invoice_number")
    .eq("id", invoiceId as string)
    .single<{ id: string; invoice_number: string }>();
  if (invoiceError) return fail(mapDbError(invoiceError));
  const invoiceNumber = invoice.invoice_number;

  // Store the PDF now (rendered from the snapshot), so the very first open
  // and e-mail already use the stored document. Best effort: when it fails,
  // the first open stores it instead.
  await getInvoicePdfById(supabase, invoice.id);

  // The DB trigger on invoices sets the quote status to 'invoiced'; re-read to report it.
  const { data: statusRow } = await supabase
    .from("quotes")
    .select("quote_status:reference_list_items!quotes_status_id_fkey(value)")
    .eq("id", quote.id)
    .maybeSingle<{ quote_status: { value: string } | null }>();
  const statusUpdated = statusRow?.quote_status?.value === "invoiced";

  const email = await sendInvoiceEmailById(supabase, organizationId, organizationName, invoice.id, { kick });

  return ok({ invoiceId: invoice.id, invoiceNumber, statusUpdated, email });
}

/** "Generate invoice": see the module comment for the full flow. */
export async function invoiceQuote(quoteId: string): Promise<ActionResult<InvoiceQuoteResult>> {
  const idResult = uuidSchema.safeParse(quoteId);
  if (!idResult.success) return fail("Invalid quote id.");

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId, session } = ctx.context;

  if (!can(actor, "invoicing", "create")) {
    return fail("Only an owner, finance or administratie member can generate invoices.");
  }

  const supabase = await createSupabaseServerClient();
  return invoiceQuoteCore(supabase, organizationId, session.organization?.name ?? "", idResult.data, true);
}

// ---------------------------------------------------------------------------
// invoiceQuotes (issue #237)
// ---------------------------------------------------------------------------


/** Stop starting new invoices after this long (the page's maxDuration is 300 s);
 * the rest is reported as not processed so nothing is cut off mid-invoice. */
const BATCH_TIME_BUDGET_MS = 250_000;

const quoteIdsSchema = z
  .array(z.string().uuid("Invalid quote id."))
  .min(1, "Select at least one quote.")
  .max(MAX_BATCH_INVOICE_QUOTES, `You can invoice at most ${MAX_BATCH_INVOICE_QUOTES} quotes at once.`);

export interface InvoiceQuotesResult {
  /** One entry per quote that now has an invoice. */
  invoiced: { quoteId: string; quoteLabel: string; invoiceId: string; invoiceNumber: string }[];
  /** Invoices whose e-mail was queued in the outbox. */
  emailsQueued: number;
  /** Quotes that got no invoice (error), or an invoice whose e-mail failed. */
  problems: { quoteId: string; quoteLabel: string; error: string }[];
}

/**
 * Batch "Generate invoice" (issue #237): every quote goes through exactly the
 * same core as `invoiceQuote`, sequentially; a failure on one quote never stops
 * the rest. E-mails are queued (issue #268) and the processor is kicked once at
 * the end.
 */
export async function invoiceQuotes(quoteIds: string[]): Promise<ActionResult<InvoiceQuotesResult>> {
  const idsResult = quoteIdsSchema.safeParse(quoteIds);
  if (!idsResult.success) return fail(idsResult.error.issues[0]?.message ?? "Invalid selection.");
  const ids = [...new Set(idsResult.data)];

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId, session } = ctx.context;

  if (!can(actor, "invoicing", "create")) {
    return fail("Only an owner, finance or administratie member can generate invoices.");
  }

  const supabase = await createSupabaseServerClient();
  const organizationName = session.organization?.name ?? "";

  const { data: labelRows, error: labelError } = await supabase
    .from("quotes")
    .select("id, quote_number, name")
    .in("id", ids);
  if (labelError) return fail(mapDbError(labelError));
  const labels = new Map(
    ((labelRows ?? []) as { id: string; quote_number: string; name: string }[]).map((row) => [
      row.id,
      row.name ? `${row.quote_number} – ${row.name}` : row.quote_number,
    ]),
  );

  const result: InvoiceQuotesResult = { invoiced: [], emailsQueued: 0, problems: [] };
  const startedAt = Date.now();

  for (const quoteId of ids) {
    const quoteLabel = labels.get(quoteId) ?? quoteId;
    if (Date.now() - startedAt > BATCH_TIME_BUDGET_MS) {
      result.problems.push({ quoteId, quoteLabel, error: "Not processed: the time limit was reached. Select it again." });
      continue;
    }
    try {
      const response = await invoiceQuoteCore(supabase, organizationId, organizationName, quoteId, false);
      if (!response.data) {
        result.problems.push({ quoteId, quoteLabel, error: response.error ?? "Could not create the invoice." });
        continue;
      }
      const { invoiceId, invoiceNumber, email } = response.data;
      result.invoiced.push({ quoteId, quoteLabel, invoiceId, invoiceNumber });
      if (email.status === "queued") {
        result.emailsQueued += 1;
      } else if (email.status === "failed") {
        result.problems.push({
          quoteId,
          quoteLabel,
          error: `Invoice ${invoiceNumber} created, but the e-mail failed: ${email.error}`,
        });
      }
    } catch (error) {
      result.problems.push({ quoteId, quoteLabel, error: error instanceof Error ? error.message : "Unexpected error." });
    }
  }

  if (result.emailsQueued > 0) kickEmailOutbox();
  return ok(result);
}

// ---------------------------------------------------------------------------
// sendInvoiceEmailForInvoice / sendInvoiceEmailForQuote
// ---------------------------------------------------------------------------

/** "Send invoice": manually (re)sends the e-mail of one invoice or credit note
 * — e.g. it was skipped or failed at invoicing time, or the client wants it at
 * a different address (change the invoice contact, then resend). Allowed any
 * number of times; the UI confirms first when it was already sent. Same
 * recipient/recording rules as `sendInvoiceEmailById` (a successful resend
 * overwrites emailed_to/emailed_at). Needs `invoicing` `update`. */
export async function sendInvoiceEmailForInvoice(invoiceId: string): Promise<ActionResult<{ email: InvoiceEmailOutcome }>> {
  const idResult = uuidSchema.safeParse(invoiceId);
  if (!idResult.success) return fail("Invalid invoice id.");

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId, session } = ctx.context;

  if (!can(actor, "invoicing", "update")) {
    return fail("Only an owner, finance or administratie member can send invoices.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id")
    .eq("id", idResult.data)
    .maybeSingle<{ id: string }>();
  if (error) return fail(mapDbError(error));
  if (!invoice) return fail("Invoice not found, or you do not have permission to view it.");

  const email = await sendInvoiceEmailById(supabase, organizationId, session.organization?.name ?? "", invoice.id);
  return ok({ email });
}

/** Quote-level wrapper kept for the existing UI: re-sends the quote's LIVE
 * invoice (kind invoice, not credited). */
export async function sendInvoiceEmailForQuote(quoteId: string): Promise<ActionResult<{ email: InvoiceEmailOutcome }>> {
  const idResult = uuidSchema.safeParse(quoteId);
  if (!idResult.success) return fail("Invalid quote id.");

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  if (!can(ctx.context.actor, "invoicing", "update")) {
    return fail("Only an owner, finance or administratie member can send invoices.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id")
    .eq("quote_id", idResult.data)
    .eq("kind", "invoice")
    .is("credited_at", null)
    .maybeSingle<{ id: string }>();
  if (error) return fail(mapDbError(error));
  if (!invoice) return fail("This quote has not been invoiced yet.");

  return sendInvoiceEmailForInvoice(invoice.id);
}

// ---------------------------------------------------------------------------
// getInvoiceForQuote
// ---------------------------------------------------------------------------

export type InvoicePaymentStatus = "open" | "partially_paid" | "paid" | "overdue" | "credited" | "credit_note";

export interface InvoicePaymentSummary {
  id: string;
  paidOn: string;
  amount: number;
  methodId: string;
  methodLabel: string;
  note: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  /** The payment's creator, or a member whose role has `invoicing` `delete` (owner). */
  canDelete: boolean;
}

export interface InvoiceSummary {
  id: string;
  /** 'credit_note' rows are negative documents that credit `creditsInvoiceId`. */
  kind: "invoice" | "credit_note";
  invoiceNumber: string;
  generatedAt: string;
  /** Snapshot fields (issue #232): fixed at invoicing time. */
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  subtotal: number;
  vatTotal: number;
  /** Negative for a credit note. */
  total: number;
  /** Whether the PDF has been stored (issue #227); false only for an invoice
   * that predates stored PDFs and has not been opened since. */
  pdfStored: boolean;
  emailedTo: string | null;
  emailedAt: string | null;
  emailError: string | null;
  /** Latest e-mail outbox mail of this invoice (issue #268): Queued / Sending / Sent / Failed (+ retry); null when none was queued. */
  outbox: OutboxMailStatus | null;
  /** Credit notes only. */
  creditsInvoiceId: string | null;
  creditsInvoiceNumber: string | null;
  creditReason: string | null;
  /** Set on the ORIGINAL invoice once it has been credited. */
  creditedAt: string | null;
  paymentStatus: InvoicePaymentStatus;
  paidAmount: number;
  /** 0 for credit notes and credited invoices. */
  outstanding: number;
  /** Oldest first. */
  payments: InvoicePaymentSummary[];
}

interface OverviewRow {
  id: string;
  kind: "invoice" | "credit_note";
  invoice_number: string;
  generated_at: string;
  invoice_date: string;
  due_date: string;
  payment_term_days: number;
  subtotal: number | string;
  vat_total: number | string;
  total: number | string;
  pdf_path: string | null;
  emailed_to: string | null;
  emailed_at: string | null;
  email_error: string | null;
  credits_invoice_id: string | null;
  credit_reason: string | null;
  credited_at: string | null;
  paid_amount: number | string | null;
  outstanding: number | string | null;
  payment_status: InvoicePaymentStatus;
}

interface PaymentRow {
  id: string;
  invoice_id: string;
  paid_on: string;
  amount: number | string;
  method_id: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

const OVERVIEW_COLUMNS =
  "id, kind, invoice_number, generated_at, invoice_date, due_date, payment_term_days, subtotal, vat_total, total, pdf_path," +
  " emailed_to, emailed_at, email_error, credits_invoice_id, credit_reason, credited_at, paid_amount, outstanding, payment_status";

/** All invoices and credit notes of `quoteId` (newest first) with their derived
 * payment status and payments. The live invoice (kind invoice, not credited)
 * is also returned separately as `invoice` — it drives "Generate invoice" vs.
 * "Open PDF" on the Quote detail page. PDFs are served by
 * `GET /invoices/[id]/pdf` (and `GET /quotes/[id]/invoice` for the live one). */
export async function getInvoiceForQuote(
  quoteId: string,
): Promise<ActionResult<{ invoice: InvoiceSummary | null; invoices: InvoiceSummary[] }>> {
  const idResult = uuidSchema.safeParse(quoteId);
  if (!idResult.success) return fail("Invalid quote id.");

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, session } = ctx.context;

  if (!can(actor, "invoicing", "read")) {
    return fail("You do not have permission to view invoices.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invoice_overview")
    .select(OVERVIEW_COLUMNS)
    .eq("quote_id", idResult.data)
    .order("generated_at", { ascending: false });
  if (error) return fail(mapDbError(error));

  const rows = (data ?? []) as unknown as OverviewRow[];
  if (rows.length === 0) return ok({ invoice: null, invoices: [] });

  const { data: paymentData, error: paymentError } = await supabase
    .from("invoice_payments")
    .select("id, invoice_id, paid_on, amount, method_id, note, created_by, created_at")
    .in(
      "invoice_id",
      rows.map((row) => row.id),
    )
    .order("paid_on", { ascending: true })
    .order("created_at", { ascending: true });
  if (paymentError) return fail(mapDbError(paymentError));
  const paymentRows = (paymentData ?? []) as unknown as PaymentRow[];

  const methodIds = [...new Set(paymentRows.map((p) => p.method_id))];
  const userIds = [...new Set(paymentRows.map((p) => p.created_by).filter((id): id is string => Boolean(id)))];
  const [methodResult, userResult] = await Promise.all([
    methodIds.length > 0
      ? supabase.from("reference_list_items").select("id, label").in("id", methodIds)
      : Promise.resolve({ data: [] as { id: string; label: string }[] }),
    userIds.length > 0
      ? supabase.from("users").select("id, full_name, email").in("id", userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
  ]);
  const methodLabels = new Map((methodResult.data ?? []).map((m) => [m.id as string, m.label as string]));
  const userNames = new Map(
    (userResult.data ?? []).map((u) => [
      u.id as string,
      ((u.full_name as string | null)?.trim() || (u.email as string | null)) ?? null,
    ]),
  );

  const outboxById = await getLatestInvoiceOutboxStatus(
    supabase,
    rows.map((row) => row.id),
    can(actor, "invoicing", "update"),
  );
  const canDeleteAny = can(actor, "invoicing", "delete");
  const numberById = new Map(rows.map((row) => [row.id, row.invoice_number]));

  const invoices: InvoiceSummary[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    invoiceNumber: row.invoice_number,
    generatedAt: row.generated_at,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    paymentTermDays: row.payment_term_days,
    subtotal: Number(row.subtotal),
    vatTotal: Number(row.vat_total),
    total: Number(row.total),
    pdfStored: Boolean(row.pdf_path),
    emailedTo: row.emailed_to,
    emailedAt: row.emailed_at,
    emailError: row.email_error,
    outbox: outboxById.get(row.id) ?? null,
    creditsInvoiceId: row.credits_invoice_id,
    creditsInvoiceNumber: row.credits_invoice_id ? (numberById.get(row.credits_invoice_id) ?? null) : null,
    creditReason: row.credit_reason,
    creditedAt: row.credited_at,
    paymentStatus: row.payment_status,
    paidAmount: Number(row.paid_amount ?? 0),
    outstanding: Number(row.outstanding ?? 0),
    payments: paymentRows
      .filter((p) => p.invoice_id === row.id)
      .map((p) => ({
        id: p.id,
        paidOn: p.paid_on,
        amount: Number(p.amount),
        methodId: p.method_id,
        methodLabel: methodLabels.get(p.method_id) ?? "",
        note: p.note,
        createdBy: p.created_by,
        createdByName: p.created_by ? (userNames.get(p.created_by) ?? null) : null,
        createdAt: p.created_at,
        canDelete: canDeleteAny || p.created_by === session.userId,
      })),
  }));

  const live = invoices.find((invoice) => invoice.kind === "invoice" && !invoice.creditedAt) ?? null;
  return ok({ invoice: live, invoices });
}
