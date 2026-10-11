"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { sendEmail } from "@/lib/email/resend";
import { getOrganizationCompanySettings } from "../settings/company-actions";
import { formatInvoiceTotal, renderInvoicePdfForQuote } from "./invoice-render";
import {
  DEFAULT_INVOICE_EMAIL_BODY,
  DEFAULT_INVOICE_EMAIL_SUBJECT,
  renderInvoiceEmailTemplate,
} from "./invoice-email-schema";

/**
 * Server Actions for invoicing a quote (issues #119, #211).
 *
 * Flow of `invoiceQuote` ("Generate invoice"):
 *  1. `invoicing` feature + `can(actor, "invoicing", "create")` (owner /
 *     administratie), Zod-validated id.
 *  2. Refuse if the quote already has an invoice (invoices are permanent: no
 *     regenerate, no delete).
 *  3. Mint the sequential number (`next_invoice_number` RPC), INSERT the
 *     `invoices` row (`pdf_path` stays null). The DB trigger
 *     `invoices_advance_contract_period` then advances the contract's
 *     invoiced period / next invoice date for contract quotes.
 *  4. The DB trigger on invoices sets the quote status to 'invoiced'.
 *  5. Best effort, after the commit: render the PDF on demand and e-mail it to
 *     the client's invoice contact (see `sendInvoiceEmail`). Invoicing
 *     succeeds even when the e-mail is skipped or fails.
 *
 * PDFs are never stored: they are rendered on demand by the route handler
 * `GET /quotes/[id]/invoice` and by the e-mail step, both via
 * `./invoice-render.ts`. Every query runs under the caller's own session (RLS
 * is the real backstop); no service-role client.
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

    const { rendered, error: renderError } = await renderInvoicePdfForQuote(supabase, quoteId);
    if (!rendered) {
      const error = renderError ?? "Could not render the invoice PDF.";
      await record({ email_error: error });
      return { status: "failed", to, error };
    }

    const values = {
      invoice_number: rendered.invoiceNumber,
      client_name: rendered.clientName,
      quote_name: rendered.quoteName,
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

  const { data: existing, error: existingError } = await supabase
    .from("invoices")
    .select("id")
    .eq("quote_id", quote.id)
    .maybeSingle<{ id: string }>();
  if (existingError) return fail(mapDbError(existingError));
  if (existing) return fail("This quote has already been invoiced.");

  // Fail early (before burning an invoice number) when the PDF could never be
  // rendered because the tenant's own company details are missing.
  const companySettings = await getOrganizationCompanySettings();
  if (!companySettings.data) return fail(companySettings.error ?? "Could not load organization settings.");
  if (!companySettings.data.ownClient) {
    return fail("Configure your own company details in Settings → Company before generating an invoice.");
  }

  const { data: invoiceNumber, error: numberError } = await supabase.rpc("next_invoice_number", {
    p_organization_id: organizationId,
  });
  if (numberError) return fail(mapDbError(numberError));
  if (!invoiceNumber) return fail("Could not generate an invoice number.");

  const { data: invoice, error: insertError } = await supabase
    .from("invoices")
    .insert({ quote_id: quote.id, invoice_number: invoiceNumber })
    .select("id")
    .single<{ id: string }>();
  if (insertError) {
    if (insertError.code === "23505") return fail("This quote has already been invoiced.");
    return fail(mapDbError(insertError));
  }

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
 * whose e-mail was never delivered (skipped or failed at invoicing time, e.g.
 * missing invoice contact or sender settings, since fixed). Refuses once the
 * invoice has been sent (`emailed_at` set). Same recipient/recording rules as
 * `sendInvoiceEmail`. */
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
    .select("id, emailed_at")
    .eq("quote_id", quote.id)
    .maybeSingle<{ id: string; emailed_at: string | null }>();
  if (invoiceError) return fail(mapDbError(invoiceError));
  if (!invoice) return fail("This quote has not been invoiced yet.");
  if (invoice.emailed_at) return fail("This invoice has already been sent.");

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
  emailedTo: string | null;
  emailedAt: string | null;
  emailError: string | null;
}

/** Whether `quoteId` already has an invoice (drives "Generate invoice" vs.
 * "Open PDF" on the Quote detail page). The PDF itself is served by
 * `GET /quotes/[id]/invoice`. */
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
    .select("id, invoice_number, generated_at, emailed_to, emailed_at, email_error")
    .eq("quote_id", idResult.data)
    .maybeSingle<{
      id: string;
      invoice_number: string;
      generated_at: string;
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
      emailedTo: data.emailed_to,
      emailedAt: data.emailed_at,
      emailError: data.email_error,
    },
  });
}
