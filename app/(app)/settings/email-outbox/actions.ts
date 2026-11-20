"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { kickEmailOutbox } from "@/lib/email/outbox";
import type { OutboxStatus } from "@/lib/email/outbox-status";

/**
 * Server Actions for the e-mail outbox (issue #268): the Settings -> E-mail
 * "Outbox" overview and "Retry". All under the caller's session; RLS on
 * `email_outbox` mirrors the rights on the source record (invoice/credit note:
 * owner/finance/administratie; work receipt: owner/planner/administratie to
 * retry). Helpers live in lib/email/ (a "use server" file may only export async functions).
 */

const uuidSchema = z.string().uuid("Invalid id.");
const OUTBOX_DAYS = 30;
const LIST_LIMIT = 500;

export interface OutboxItem {
  id: string;
  status: OutboxStatus;
  kind: "invoice" | "credit_note" | "work_receipt";
  to: string[];
  subject: string;
  queuedAt: string;
  sentAt: string | null;
  nextAttemptAt: string;
  lastError: string | null;
  attempts: number;
  /** Link info of the source record. quoteId is set for invoice/credit_note (/quotes/{quoteId}), workOrderId for work_receipt (/work-orders/{workOrderId}). */
  source: {
    invoiceId: string | null;
    invoiceNumber: string | null;
    quoteId: string | null;
    workReceiptId: string | null;
    receiptNumber: string | null;
    workOrderId: string | null;
  };
  /** True for a failed mail the caller may retry. */
  canRetry: boolean;
}

interface OutboxRow {
  id: string;
  kind: OutboxItem["kind"];
  invoice_id: string | null;
  work_receipt_id: string | null;
  to_addresses: string[];
  subject: string;
  status: OutboxStatus;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  queued_at: string;
  sent_at: string | null;
}

const listSchema = z.object({ status: z.enum(["queued", "sending", "sent", "failed"]).optional() }).optional();

/** Mails of the last 30 days (newest first), optionally filtered by status, plus how many are still queued/sending (all time). */
export async function listOutbox(
  input?: { status?: OutboxStatus },
): Promise<ActionResult<{ items: OutboxItem[]; pendingCount: number; days: number }>> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid status filter.");

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const { actor } = ctx.context;
  // Same boundary as Settings -> Invoice email (owner / finance / administratie).
  if (!can(actor, "invoicing", "create")) {
    return fail("You do not have permission to view the e-mail outbox.");
  }

  const supabase = await createSupabaseServerClient();
  const since = new Date(Date.now() - OUTBOX_DAYS * 86_400_000).toISOString();
  let query = supabase
    .from("email_outbox")
    .select("id, kind, invoice_id, work_receipt_id, to_addresses, subject, status, attempts, next_attempt_at, last_error, queued_at, sent_at")
    .gte("queued_at", since)
    .order("queued_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (parsed.data?.status) query = query.eq("status", parsed.data.status);

  const [listResult, pendingResult] = await Promise.all([
    query.returns<OutboxRow[]>(),
    supabase.from("email_outbox").select("id", { count: "exact", head: true }).in("status", ["queued", "sending"]),
  ]);
  if (listResult.error) return fail(mapDbError(listResult.error));
  if (pendingResult.error) return fail(mapDbError(pendingResult.error));
  const rows = listResult.data ?? [];

  const invoiceIds = [...new Set(rows.map((r) => r.invoice_id).filter((id): id is string => Boolean(id)))];
  const receiptIds = [...new Set(rows.map((r) => r.work_receipt_id).filter((id): id is string => Boolean(id)))];
  const [invoiceResult, receiptResult] = await Promise.all([
    invoiceIds.length > 0
      ? supabase.from("invoices").select("id, quote_id, invoice_number").in("id", invoiceIds)
      : Promise.resolve({ data: [] as { id: string; quote_id: string; invoice_number: string }[] }),
    receiptIds.length > 0
      ? supabase.from("work_receipts").select("id, work_order_id, receipt_number").in("id", receiptIds)
      : Promise.resolve({ data: [] as { id: string; work_order_id: string; receipt_number: string }[] }),
  ]);
  const invoiceById = new Map((invoiceResult.data ?? []).map((i) => [i.id as string, i]));
  const receiptById = new Map((receiptResult.data ?? []).map((r) => [r.id as string, r]));

  const items: OutboxItem[] = rows.map((row) => {
    const invoice = row.invoice_id ? invoiceById.get(row.invoice_id) : undefined;
    const receipt = row.work_receipt_id ? receiptById.get(row.work_receipt_id) : undefined;
    return {
      id: row.id,
      status: row.status,
      kind: row.kind,
      to: row.to_addresses,
      subject: row.subject,
      queuedAt: row.queued_at,
      sentAt: row.sent_at,
      nextAttemptAt: row.next_attempt_at,
      lastError: row.last_error,
      attempts: row.attempts,
      source: {
        invoiceId: row.invoice_id,
        invoiceNumber: invoice?.invoice_number ?? null,
        quoteId: invoice?.quote_id ?? null,
        workReceiptId: row.work_receipt_id,
        receiptNumber: receipt?.receipt_number ?? null,
        workOrderId: receipt?.work_order_id ?? null,
      },
      canRetry: row.status === "failed",
    };
  });

  return ok({ items, pendingCount: pendingResult.count ?? 0, days: OUTBOX_DAYS });
}

/** Puts a failed mail back in the queue (attempts reset) and starts the processor. */
export async function retryEmail(outboxId: string): Promise<ActionResult<{ id: string }>> {
  const idResult = uuidSchema.safeParse(outboxId);
  if (!idResult.success) return fail("Invalid outbox id.");

  // The kind decides which module/permission governs the retry; RLS lets the
  // caller see the row only when they may see that kind at all.
  const supabase = await createSupabaseServerClient();
  const { data: row, error: readError } = await supabase
    .from("email_outbox")
    .select("kind")
    .eq("id", idResult.data)
    .maybeSingle<{ kind: OutboxItem["kind"] }>();
  if (readError) return fail(mapDbError(readError));
  if (!row) return fail("E-mail not found, or you do not have permission to view it.");

  const isReceipt = row.kind === "work_receipt";
  const ctx = await requireModuleContext(isReceipt ? "planning" : "invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const allowed = isReceipt
    ? can(ctx.context.actor, "work_receipts", "update")
    : can(ctx.context.actor, "invoicing", "update");
  if (!allowed) return fail("You do not have permission to retry this e-mail.");

  const { error } = await supabase.rpc("retry_email_outbox", { p_id: idResult.data });
  if (error) {
    if (error.code === "55000") return fail("Only failed e-mails can be retried.");
    if (error.code === "P0002") return fail("E-mail not found.");
    return fail(mapDbError(error));
  }

  kickEmailOutbox();
  return ok({ id: idResult.data });
}
