import "server-only";

import { after } from "next/server";
import type { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/resend";
import {
  checkWindowLimits,
  decideAfterFailure,
  exceedsAttemptLimit,
  parseLimit,
  waitBeforeNextSendMs,
  type ThrottleConfig,
} from "@/lib/email/outbox-policy";

/**
 * E-mail outbox (issue #268). Mail flows call `queueEmail` under the caller's
 * session (RLS-checked insert) and then `kickEmailOutbox()`; the processor
 * (`processEmailOutbox`) claims rows atomically, throttles, sends through the
 * provider and records the outcome. The processor is the ONLY user of the
 * service-role client here: `after()` / cron have no user session, and the
 * claim/complete functions are granted to service_role only.
 *
 * NOT a "use server" file (plain helpers, shared by several actions).
 */

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type OutboxKind = "invoice" | "credit_note" | "work_receipt";

export interface QueueEmailInput {
  kind: OutboxKind;
  /** Required for kind invoice / credit_note. */
  invoiceId?: string;
  /** Required for kind work_receipt. */
  workReceiptId?: string;
  to: string[];
  cc?: string[];
  from: string;
  subject: string;
  text: string;
  html?: string;
  /** Storage path of the stored PDF (invoices bucket for invoice/credit_note, work-receipts for work_receipt). */
  attachmentPath?: string;
  attachmentFilename?: string;
  /** Second attachment: the stored UBL e-invoice (`invoices.ubl_path`, invoice/credit_note only; both fields or neither). */
  extraAttachmentPath?: string;
  extraAttachmentFilename?: string;
}

export type QueueEmailResult = { ok: true; id: string } | { ok: false; error: string };

/** Inserts one mail into the outbox with the caller's session client (RLS decides). */
export async function queueEmail(supabase: SupabaseServerClient, input: QueueEmailInput): Promise<QueueEmailResult> {
  const { data, error } = await supabase
    .from("email_outbox")
    .insert({
      kind: input.kind,
      invoice_id: input.invoiceId ?? null,
      work_receipt_id: input.workReceiptId ?? null,
      to_addresses: input.to,
      cc_addresses: input.cc ?? [],
      from_address: input.from,
      subject: input.subject,
      body_text: input.text,
      body_html: input.html ?? null,
      attachment_path: input.attachmentPath ?? null,
      attachment_filename: input.attachmentFilename ?? null,
      extra_attachment_path: input.extraAttachmentPath ?? null,
      extra_attachment_filename: input.extraAttachmentFilename ?? null,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    if (error?.code === "42501") return { ok: false, error: "You do not have permission to send this e-mail." };
    return { ok: false, error: error?.message ?? "Could not queue the e-mail." };
  }
  return { ok: true, id: data.id };
}

/** Starts the processor after the response is sent, so the user never waits for it. Never throws. */
export function kickEmailOutbox(): void {
  try {
    after(async () => {
      try {
        await processEmailOutbox();
      } catch (error) {
        console.error("[email-outbox] processor failed", error);
      }
    });
  } catch (error) {
    // after() outside a request scope: the cron safety net picks the mail up.
    console.error("[email-outbox] could not schedule the processor", error);
  }
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

/** Stop starting new sends this long after the run began (function timeout is 60 s). */
const TIME_BUDGET_MS = 45_000;
const BUCKET_BY_KIND: Record<OutboxKind, string> = {
  invoice: "invoices",
  credit_note: "invoices",
  work_receipt: "work-receipts",
};

interface OutboxRow {
  id: string;
  kind: OutboxKind;
  to_addresses: string[];
  cc_addresses: string[];
  from_address: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  attachment_path: string | null;
  attachment_filename: string | null;
  extra_attachment_path: string | null;
  extra_attachment_filename: string | null;
  attempts: number;
}

export interface ProcessSummary {
  sent: number;
  retried: number;
  failed: number;
  /** Why the run stopped before the queue was empty, if it did. */
  stoppedBecause: "empty" | "hour_limit" | "day_limit" | "time_budget" | "busy";
}

/** Longer than a whole run (budget 45 s, function timeout 60 s), so the lease
 * only expires when a processor died without releasing it. */
const LEASE_SECONDS = 90;

export function readThrottleConfig(env: NodeJS.ProcessEnv = process.env): ThrottleConfig {
  return {
    maxPerSecond: parseLimit(env.EMAIL_MAX_PER_SECOND, 1) ?? 1,
    maxPerHour: parseLimit(env.EMAIL_MAX_PER_HOUR, null),
    maxPerDay: parseLimit(env.EMAIL_MAX_PER_DAY, null),
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs the queue under a global lease (`acquire_email_outbox_lease`), so only
 * ONE processor sends at a time — several `after()` kicks (e.g. a bulk
 * invoicing run) and the cron would otherwise each throttle on their own and
 * together exceed the provider's rate. A kick that finds the lease taken
 * returns `busy`: the running processor keeps claiming until the queue is
 * empty. Because a mail queued just before the holder released could be
 * missed by both, the processor re-checks for due mail after releasing and
 * runs another round if there is time left.
 */
export async function processEmailOutbox(): Promise<ProcessSummary> {
  const startedAt = Date.now();
  const admin = createAdminClient();
  const total: ProcessSummary = { sent: 0, retried: 0, failed: 0, stoppedBecause: "empty" };

  for (let round = 0; round < 3; round += 1) {
    const holder = crypto.randomUUID();
    const { data: acquired, error: leaseError } = await admin.rpc("acquire_email_outbox_lease", {
      p_holder: holder,
      p_seconds: LEASE_SECONDS,
    });
    if (leaseError) throw new Error(`acquire_email_outbox_lease: ${leaseError.message}`);
    if (!acquired) {
      if (round === 0) total.stoppedBecause = "busy";
      break;
    }

    let summary: ProcessSummary;
    try {
      summary = await runQueue(admin, startedAt);
    } finally {
      const { error } = await admin.rpc("release_email_outbox_lease", { p_holder: holder });
      if (error) console.error(`[email-outbox] release_email_outbox_lease failed: ${error.message}`);
    }
    total.sent += summary.sent;
    total.retried += summary.retried;
    total.failed += summary.failed;
    total.stoppedBecause = summary.stoppedBecause;
    if (summary.stoppedBecause !== "empty" || Date.now() - startedAt >= TIME_BUDGET_MS) break;

    const { count, error: dueError } = await admin
      .from("email_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued")
      .lte("next_attempt_at", new Date().toISOString());
    if (dueError || !count) break;
  }

  return total;
}

async function runQueue(admin: AdminClient, startedAt: number): Promise<ProcessSummary> {
  const config = readThrottleConfig();
  const summary: ProcessSummary = { sent: 0, retried: 0, failed: 0, stoppedBecause: "empty" };

  const countSent = async (sinceMs: number): Promise<number> => {
    const { data, error } = await admin.rpc("email_outbox_sent_count", {
      p_since: new Date(Date.now() - sinceMs).toISOString(),
    });
    if (error) throw new Error(`email_outbox_sent_count: ${error.message}`);
    return Number(data ?? 0);
  };

  // Only query the windows that are actually limited.
  let sentLastHour = config.maxPerHour !== null ? await countSent(3_600_000) : 0;
  let sentLastDay = config.maxPerDay !== null ? await countSent(86_400_000) : 0;
  let lastSendAt: number | null = null;

  for (;;) {
    if (Date.now() - startedAt >= TIME_BUDGET_MS) {
      summary.stoppedBecause = "time_budget";
      break;
    }
    const limit = checkWindowLimits(config, sentLastHour, sentLastDay);
    if (!limit.allowed) {
      summary.stoppedBecause = limit.reason === "day" ? "day_limit" : "hour_limit";
      break;
    }

    // One row at a time: whatever is claimed is processed right away, so a
    // stop (budget / limit) never leaves a claimed row stuck in 'sending'.
    const { data: claimed, error: claimError } = await admin.rpc("claim_email_outbox", { p_limit: 1 });
    if (claimError) throw new Error(`claim_email_outbox: ${claimError.message}`);
    const row = ((claimed ?? []) as OutboxRow[])[0];
    if (!row) break;

    if (exceedsAttemptLimit(row.attempts)) {
      await complete(admin, row.id, { ok: false, error: "Gave up: the previous attempts did not finish (processor interrupted)." });
      summary.failed += 1;
      continue;
    }

    const wait = waitBeforeNextSendMs(lastSendAt, Date.now(), config.maxPerSecond);
    if (wait > 0) await sleep(wait);
    lastSendAt = Date.now();

    const outcome = await deliver(admin, row);
    if (outcome.ok) {
      await complete(admin, row.id, { ok: true, providerMessageId: outcome.id });
      summary.sent += 1;
      sentLastHour += 1;
      sentLastDay += 1;
      continue;
    }

    const decision = decideAfterFailure(
      { status: outcome.status, message: outcome.error, permanent: outcome.permanent },
      row.attempts,
      new Date(),
    );
    if (decision.action === "retry") {
      await complete(admin, row.id, { ok: false, error: decision.error, retryAt: decision.retryAt });
      summary.retried += 1;
    } else {
      await complete(admin, row.id, { ok: false, error: decision.error });
      summary.failed += 1;
    }
  }

  return summary;
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function deliver(
  admin: AdminClient,
  row: OutboxRow,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string; status: number | null; permanent?: boolean }> {
  let attachments: { filename: string; content: Buffer; contentType?: string }[] | undefined;
  if (row.attachment_path && row.attachment_filename) {
    const { data: blob, error } = await admin.storage.from(BUCKET_BY_KIND[row.kind]).download(row.attachment_path);
    if (error || !blob) {
      return { ok: false, error: `Could not read the PDF attachment: ${error?.message ?? "file not found"}`, status: null };
    }
    attachments = [{ filename: row.attachment_filename, content: Buffer.from(await blob.arrayBuffer()) }];
  }
  if (row.extra_attachment_path && row.extra_attachment_filename) {
    // The UBL e-invoice lives in the invoices bucket (kinds invoice / credit_note only).
    const { data: blob, error } = await admin.storage.from("invoices").download(row.extra_attachment_path);
    if (error || !blob) {
      return { ok: false, error: `Could not read the UBL attachment: ${error?.message ?? "file not found"}`, status: null };
    }
    attachments = [
      ...(attachments ?? []),
      { filename: row.extra_attachment_filename, content: Buffer.from(await blob.arrayBuffer()), contentType: "application/xml" },
    ];
  }

  const sent = await sendEmail({
    from: row.from_address,
    to: row.to_addresses,
    cc: row.cc_addresses.length > 0 ? row.cc_addresses : undefined,
    subject: row.subject,
    text: row.body_text,
    html: row.body_html ?? undefined,
    attachments,
    // A reclaimed row (processor killed after the provider accepted it) is
    // then not delivered a second time.
    idempotencyKey: `email-outbox-${row.id}`,
  });
  return sent.ok ? { ok: true, id: sent.id } : sent;
}

async function complete(
  admin: AdminClient,
  id: string,
  result: { ok: true; providerMessageId: string | null } | { ok: false; error: string; retryAt?: Date },
): Promise<void> {
  const { error } = await admin.rpc("complete_email_outbox", {
    p_id: id,
    p_ok: result.ok,
    p_provider_message_id: result.ok ? result.providerMessageId : null,
    p_error: result.ok ? null : result.error,
    p_retry_at: !result.ok && result.retryAt ? result.retryAt.toISOString() : null,
  });
  // The mail may already be out; a failed bookkeeping call is logged, and the
  // stale-'sending' reclaim (with the attempt limit) bounds the damage.
  if (error) console.error(`[email-outbox] complete_email_outbox failed for ${id}: ${error.message}`);
}
