import "server-only";

import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { kickEmailOutbox, queueEmail } from "@/lib/email/outbox";
import { getWorkReceiptEmailValues } from "./work-receipt-render";
import {
  DEFAULT_WORK_RECEIPT_EMAIL_BODY,
  DEFAULT_WORK_RECEIPT_EMAIL_SUBJECT,
  renderWorkReceiptEmailTemplate,
} from "./work-receipt-email-schema";

/**
 * The one place a work receipt e-mail is queued (issues #226, #268, #273), shared by
 * the manual `sendWorkReceipt` action and the automatic send in
 * `approveWorkOrderReview`. NOT a "use server" file. The caller has already
 * checked permissions; this runs under the caller's own session (RLS applies).
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface EmailSettingsRow {
  from_email: string | null;
  from_name: string | null;
  cc_email: string | null;
  subject_template: string | null;
  body_template: string | null;
  email_work_receipts: boolean | null;
}

export type QueueWorkReceiptEmailResult =
  /** The mail is in the outbox; the processor sends it and records the outcome. */
  | { status: "queued"; to: string[] }
  /** Sender/queue problem, recorded on the receipt (emailed_to + email_error). */
  | { status: "failed"; to: string[]; error: string }
  /** E-mailing work receipts is switched off in Settings; nothing queued or recorded. */
  | { status: "off" }
  /** Receipt not found / no PDF yet; nothing queued or recorded. */
  | { status: "rejected"; error: string };

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatMailbox(name: string | null, email: string): string {
  const cleanName = (name ?? "").replace(/[<>",\r\n]/g, " ").replace(/\s+/g, " ").trim();
  return cleanName ? `${cleanName} <${email}>` : email;
}

/**
 * Queues the e-mail of the stored PDF of one receipt to `recipients` (already
 * validated, at least one) in one mail. `emailed_to` stores them joined with ", ".
 */
export async function queueWorkReceiptEmail(
  supabase: SupabaseServerClient,
  input: { organizationId: string; organizationName: string; receiptId: string; recipients: string[] },
): Promise<QueueWorkReceiptEmailResult> {
  const { organizationId, organizationName, receiptId, recipients } = input;

  const { data: receipt, error: receiptError } = await supabase
    .from("work_receipts")
    .select("id, work_order_id, receipt_number, pdf_path")
    .eq("id", receiptId)
    .maybeSingle<{ id: string; work_order_id: string; receipt_number: string; pdf_path: string | null }>();
  if (receiptError) return { status: "rejected", error: receiptError.message };
  if (!receipt) return { status: "rejected", error: "Work receipt not found, or you do not have permission to view it." };
  if (!receipt.pdf_path) {
    return { status: "rejected", error: "This work receipt has no PDF yet. Generate a new version first." };
  }
  const pdfPath = receipt.pdf_path;
  const emailedTo = recipients.join(", ");

  const failed = async (error: string): Promise<QueueWorkReceiptEmailResult> => {
    await supabase
      .from("work_receipts")
      .update({ emailed_to: emailedTo, emailed_at: null, email_error: error })
      .eq("id", receipt.id);
    return { status: "failed", to: recipients, error };
  };

  const { data: settings, error: settingsError } = await supabase
    .from("work_receipt_email_settings")
    .select("from_email, from_name, cc_email, subject_template, body_template, email_work_receipts")
    .eq("organization_id", organizationId)
    .maybeSingle<EmailSettingsRow>();
  if (settingsError) return failed(settingsError.message);
  // Organization switch (Settings -> Work receipt email): nothing is queued or recorded.
  if (settings?.email_work_receipts === false) return { status: "off" };
  if (!settings?.from_email) return failed("Work receipt e-mail sender not configured");

  const tokenValues = await getWorkReceiptEmailValues(supabase, receipt.work_order_id, receipt.receipt_number);
  if (!tokenValues) return failed("Work order not found");
  const values = { ...tokenValues, organization_name: organizationName };

  const subject = renderWorkReceiptEmailTemplate(settings.subject_template || DEFAULT_WORK_RECEIPT_EMAIL_SUBJECT, values)
    .replace(/[\r\n]+/g, " ")
    .trim();
  const text = renderWorkReceiptEmailTemplate(settings.body_template || DEFAULT_WORK_RECEIPT_EMAIL_BODY, values);
  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</div>`;

  const queued = await queueEmail(supabase, {
    kind: "work_receipt",
    workReceiptId: receipt.id,
    from: formatMailbox(settings.from_name, settings.from_email),
    to: recipients,
    cc: settings.cc_email ? [settings.cc_email] : undefined,
    subject,
    text,
    html,
    attachmentPath: pdfPath,
    attachmentFilename: `${receipt.receipt_number}.pdf`,
  });
  if (!queued.ok) return failed(queued.error);

  kickEmailOutbox();
  return { status: "queued", to: recipients };
}
