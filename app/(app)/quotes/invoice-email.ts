import "server-only";

import { z } from "zod";
import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { kickEmailOutbox, queueEmail } from "@/lib/email/outbox";
import { formatInvoiceTotal, getInvoicePdfById } from "./invoice-render";
import {
  DEFAULT_INVOICE_EMAIL_BODY,
  DEFAULT_INVOICE_EMAIL_SUBJECT,
  renderInvoiceEmailTemplate,
} from "./invoice-email-schema";

/**
 * Best-effort e-mail of one invoice or credit note (issues #211, #236, #268). NOT a
 * "use server" file: shared by `./invoice-actions.ts` and
 * `../invoices/actions.ts`. Works by invoice id.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type InvoiceEmailOutcome =
  /** The mail is in the outbox; the processor sends it (see lib/email/outbox.ts). */
  | { status: "queued"; to: string; outboxId: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; to: string | null; error: string };

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
 * Best-effort invoice / credit note e-mail. Never throws. Recipient = the
 * invoice contact of the client's `is_invoice_address` site (the same flow for
 * a credit note as for the invoice).
 *
 * Recording policy on `invoices` (emailed_to / emailed_at / email_error):
 *  - no invoice-address site, or no invoice contact on it: nothing is sent and
 *    NOTHING is recorded (a legitimate "don't e-mail" configuration).
 *  - contact without e-mail address: email_error = "Invoice contact has no
 *    e-mail address".
 *  - sender not configured: email_error = "Invoice email sender not configured".
 *  - provider/render failure: email_error = the error message.
 *  - success: the mail is QUEUED in the e-mail outbox (issue #268); emailed_to +
 *    emailed_at / email_error are set by the outbox processor once the mail is
 *    really sent or has definitively failed.
 */
export async function sendInvoiceEmailById(
  supabase: SupabaseServerClient,
  organizationId: string,
  organizationName: string,
  invoiceId: string,
  options: { kick?: boolean } = {},
): Promise<InvoiceEmailOutcome> {
  try {
    const { data: invoiceRow } = await supabase
      .from("invoices")
      .select("id, quote_id, kind, credits_invoice_id, credit_reason")
      .eq("id", invoiceId)
      .maybeSingle<{
        id: string;
        quote_id: string;
        kind: "invoice" | "credit_note";
        credits_invoice_id: string | null;
        credit_reason: string | null;
      }>();
    if (!invoiceRow) return { status: "failed", to: null, error: "Invoice not found" };

    const { data: quoteRow } = await supabase
      .from("quotes")
      .select("name, client_id")
      .eq("id", invoiceRow.quote_id)
      .maybeSingle<{ name: string; client_id: string }>();
    if (!quoteRow) return { status: "failed", to: null, error: "Quote not found" };

    const { data: invoiceSites, error: siteError } = await supabase
      .from("sites")
      .select("invoice_contact_id")
      .eq("client_id", quoteRow.client_id)
      .eq("is_invoice_address", true)
      .not("invoice_contact_id", "is", null);
    if (siteError) return { status: "failed", to: null, error: siteError.message };

    const contactId = (invoiceSites ?? []).map((s) => s.invoice_contact_id as string | null).find(Boolean);
    if (!contactId) return { status: "skipped", reason: "No invoice address or invoice contact" };

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

    const { result: rendered, error: renderError } = await getInvoicePdfById(supabase, invoiceRow.id);
    if (!rendered) {
      const error = renderError ?? "Could not render the invoice PDF.";
      await record({ email_error: error });
      return { status: "failed", to, error };
    }

    let subject: string;
    let text: string;
    if (invoiceRow.kind === "credit_note") {
      let originalNumber = "";
      if (invoiceRow.credits_invoice_id) {
        const { data: original } = await supabase
          .from("invoices")
          .select("invoice_number")
          .eq("id", invoiceRow.credits_invoice_id)
          .maybeSingle<{ invoice_number: string }>();
        originalNumber = original?.invoice_number ?? "";
      }
      subject = `Credit note ${rendered.invoiceNumber} for invoice ${originalNumber}`.replace(/[\r\n]+/g, " ").trim();
      text = [
        `Dear ${rendered.clientName},`,
        "",
        `Please find attached credit note ${rendered.invoiceNumber} for invoice ${originalNumber} (${formatInvoiceTotal(rendered.total)}).`,
        ...(invoiceRow.credit_reason ? ["", `Reason: ${invoiceRow.credit_reason}`] : []),
        "",
        "Kind regards,",
        organizationName,
      ].join("\n");
    } else {
      const values = {
        invoice_number: rendered.invoiceNumber,
        client_name: rendered.clientName,
        quote_name: quoteRow.name ?? rendered.reference,
        total: formatInvoiceTotal(rendered.total),
        due_date: rendered.dueDateLabel,
        organization_name: organizationName,
      };
      subject = renderInvoiceEmailTemplate(settings.subject_template || DEFAULT_INVOICE_EMAIL_SUBJECT, values)
        .replace(/[\r\n]+/g, " ")
        .trim();
      text = renderInvoiceEmailTemplate(settings.body_template || DEFAULT_INVOICE_EMAIL_BODY, values);
    }
    const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</div>`;

    // The PDF is stored by now (getInvoicePdfById stores it on first use); the outbox
    // references the stored file, never bytes.
    const { data: stored } = await supabase
      .from("invoices")
      .select("pdf_path")
      .eq("id", invoiceRow.id)
      .maybeSingle<{ pdf_path: string | null }>();
    if (!stored?.pdf_path) {
      const error = "The invoice PDF is not stored yet.";
      await record({ email_error: error });
      return { status: "failed", to, error };
    }

    const queued = await queueEmail(supabase, {
      kind: invoiceRow.kind,
      invoiceId: invoiceRow.id,
      from: formatMailbox(settings.from_name, settings.from_email),
      to: [to],
      cc: settings.cc_email ? [settings.cc_email] : undefined,
      subject,
      text,
      html,
      attachmentPath: stored.pdf_path,
      attachmentFilename: `${rendered.invoiceNumber}.pdf`,
    });
    if (!queued.ok) {
      await record({ email_error: queued.error });
      return { status: "failed", to, error: queued.error };
    }

    if (options.kick !== false) kickEmailOutbox();
    return { status: "queued", to, outboxId: queued.id };
  } catch (error) {
    return { status: "failed", to: null, error: error instanceof Error ? error.message : "Unexpected e-mail error" };
  }
}
