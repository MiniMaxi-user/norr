"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAny } from "@/lib/rbac/permissions";
import { getLatestWorkReceiptOutboxStatus, type OutboxMailStatus } from "@/lib/email/outbox-status";
import { hasEmail, loadSiteRoleContacts, uniqueEmails, type SiteRoleContact } from "../clients/site-contact-roles";
import type { SiteContactRole } from "../clients/schema";
import { renderWorkReceiptPdf } from "./work-receipt-render";
import { queueWorkReceiptEmail } from "./work-receipt-send";

/**
 * Server Actions for work receipts ("werkbon", issue #226).
 *
 * Gated on the `planning` feature (work orders) and the `work_receipts`
 * permission row: `read` to list, `create` to generate a new version, `update`
 * to send / pick recipients (owner / planner / administratie; finance read
 * only; engineer none). Everything runs under the caller's own session - RLS
 * on `work_receipts` and the private `work-receipts` bucket is the real
 * backstop; there is no service-role client.
 *
 * Generation flow: INSERT `{ work_order_id }` (trigger: status gate, version,
 * receipt_number, org, generated_by) -> render the PDF -> upload to
 * `{org}/{work_order}/{receipt_number}.pdf` -> set `pdf_path` (once). A failed
 * render/upload leaves the row as a logged attempt with `pdf_path` null.
 */

const uuidSchema = z.string().uuid("Invalid id.");
const emailSchema = z.string().trim().email("Enter a valid e-mail address.").max(254);
const SIGNED_URL_TTL_SECONDS = 3600;
const CLOSED_STATUSES = ["completed", "invoiced"];

export interface WorkReceiptRecord {
  id: string;
  version: number;
  receiptNumber: string;
  generatedAt: string;
  generatedByName: string | null;
  /** Signed URL, valid for one hour; null while no PDF is stored. */
  pdfUrl: string | null;
  emailedTo: string | null;
  emailedAt: string | null;
  emailError: string | null;
  emailedByName: string | null;
  /** Latest e-mail outbox mail of this receipt (issue #268): Queued / Sending / Sent / Failed (+ retry); null when none was queued. */
  outbox: OutboxMailStatus | null;
}

interface ReceiptRow {
  id: string;
  version: number;
  receipt_number: string;
  pdf_path: string | null;
  generated_at: string;
  generated_by: string | null;
  emailed_to: string | null;
  emailed_at: string | null;
  email_error: string | null;
  emailed_by: string | null;
}

const RECEIPT_COLUMNS =
  "id, version, receipt_number, pdf_path, generated_at, generated_by, emailed_to, emailed_at, email_error, emailed_by";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function toRecords(
  supabase: SupabaseServerClient,
  rows: ReceiptRow[],
  canRetryEmail: boolean,
): Promise<WorkReceiptRecord[]> {
  if (rows.length === 0) return [];

  const outboxById = await getLatestWorkReceiptOutboxStatus(
    supabase,
    rows.map((row) => row.id),
    canRetryEmail,
  );

  const userIds = Array.from(
    new Set(rows.flatMap((row) => [row.generated_by, row.emailed_by]).filter((id): id is string => Boolean(id))),
  );
  const nameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await supabase.from("users").select("id, email, full_name").in("id", userIds);
    for (const user of (users ?? []) as { id: string; email: string; full_name: string | null }[]) {
      nameById.set(user.id, user.full_name?.trim() || user.email);
    }
  }

  const paths = rows.map((row) => row.pdf_path).filter((p): p is string => Boolean(p));
  const urlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("work-receipts").createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    receiptNumber: row.receipt_number,
    generatedAt: row.generated_at,
    generatedByName: row.generated_by ? (nameById.get(row.generated_by) ?? null) : null,
    pdfUrl: row.pdf_path ? (urlByPath.get(row.pdf_path) ?? null) : null,
    emailedTo: row.emailed_to,
    emailedAt: row.emailed_at,
    emailError: row.email_error,
    emailedByName: row.emailed_by ? (nameById.get(row.emailed_by) ?? null) : null,
    outbox: outboxById.get(row.id) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// listWorkReceipts
// ---------------------------------------------------------------------------

/** Receipts of one work order, newest first. A caller without `work_receipts`
 * read access (engineer) gets an empty list with every flag false.
 *
 * Issue #273: also `autoSendWorkReceipts` (the organization sends the latest
 * receipt automatically on Completed: auto-send on AND e-mailing work receipts
 * not switched off) and `workReceiptRecipientCount` (the site's Work receipt
 * contacts that have an e-mail address), so the UI can show a "no recipient"
 * notice. */
export async function listWorkReceipts(workOrderId: string): Promise<
  ActionResult<{
    receipts: WorkReceiptRecord[];
    canGenerate: boolean;
    canSend: boolean;
    isApproved: boolean;
    autoSendWorkReceipts: boolean;
    workReceiptRecipientCount: number;
  }>
> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);
  const { actor } = ctx.context;
  if (!can(actor, "work_receipts", "read")) {
    return ok({
      receipts: [],
      canGenerate: false,
      canSend: false,
      isApproved: false,
      autoSendWorkReceipts: false,
      workReceiptRecipientCount: 0,
    });
  }

  const supabase = await createSupabaseServerClient();
  const [statusResult, receiptsResult, settingsResult] = await Promise.all([
    supabase
      .from("work_orders")
      .select("site_id, work_order_status:reference_list_items!work_orders_status_id_fkey(value)")
      .eq("id", idResult.data)
      .maybeSingle<{ site_id: string | null; work_order_status: { value: string } | null }>(),
    supabase
      .from("work_receipts")
      .select(RECEIPT_COLUMNS)
      .eq("work_order_id", idResult.data)
      .order("version", { ascending: false })
      .returns<ReceiptRow[]>(),
    supabase
      .from("work_receipt_email_settings")
      .select("auto_send_on_completed, email_work_receipts")
      .eq("organization_id", ctx.context.organizationId)
      .maybeSingle<{ auto_send_on_completed: boolean | null; email_work_receipts: boolean | null }>(),
  ]);
  if (statusResult.error) return fail(mapDbError(statusResult.error));
  if (!statusResult.data) return fail("Work order not found, or you do not have permission to view it.");
  if (receiptsResult.error) return fail(mapDbError(receiptsResult.error));

  const isApproved = CLOSED_STATUSES.includes(statusResult.data.work_order_status?.value ?? "");
  const receipts = await toRecords(supabase, receiptsResult.data ?? [], can(actor, "work_receipts", "update"));

  // A settings read the caller may not have (RLS) simply reads as "off".
  const autoSendWorkReceipts =
    settingsResult.data?.auto_send_on_completed === true && settingsResult.data.email_work_receipts !== false;
  let workReceiptRecipientCount = 0;
  if (autoSendWorkReceipts && statusResult.data.site_id) {
    const { contacts } = await loadSiteRoleContacts(supabase, [statusResult.data.site_id], "work_receipt");
    workReceiptRecipientCount = contacts.filter(hasEmail).length;
  }
  return ok({
    receipts,
    canGenerate: can(actor, "work_receipts", "create") && isApproved,
    canSend: can(actor, "work_receipts", "update"),
    isApproved,
    autoSendWorkReceipts,
    workReceiptRecipientCount,
  });
}

// ---------------------------------------------------------------------------
// generateWorkReceipt
// ---------------------------------------------------------------------------

export async function generateWorkReceipt(workOrderId: string): Promise<ActionResult<{ receipt: WorkReceiptRecord }>> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;
  if (!can(actor, "work_receipts", "create")) {
    return fail("You do not have permission to generate work receipts.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: inserted, error: insertError } = await supabase
    .from("work_receipts")
    .insert({ work_order_id: idResult.data })
    .select("id, version, receipt_number")
    .single<{ id: string; version: number; receipt_number: string }>();
  if (insertError) {
    if (insertError.code === "23514") return fail("A work receipt can only be generated for an approved work order.");
    return fail(mapDbError(insertError));
  }

  const { data: row, error: rowError } = await supabase
    .from("work_receipts")
    .select(RECEIPT_COLUMNS)
    .eq("id", inserted.id)
    .single<ReceiptRow>();
  if (rowError || !row) return fail(rowError ? mapDbError(rowError) : "Could not read the generated work receipt.");

  const render = await renderWorkReceiptPdf(
    supabase,
    idResult.data,
    { receiptNumber: row.receipt_number, generatedAt: row.generated_at },
    // Meters off: no volume readings section on the receipt (#247). The receipt has no checklist section.
    { includeVolumes: await hasFeature(ctx.context.session.organization, "meters") },
  );
  if (!render.rendered) {
    return fail(`Work receipt ${row.receipt_number} could not be generated: ${render.error}`);
  }

  const path = `${organizationId}/${idResult.data}/${row.receipt_number}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("work-receipts")
    .upload(path, render.rendered.pdf, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    return fail(`Work receipt ${row.receipt_number} could not be stored: ${uploadError.message}`);
  }

  const { data: updated, error: updateError } = await supabase
    .from("work_receipts")
    .update({ pdf_path: path })
    .eq("id", row.id)
    .select(RECEIPT_COLUMNS)
    .maybeSingle<ReceiptRow>();
  if (updateError) return fail(mapDbError(updateError));
  if (!updated) return fail("Could not save the work receipt, or you do not have permission.");

  const [record] = await toRecords(supabase, [updated], can(actor, "work_receipts", "update"));
  if (!record) return fail("Could not read the generated work receipt.");
  return ok({ receipt: record });
}

// ---------------------------------------------------------------------------
// getWorkReceiptRecipientOptions
// ---------------------------------------------------------------------------

interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  is_primary: boolean;
}

const MAX_RECEIPT_RECIPIENTS = 10;

const ROLE_OPTION_LABELS: Record<SiteContactRole, string> = {
  work_receipt: "site work receipt contact",
  visit: "site visit contact",
  delivery: "site delivery contact",
  invoice: "site invoice contact",
};

const ROLE_OPTION_ORDER: SiteContactRole[] = ["work_receipt", "visit", "delivery", "invoice"];

/**
 * `suggestedRecipients`: the e-mail addresses of the site's Work receipt
 * contacts (site contact matrix, #273; contacts whose e-mail was cleared since
 * are skipped), primary contact first, then name. `options`: every address
 * that can be picked (site contacts per role, then the client's contacts).
 */
export async function getWorkReceiptRecipientOptions(
  workOrderId: string,
): Promise<ActionResult<{ suggestedRecipients: string[]; options: { email: string; label: string }[] }>> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);
  if (!can(ctx.context.actor, "work_receipts", "update")) {
    return fail("You do not have permission to send work receipts.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: wo, error: woError } = await supabase
    .from("work_orders")
    .select("client_id, site_id")
    .eq("id", idResult.data)
    .maybeSingle<{ client_id: string; site_id: string | null }>();
  if (woError) return fail(mapDbError(woError));
  if (!wo) return fail("Work order not found, or you do not have permission to view it.");

  const siteContacts: { role: SiteContactRole; contact: SiteRoleContact }[] = [];
  if (wo.site_id) {
    for (const role of ROLE_OPTION_ORDER) {
      const { contacts, error } = await loadSiteRoleContacts(supabase, [wo.site_id], role);
      if (error) return fail(error);
      for (const contact of contacts) siteContacts.push({ role, contact });
    }
  }

  const { data: clientContacts, error: clientContactsError } = await supabase
    .from("contacts")
    .select("id, name, email, is_primary")
    .eq("client_id", wo.client_id)
    .order("is_primary", { ascending: false })
    .order("name", { ascending: true })
    .returns<ContactRow[]>();
  if (clientContactsError) return fail(mapDbError(clientContactsError));

  const options: { email: string; label: string }[] = [];
  const seen = new Set<string>();
  const add = (email: string | null | undefined, label: string) => {
    const clean = email?.trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ email: clean, label });
  };

  for (const { role, contact } of siteContacts) add(contact.email, `${contact.name} — ${ROLE_OPTION_LABELS[role]}`);
  for (const contact of clientContacts ?? []) add(contact.email, `${contact.name} — client contact`);

  const suggestedRecipients = uniqueEmails(
    siteContacts.filter((entry) => entry.role === "work_receipt").map((entry) => entry.contact.email),
  );
  return ok({ suggestedRecipients, options });
}

// ---------------------------------------------------------------------------
// sendWorkReceipt
// ---------------------------------------------------------------------------

const recipientsSchema = z
  .array(emailSchema)
  .min(1, "Enter at least one e-mail address.")
  .max(MAX_RECEIPT_RECIPIENTS, `You can send to at most ${MAX_RECEIPT_RECIPIENTS} addresses.`);

/**
 * Queues the e-mail of the stored PDF of one receipt to `to` (1 to 10 addresses,
 * one mail) in the e-mail outbox (issue #268); the outbox processor sends it and
 * then records the outcome in the receipt's emailed_* columns (`emailed_to` holds
 * the addresses joined with ", "). Returns `{ status: "queued" }` on success and
 * `{ status: "failed" }` (an ok result) for sender/queue problems, recorded on the
 * receipt, so the UI can show the error; invalid input or a missing PDF is a
 * plain `fail`. The queueing itself is the shared `queueWorkReceiptEmail`
 * (`./work-receipt-send.ts`), also used by the automatic send on Completed.
 *
 * Note: `work_receipt_email_settings` is readable by owner/planner/
 * administratie (20261119150000_work_receipt_email_settings_planner_read.sql)
 * so every role that may send can read the sender configuration; writing the
 * settings stays owner/administratie.
 */
export async function sendWorkReceipt(
  receiptId: string,
  to: string[],
): Promise<ActionResult<{ status: "queued" | "failed"; to: string[]; error?: string }>> {
  const idResult = uuidSchema.safeParse(receiptId);
  if (!idResult.success) return fail("Invalid work receipt id.");
  const recipientsResult = recipientsSchema.safeParse(to);
  if (!recipientsResult.success) {
    const message = recipientsResult.error.issues[0]?.message ?? "Enter a valid e-mail address.";
    return fail(message, { to: [message] });
  }
  const recipients = uniqueEmails(recipientsResult.data);

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId, session } = ctx.context;
  if (!can(actor, "work_receipts", "update")) {
    return fail("You do not have permission to send work receipts.");
  }

  const supabase = await createSupabaseServerClient();
  const result = await queueWorkReceiptEmail(supabase, {
    organizationId,
    organizationName: session.organization?.name ?? "",
    receiptId: idResult.data,
    recipients,
  });
  if (result.status === "off") return fail("E-mailing work receipts is switched off in Settings.");
  if (result.status === "rejected") return fail(result.error);
  if (result.status === "failed") return ok({ status: "failed" as const, to: result.to, error: result.error });
  return ok({ status: "queued" as const, to: result.to });
}

// ---------------------------------------------------------------------------
// getWorkOrderSignature
// ---------------------------------------------------------------------------

/** The customer signature captured in the PWA (signed URL, one hour), or null. */
export async function getWorkOrderSignature(
  workOrderId: string,
): Promise<ActionResult<{ signature: { url: string; signedAt: string } | null }>> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);
  if (!canAny(ctx.context.actor, "planning", ["read", "read_own"])) {
    return fail("You do not have permission to view signatures.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_order_signatures")
    .select("storage_path, signed_at")
    .eq("work_order_id", idResult.data)
    .maybeSingle<{ storage_path: string; signed_at: string }>();
  if (error) return fail(mapDbError(error));
  if (!data) return ok({ signature: null });

  const { data: signed, error: signError } = await supabase.storage
    .from("work-order-signatures")
    .createSignedUrl(data.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) return fail("Could not load the signature.");
  return ok({ signature: { url: signed.signedUrl, signedAt: data.signed_at } });
}
