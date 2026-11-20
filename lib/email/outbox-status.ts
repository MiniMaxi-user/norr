import "server-only";

import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Latest e-mail outbox status per invoice / work receipt (issue #268), for the
 * status badges ("Queued", "Sending", "Sent <time>", "Failed: <reason>") on the
 * invoice, the invoices overview and the work receipt. Reads under the caller's
 * session: RLS on `email_outbox` mirrors the rights on the source record.
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type OutboxStatus = "queued" | "sending" | "sent" | "failed";

export interface OutboxMailStatus {
  outboxId: string;
  status: OutboxStatus;
  /** Recipients of that mail. */
  to: string[];
  queuedAt: string;
  sentAt: string | null;
  /** Set while retrying and when failed. */
  lastError: string | null;
  attempts: number;
  /** A failed mail can be retried with `retryEmail(outboxId)`. */
  canRetry: boolean;
}

interface StatusRow {
  id: string;
  invoice_id: string | null;
  work_receipt_id: string | null;
  status: OutboxStatus;
  to_addresses: string[];
  queued_at: string;
  sent_at: string | null;
  last_error: string | null;
  attempts: number;
}

const COLUMNS = "id, invoice_id, work_receipt_id, status, to_addresses, queued_at, sent_at, last_error, attempts";

function toStatus(row: StatusRow, canRetryFailed: boolean): OutboxMailStatus {
  return {
    outboxId: row.id,
    status: row.status,
    to: row.to_addresses,
    queuedAt: row.queued_at,
    sentAt: row.sent_at,
    lastError: row.last_error,
    attempts: row.attempts,
    canRetry: canRetryFailed && row.status === "failed",
  };
}

async function latestBy(
  supabase: SupabaseServerClient,
  column: "invoice_id" | "work_receipt_id",
  ids: string[],
  canRetryFailed: boolean,
): Promise<Map<string, OutboxMailStatus>> {
  const result = new Map<string, OutboxMailStatus>();
  if (ids.length === 0) return result;
  const { data } = await supabase
    .from("email_outbox")
    .select(COLUMNS)
    .in(column, ids)
    .order("queued_at", { ascending: false })
    .limit(Math.max(ids.length * 5, 50))
    .returns<StatusRow[]>();
  for (const row of data ?? []) {
    const key = row[column];
    if (key && !result.has(key)) result.set(key, toStatus(row, canRetryFailed));
  }
  return result;
}

/** Latest outbox mail per invoice / credit note id (ids without a mail are absent). Best effort: errors yield an empty map. */
export function getLatestInvoiceOutboxStatus(
  supabase: SupabaseServerClient,
  invoiceIds: string[],
  canRetryFailed: boolean,
): Promise<Map<string, OutboxMailStatus>> {
  return latestBy(supabase, "invoice_id", invoiceIds, canRetryFailed);
}

/** Latest outbox mail per work receipt id. */
export function getLatestWorkReceiptOutboxStatus(
  supabase: SupabaseServerClient,
  workReceiptIds: string[],
  canRetryFailed: boolean,
): Promise<Map<string, OutboxMailStatus>> {
  return latestBy(supabase, "work_receipt_id", workReceiptIds, canRetryFailed);
}
