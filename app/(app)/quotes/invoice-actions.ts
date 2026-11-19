"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { sendEmail } from "@/lib/email/resend";
import { formatInvoiceTotal, getInvoicePdfForQuote } from "./invoice-render";
import {
  DEFAULT_INVOICE_EMAIL_BODY,
  DEFAULT_INVOICE_EMAIL_SUBJECT,
  renderInvoiceEmailTemplate,
} from "./invoice-email-schema";

/**
 * Server Actions for invoicing a quote (issues #119, #211, #227, #232, #233).
 *
 * Flow of `invoiceQuote` ("Generate invoice"):
 *  1. `invoicing` feature + `can(actor, "invoicing", "create")` (owner /
 *     administratie), Zod-validated id.
 *  2. The DB function `create_invoice` does the rest in ONE transaction: role
 *     and quote checks (not already invoiced, not an auto-draft, not
 *     rejected/expired, has lines, own company configured), the sequential
 *     number, the `invoices` row and the snapshot (`invoice_lines`, totals,
 *     VAT breakdown, payment term + due date, addresses). The existing AFTER
 *     INSERT triggers set the quote to Invoiced, advance the contract period
 *     and move a Completed source work order to Invoiced. There is no direct
 *     INSERT grant on `invoices` any more.
 *  3. The PDF is rendered from that snapshot and stored (`invoices.pdf_path`),
 *     so every later open and e-mail uses exactly this document.
 *  4. Best effort: e-mail the stored PDF to the client's invoice contact (see
 *     `sendInvoiceEmail`). Invoicing succeeds even when storing or e-mailing
 *     fails; opening the PDF later stores it then.
 *
 * Every query runs under the caller's own session (RLS is the real backstop);
 * no service-role client.
 */

const uuidSchema = z.string().uuid("Invalid id.");

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type InvoiceEmailOutcome =
  | { status: "sent"; to: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; to: string | null; error: string };

export interface InvoiceQuoteResult {
  invoiceId: string;
  invoiceNumber: string;
  /** Whether the quote now has status 'invoiced' (set by the DB trigger on
   * invoices, re-read after the insert). */
  statusUpdated: boolean;
  email: InvoiceEmailOutcome;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** `create_invoice` raises its own user-facing messages (not invoiced twice,
 * no lines, company details missing, …) with these codes; show those as-is
 * instead of `mapDbError`'s generic text. */
function invoiceDbError(error: { code?: string; message: string }): string {
  if (error.code && ["P0002", "23505", "23514"].includes(error.code)) return error.message;
  if (error.code === "42501") return "Only an owner or administratie member can generate invoices.";
  return mapDbError(error);
}

function formatMailbox(name: string | null, email: string): string {
  const cleanName = (name ?? "").replace(/[<>",\r\n]/g, " ").replace(/\s+/g, " ").trim();
  return cleanName ? `${cleanName} <${email}>` : email;
}

interface InvoiceEmailSettingsRow {
  from_email: string | null;
  from_name: string | null;
  cc_email: string | null;
  subject_template: string | null;
  body_template: string | null;
}

/**
 * Best-effort invoice e-mail. Never throws. Recipient = the invoice contact of
 * the client's `is_invoice_address` site.
 *
 * Recording policy on `invoices` (emailed_to / emailed_at / email_error):
 *  - no invoice-address site, or no invoice contact on it: nothing is sent and
 *    NOTHING is recorded (a legitimate "don't e-mail" configuration).
 *  - contact without e-mail address: email_error = "Invoice contact has no
 *    e-mail address".
 *  - sender not configured: email_error = "Invoice email sender not configured".
 *  - provider/render failure: email_error = the error message.
 *  - success: emailed_to + emailed_at set, email_error cleared.
 */
async function sendInvoiceEmail(
  supabase: SupabaseServerClient,
  organizationId: string,
  organizationName: string,
  quoteId: string,
  clientId: string,
): Promise<InvoiceEmailOutcome> {
  try {
    const { data: invoiceSites, error: siteError } = await supabase
      .from("sites")
      .select("invoice_contact_id")
      .eq("client_id", clientId)
      .eq("is_invoice_address", true)
      .not("invoice_contact_id", "is", null);
    if (siteError) return { status: "failed", to: null, error: siteError.message };

    const contactId = (invoiceSites ?? []).map((s) => s.invoice_contact_id as string | null).find(Boolean);
    if (!contactId) return { status: "skipped", reason: "No invoice address or invoice contact" };

    const { data: invoiceRow } = await supabase
      .from("invoices")
      .select("id")
      .eq("quote_id", quoteId)
      .maybeSingle<{ id: string }>();
    if (!invoiceRow) return { status: "failed", to: null, error: "Invoice not found" };

    const record = async (patch: {
      emailed_to?: string | null;
      emailed_at?: string | null;
      email_error: string | null;
    }) => {
      await supabase.from("invoices").update(patch).eq("id", invoiceRow.id);
    };

    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("email")
      .eq("id", contactId)
      .maybeSingle<{ email: string | null }>();
    if (contactError) return { status: "failed", to: null, error: contactError.message };

    const rawEmail = contact?.email?.trim() || null;
    if (!rawEmail) {
      const error = "Invoice contact has no e-mail address";
      await record({ email_error: error });
      return { status: "failed", to: null, error };
    }
    if (!z.string().email().safeParse(rawEmail).success) {
      const error = "Invoice contact has an invalid e-mail address";
      await record({ email_error: error });
      return { status: "failed", to: null, error };
    }
    const to = rawEmail;

    const { data: settings } = await supabase
      .from("invoice_email_settings")
      .select("from_email, from_name, cc_email, subject_template, body_template")
      .eq("organization_id", organizationId)
      .maybeSingle<InvoiceEmailSettingsRow>();

    if (!settings?.from_email) {
      const error = "Invoice email sender not configured";
      await record({ email_error: error });
      return { status: "failed", to, error };
    }

    const { result: rendered, error: renderError } = await getInvoicePdfForQuote(supabase, quoteId);
    if (!rendered) {
      const error = renderError ?? "Could not render the invoice PDF.";
      await record({ email_error: error });
      return { status: "failed", to, error };
    }

    const { data: quoteRow } = await supabase
      .from("quotes")
      .select("name")
      .eq("id", quoteId)
      .maybeSingle<{ name: string }>();

    const values = {
      invoice_number: rendered.invoiceNumber,
      client_name: rendered.clientName,
      quote_name: quoteRow?.name ?? rendered.reference,
      total: formatInvoiceTotal(rendered.total),
      due_date: rendered.dueDateLabel,
      organization_name: organizationName,
    };
    const subject = renderInvoiceEmailTemplate(settings.subject_template || DEFAULT_INVOICE_EMAIL_SUBJECT, values)
      .replace(/[\r\n]+/g, " ")
      .trim();
    const text = renderInvoiceEmailTemplate(settings.body_template || DEFAULT_INVOICE_EMAIL_BODY, values);
    const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</div>`;

    const sent = await sendEmail({
      from: formatMailbox(settings.from_name, settings.from_email),
      to: [to],
      cc: settings.cc_email ? [settings.cc_email] : undefined,
      subject,
      text,
      html,
      attachments: [{ filename: `${rendered.invoiceNumber}.pdf`, content: rendered.pdf }],
    });

    if (!sent.ok) {
      await record({ email_error: sent.error });
      return { status: "failed", to, error: sent.error };
    }

    await record({ emailed_to: to, emailed_at: new Date().toISOString(), email_error: null });
    return { status: "sent", to };
  } catch (error) {
    return { status: "failed", to: null, error: error instanceof Error ? error.message : "Unexpected e-mail error" };
  }
}

/** "Generate invoice": see the module comment for the full flow. */
export async function invoiceQuote(quoteId: string): Promise<ActionResult<InvoiceQuoteResult>> {
  const idResult = uuidSchema.safeParse(quoteId);
  if (!idResult.success) return fail("Invalid quote id.");

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId, session } = ctx.context;

  if (!can(actor, "invoicing", "create")) {
    return fail("Only an owner or administratie member can generate invoices.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, client_id")
    .eq("id", idResult.data)
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
  await getInvoicePdfForQuote(supabase, quote.id);

  // The DB trigger on invoices sets the quote status to 'invoiced'; re-read to report it.
  const { data: statusRow } = await supabase
    .from("quotes")
    .select("quote_status:reference_list_items!quotes_status_id_fkey(value)")
    .eq("id", quote.id)
    .maybeSingle<{ quote_status: { value: string } | null }>();
  const statusUpdated = statusRow?.quote_status?.value === "invoiced";

  const email = await sendInvoiceEmail(
    supabase,
    organizationId,
    session.organization?.name ?? "",
    quote.id,
    quote.client_id,
  );

  return ok({ invoiceId: invoice.id, invoiceNumber, statusUpdated, email });
}

// ---------------------------------------------------------------------------
// sendInvoiceEmailForQuote
// ---------------------------------------------------------------------------

/** "Send invoice": manually (re)sends the invoice e-mail for an invoiced quote
 * — e.g. it was skipped or failed at invoicing time, or the client wants it at
 * a different address (change the invoice contact, then resend). Allowed any
 * number of times; the UI confirms first when it was already sent. Same
 * recipient/recording rules as `sendInvoiceEmail` (a successful resend
 * overwrites emailed_to/emailed_at). */
export async function sendInvoiceEmailForQuote(quoteId: string): Promise<ActionResult<{ email: InvoiceEmailOutcome }>> {
  const idResult = uuidSchema.safeParse(quoteId);
  if (!idResult.success) return fail("Invalid quote id.");

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId, session } = ctx.context;

  if (!can(actor, "invoicing", "create")) {
    return fail("Only an owner or administratie member can send invoices.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, client_id")
    .eq("id", idResult.data)
    .maybeSingle<{ id: string; client_id: string }>();
  if (quoteError) return fail(mapDbError(quoteError));
  if (!quote) return fail("Quote not found, or you do not have permission to view it.");

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id")
    .eq("quote_id", quote.id)
    .maybeSingle<{ id: string }>();
  if (invoiceError) return fail(mapDbError(invoiceError));
  if (!invoice) return fail("This quote has not been invoiced yet.");

  const email = await sendInvoiceEmail(supabase, organizationId, session.organization?.name ?? "", quote.id, quote.client_id);
  return ok({ email });
}

// ---------------------------------------------------------------------------
// getInvoiceForQuote
// ---------------------------------------------------------------------------

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  generatedAt: string;
  /** Snapshot fields (issue #232): fixed at invoicing time. */
  invoiceDate: string;
  dueDate: string;
  paymentTermDays: number;
  subtotal: number;
  vatTotal: number;
  total: number;
  /** Whether the PDF has been stored (issue #227); false only for an invoice
   * that predates stored PDFs and has not been opened since. */
  pdfStored: boolean;
  emailedTo: string | null;
  emailedAt: string | null;
  emailError: string | null;
}

/** Whether `quoteId` already has an invoice (drives "Generate invoice" vs.
 * "Open PDF" on the Quote detail page), with its snapshot amounts and due
 * date. The PDF itself is served by `GET /quotes/[id]/invoice`. */
export async function getInvoiceForQuote(
  quoteId: string,
): Promise<ActionResult<{ invoice: InvoiceSummary | null }>> {
  const idResult = uuidSchema.safeParse(quoteId);
  if (!idResult.success) return fail("Invalid quote id.");

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "invoicing", "read")) {
    return fail("You do not have permission to view invoices.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, generated_at, invoice_date, due_date, payment_term_days, subtotal, vat_total, total, pdf_path," +
        " emailed_to, emailed_at, email_error",
    )
    .eq("quote_id", idResult.data)
    .maybeSingle<{
      id: string;
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
    }>();

  if (error) return fail(mapDbError(error));
  if (!data) return ok({ invoice: null });

  return ok({
    invoice: {
      id: data.id,
      invoiceNumber: data.invoice_number,
      generatedAt: data.generated_at,
      invoiceDate: data.invoice_date,
      dueDate: data.due_date,
      paymentTermDays: data.payment_term_days,
      subtotal: Number(data.subtotal),
      vatTotal: Number(data.vat_total),
      total: Number(data.total),
      pdfStored: Boolean(data.pdf_path),
      emailedTo: data.emailed_to,
      emailedAt: data.emailed_at,
      emailError: data.email_error,
    },
  });
}
