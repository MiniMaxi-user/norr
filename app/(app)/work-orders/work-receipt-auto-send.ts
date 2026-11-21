import "server-only";

import { z } from "zod";
import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { getLatestWorkReceiptOutboxStatus } from "@/lib/email/outbox-status";
import { hasEmail, loadSiteRoleContacts } from "../clients/site-contact-roles";
import { generateWorkReceipt } from "./work-receipt-actions";
import { queueWorkReceiptEmail } from "./work-receipt-send";

/**
 * Automatic work receipt e-mail on Completed (issue #273). NOT a "use server"
 * file: called by `approveWorkOrderReview` after the status update succeeded.
 * Never throws and never fails the approval; every problem is an outcome.
 * Uses the same `queueWorkReceiptEmail` as the manual send.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type WorkReceiptAutoSendOutcome =
  | { status: "queued"; to: string[] }
  /** Auto-send is on but the site has no Work receipt contact with an e-mail address. */
  | { status: "no_recipients" }
  /** Auto-send is off, or e-mailing work receipts is switched off in Settings. */
  | { status: "off" }
  | { status: "failed"; error: string }
  /** The latest receipt version was already e-mailed (queued, sending or sent): nothing is queued again. */
  | { status: "already_sent" };

export async function autoSendWorkReceiptOnCompleted(
  supabase: SupabaseServerClient,
  input: {
    actor: PermissionActor;
    organizationId: string;
    organizationName: string;
    workOrderId: string;
    siteId: string | null;
  },
): Promise<WorkReceiptAutoSendOutcome> {
  try {
    const { actor, organizationId, organizationName, workOrderId, siteId } = input;

    const { data: settings, error: settingsError } = await supabase
      .from("work_receipt_email_settings")
      .select("auto_send_on_completed, email_work_receipts")
      .eq("organization_id", organizationId)
      .maybeSingle<{ auto_send_on_completed: boolean | null; email_work_receipts: boolean | null }>();
    if (settingsError) return { status: "failed", error: settingsError.message };
    if (!settings?.auto_send_on_completed || settings.email_work_receipts === false) return { status: "off" };

    // Recipients first: with nobody to send to, no receipt is generated either.
    // Contacts whose e-mail was cleared (or is invalid) since they were ticked are skipped.
    const { contacts, error: contactsError } = siteId
      ? await loadSiteRoleContacts(supabase, [siteId], "work_receipt")
      : { contacts: [], error: null };
    if (contactsError) return { status: "failed", error: contactsError };
    const seen = new Set<string>();
    const recipients: string[] = [];
    for (const contact of contacts.filter(hasEmail)) {
      const email = (contact.email as string).trim();
      if (!z.string().email().safeParse(email).success || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());
      recipients.push(email);
    }
    if (recipients.length === 0) return { status: "no_recipients" };

    if (!can(actor, "work_receipts", "update")) {
      return { status: "failed", error: "You do not have permission to send work receipts." };
    }

    // The latest version, generated first if there is none (or its PDF never got stored).
    const { data: latest, error: latestError } = await supabase
      .from("work_receipts")
      .select("id, pdf_path, emailed_at")
      .eq("work_order_id", workOrderId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; pdf_path: string | null; emailed_at: string | null }>();
    if (latestError) return { status: "failed", error: latestError.message };

    let receiptId: string;
    if (latest?.pdf_path) {
      receiptId = latest.id;
      // Only queue a version that has not been e-mailed yet. A failed mail can be retried.
      const outbox = (await getLatestWorkReceiptOutboxStatus(supabase, [latest.id], false)).get(latest.id);
      if (latest.emailed_at || (outbox && outbox.status !== "failed")) return { status: "already_sent" };
    } else {
      const generated = await generateWorkReceipt(workOrderId);
      if (!generated.data) return { status: "failed", error: generated.error ?? "Could not generate the work receipt." };
      receiptId = generated.data.receipt.id;
    }

    const result = await queueWorkReceiptEmail(supabase, { organizationId, organizationName, receiptId, recipients });
    switch (result.status) {
      case "queued":
        return { status: "queued", to: result.to };
      case "off":
        return { status: "off" };
      case "failed":
      case "rejected":
        return { status: "failed", error: result.error };
    }
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Unexpected e-mail error" };
  }
}
