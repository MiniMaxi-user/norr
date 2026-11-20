"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, clampLimit, clampOffset, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { applyInvoiceFilters, applyInvoiceSort } from "./invoice-filters";
import { getInvoicePdfById } from "../quotes/invoice-render";
import { getLatestInvoiceOutboxStatus, type OutboxMailStatus } from "@/lib/email/outbox-status";
import { sendInvoiceEmailById, type InvoiceEmailOutcome as EmailOutcome } from "../quotes/invoice-email";

/**
 * Server Actions for the Invoices overview, payments and credit notes
 * (issues #234, #235, #236). Same four-step preamble everywhere:
 * `requireModuleContext("invoicing")` (feature + membership) -> `can()` ->
 * Zod validation -> query under the caller's own RLS-enforced session.
 *
 * Permissions (`invoicing`): `read` = overview/list, `update` = register /
 * delete a payment (delete: the payment's creator, or a role with `delete` =
 * owner), `create` = credit an invoice (generates a credit note).
 *
 * Reads go through the `invoice_overview` view (security_invoker): one row per
 * invoice or credit note with client/quote/contract context, the derived
 * `payment_status`, `paid_amount`, `outstanding` and `email_status`.
 */

const uuidSchema = z.string().uuid("Invalid id.");

export type InvoiceEmailOutcome = EmailOutcome;
export type InvoicePaymentStatusValue = "open" | "partially_paid" | "paid" | "overdue" | "credited" | "credit_note";
export type InvoiceEmailStatus = "sent" | "failed" | "not_sent";

const PAYMENT_STATUSES = ["open", "partially_paid", "paid", "overdue", "credited", "credit_note"] as const;

// ---------------------------------------------------------------------------
// listInvoices
// ---------------------------------------------------------------------------

export interface ListInvoicesFilters {
  /** `YYYY-MM-DD`, inclusive, on invoice_date. */
  from?: string;
  to?: string;
  clientId?: string;
  paymentStatuses?: InvoicePaymentStatusValue[];
  quoteType?: "default" | "contract";
  /** Matches invoice number or client name. */
  search?: string;
  sort?: "invoice_number" | "invoice_date" | "due_date" | "subtotal" | "total" | "client_name";
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface InvoiceListRow {
  id: string;
  kind: "invoice" | "credit_note";
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  /** Excl. VAT; negative for a credit note. */
  subtotal: number;
  /** Incl. VAT; negative for a credit note. */
  total: number;
  vatTotal: number;
  clientId: string | null;
  clientName: string | null;
  quoteId: string;
  quoteNumber: string | null;
  quoteName: string | null;
  quoteType: "default" | "contract" | null;
  contractId: string | null;
  contractNumber: string | null;
  paidAmount: number;
  outstanding: number;
  paymentStatus: InvoicePaymentStatusValue;
  emailStatus: InvoiceEmailStatus;
  emailedTo: string | null;
  emailedAt: string | null;
  emailError: string | null;
  /** Latest e-mail outbox mail of this invoice / credit note (issue #268); null when none was queued. */
  outbox: OutboxMailStatus | null;
  creditsInvoiceId: string | null;
  creditedAt: string | null;
  /** Row-action hints for the signed-in user. */
  canRegisterPayment: boolean;
  canCredit: boolean;
}

export interface InvoiceKpis {
  /** Sum of totals (incl. credit notes, so credits reduce it) with invoice_date in the period. */
  invoicedInPeriod: number;
  invoicedInPeriodCount: number;
  /** All open invoices (open / partially paid / overdue), not period-bound. */
  outstandingAmount: number;
  outstandingCount: number;
  /** Subset of the outstanding ones past their due date. */
  overdueAmount: number;
  overdueCount: number;
}

const filtersSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid from date.").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid to date.").optional(),
  clientId: z.string().uuid("Invalid client id.").optional(),
  paymentStatuses: z.array(z.enum(PAYMENT_STATUSES)).max(PAYMENT_STATUSES.length).optional(),
  quoteType: z.enum(["default", "contract"]).optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(["invoice_number", "invoice_date", "due_date", "subtotal", "total", "client_name"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
});

const LIST_COLUMNS =
  "id, kind, invoice_number, invoice_date, due_date, subtotal, vat_total, total, client_id, client_name, quote_id, quote_number," +
  " quote_name, quote_type, contract_id, contract_number, paid_amount, outstanding, payment_status, email_status, emailed_to," +
  " emailed_at, email_error, credits_invoice_id, credited_at";

interface ListRowDb {
  id: string;
  kind: "invoice" | "credit_note";
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  subtotal: number | string;
  vat_total: number | string;
  total: number | string;
  client_id: string | null;
  client_name: string | null;
  quote_id: string;
  quote_number: string | null;
  quote_name: string | null;
  quote_type: "default" | "contract" | null;
  contract_id: string | null;
  contract_number: string | null;
  paid_amount: number | string | null;
  outstanding: number | string | null;
  payment_status: InvoicePaymentStatusValue;
  email_status: InvoiceEmailStatus;
  emailed_to: string | null;
  emailed_at: string | null;
  email_error: string | null;
  credits_invoice_id: string | null;
  credited_at: string | null;
}

type KpiRow = { total: number | string; outstanding: number | string | null; payment_status: string };

/** Pages through the KPI query (capped at 10 000 rows). */
async function fetchKpiRows(
  makeQuery: () => {
    order: (column: string) => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> };
  },
): Promise<{ rows: KpiRow[]; error?: string }> {
  const rows: KpiRow[] = [];
  const PAGE = 1000;
  for (let page = 0; page < 10; page += 1) {
    const { data, error } = await makeQuery()
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { rows, error: mapDbError(error) };
    const chunk = (data ?? []) as KpiRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return { rows };
}

/**
 * Invoices overview: filtered, sorted, paginated rows plus the KPI header.
 * KPI scope: "invoiced in period" respects period + client + quote type;
 * "outstanding"/"overdue" respect client + quote type only (they are a
 * snapshot of open receivables, not period-bound).
 */
export async function listInvoices(
  filters: ListInvoicesFilters = {},
): Promise<ActionResult<{ invoices: InvoiceListRow[]; count: number; kpis: InvoiceKpis }>> {
  const parsed = filtersSchema.safeParse(filters);
  if (!parsed.success) return fail("Invalid filters.", parsed.error.flatten().fieldErrors);
  const f = parsed.data;

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const { actor } = ctx.context;
  if (!can(actor, "invoicing", "read")) return fail("You do not have permission to view invoices.");

  const limit = clampLimit(f.limit, 25, 200);
  const offset = clampOffset(f.offset);
  const supabase = await createSupabaseServerClient();

  const query = applyInvoiceSort(
    applyInvoiceFilters(supabase.from("invoice_overview").select(LIST_COLUMNS, { count: "exact" }), f),
    f,
  ).range(offset, offset + limit - 1);

  const kpiQuery = (withPeriod: boolean, onlyOpen: boolean) => () => {
    let q = supabase.from("invoice_overview").select("total, outstanding, payment_status");
    if (withPeriod && f.from) q = q.gte("invoice_date", f.from);
    if (withPeriod && f.to) q = q.lte("invoice_date", f.to);
    if (f.clientId) q = q.eq("client_id", f.clientId);
    if (f.quoteType) q = q.eq("quote_type", f.quoteType);
    if (onlyOpen) q = q.in("payment_status", ["open", "partially_paid", "overdue"]);
    return q;
  };

  const [listResult, invoicedResult, openResult] = await Promise.all([
    query,
    fetchKpiRows(kpiQuery(true, false)),
    fetchKpiRows(kpiQuery(false, true)),
  ]);

  if (listResult.error) return fail(mapDbError(listResult.error));
  if (invoicedResult.error) return fail(invoicedResult.error);
  if (openResult.error) return fail(openResult.error);

  const canRegister = can(actor, "invoicing", "update");
  const canCredit = can(actor, "invoicing", "create");
  const rows = (listResult.data ?? []) as unknown as ListRowDb[];
  const outboxById = await getLatestInvoiceOutboxStatus(
    supabase,
    rows.map((row) => row.id),
    canRegister,
  );
  const invoices: InvoiceListRow[] = rows.map((row) => {
    const payable = row.kind === "invoice" && !row.credited_at;
    return {
      id: row.id,
      kind: row.kind,
      invoiceNumber: row.invoice_number,
      invoiceDate: row.invoice_date,
      dueDate: row.due_date,
      subtotal: Number(row.subtotal),
      total: Number(row.total),
      vatTotal: Number(row.vat_total),
      clientId: row.client_id,
      clientName: row.client_name,
      quoteId: row.quote_id,
      quoteNumber: row.quote_number,
      quoteName: row.quote_name,
      quoteType: row.quote_type,
      contractId: row.contract_id,
      contractNumber: row.contract_number,
      paidAmount: Number(row.paid_amount ?? 0),
      outstanding: Number(row.outstanding ?? 0),
      paymentStatus: row.payment_status,
      emailStatus: row.email_status,
      emailedTo: row.emailed_to,
      emailedAt: row.emailed_at,
      emailError: row.email_error,
      outbox: outboxById.get(row.id) ?? null,
      creditsInvoiceId: row.credits_invoice_id,
      creditedAt: row.credited_at,
      canRegisterPayment: canRegister && payable && Number(row.outstanding ?? 0) > 0,
      canCredit: canCredit && payable,
    };
  });

  const round = (value: number) => Math.round(value * 100) / 100;
  const sum = (items: { total: number | string; outstanding: number | string | null }[], key: "total" | "outstanding") =>
    round(items.reduce((acc, item) => acc + Number(item[key] ?? 0), 0));
  const overdue = openResult.rows.filter((row) => row.payment_status === "overdue");

  return ok({
    invoices,
    count: listResult.count ?? 0,
    kpis: {
      invoicedInPeriod: sum(invoicedResult.rows, "total"),
      invoicedInPeriodCount: invoicedResult.rows.length,
      outstandingAmount: sum(openResult.rows, "outstanding"),
      outstandingCount: openResult.rows.length,
      overdueAmount: sum(overdue, "outstanding"),
      overdueCount: overdue.length,
    },
  });
}

// ---------------------------------------------------------------------------
// listPaymentMethods
// ---------------------------------------------------------------------------

export interface PaymentMethodOption {
  id: string;
  value: string;
  label: string;
  isDefault: boolean;
}

/** Active items of the tenant's `payment_method` list, default first. Gated by
 * `invoicing` `read` (not `settings`), so any invoicing role can fill the
 * "Register payment" popup. */
export async function listPaymentMethods(): Promise<
  ActionResult<{ methods: PaymentMethodOption[]; defaultMethodId: string | null }>
> {
  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  if (!can(ctx.context.actor, "invoicing", "read")) return fail("You do not have permission to view invoices.");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("reference_list_items")
    .select("id, value, label, is_default, sort_order, reference_list:reference_lists!inner(list_key)")
    .eq("reference_list.list_key", "payment_method")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) return fail(mapDbError(error));

  const methods = ((data ?? []) as unknown as { id: string; value: string; label: string; is_default: boolean }[])
    .map((row) => ({ id: row.id, value: row.value, label: row.label, isDefault: row.is_default }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  return ok({ methods, defaultMethodId: methods.find((m) => m.isDefault)?.id ?? methods[0]?.id ?? null });
}

// ---------------------------------------------------------------------------
// registerPayment / deletePayment
// ---------------------------------------------------------------------------

function isRealDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const paymentSchema = z.object({
  invoiceId: z.string().uuid("Invalid invoice id."),
  paidOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
    .refine(isRealDate, "Enter a valid date."),
  amount: z.coerce
    .number({ invalid_type_error: "Enter an amount." })
    .positive("The amount must be greater than 0.")
    .max(9_999_999_999.99, "The amount is too large.")
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Use at most 2 decimals."),
  methodId: z.string().uuid("Choose a payment method."),
  note: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(500, "The note is too long.").optional(),
  ),
});

export interface RegisterPaymentInput {
  invoiceId: string;
  /** `YYYY-MM-DD`. */
  paidOn: string;
  /** Euro amount; number or numeric string. Defaulting to the outstanding amount is a UI concern. */
  amount: number | string;
  methodId: string;
  note?: string | null;
}

/** Registers a (partial or full) payment on an invoice. Validation failures
 * (including the DB's "exceeds the outstanding amount" check, mapped to the
 * `amount` field) come back as `{ error, fieldErrors }` so the popup keeps the
 * entered data. Needs `invoicing` `update`. */
export async function registerPayment(input: RegisterPaymentInput): Promise<ActionResult<{ paymentId: string }>> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return fail("Please correct the highlighted fields.", parsed.error.flatten().fieldErrors);
  const data = parsed.data;

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  if (!can(ctx.context.actor, "invoicing", "update")) {
    return fail("Only an owner, finance or administratie member can register payments.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, kind, credited_at")
    .eq("id", data.invoiceId)
    .maybeSingle<{ id: string; kind: "invoice" | "credit_note"; credited_at: string | null }>();
  if (invoiceError) return fail(mapDbError(invoiceError));
  if (!invoice) return fail("Invoice not found, or you do not have permission to view it.");
  if (invoice.kind === "credit_note") return fail("Payments cannot be registered on a credit note.");
  if (invoice.credited_at) return fail("Payments cannot be registered on a credited invoice.");

  // The method must be an item of this tenant's payment_method list (the DB trigger re-checks).
  const { data: method, error: methodError } = await supabase
    .from("reference_list_items")
    .select("id, reference_list:reference_lists!inner(list_key)")
    .eq("id", data.methodId)
    .eq("reference_list.list_key", "payment_method")
    .maybeSingle<{ id: string }>();
  if (methodError) return fail(mapDbError(methodError));
  if (!method) return fail("Choose a valid payment method.", { methodId: ["Choose a valid payment method."] });

  const { data: payment, error } = await supabase
    .from("invoice_payments")
    .insert({
      invoice_id: data.invoiceId,
      paid_on: data.paidOn,
      amount: data.amount,
      method_id: data.methodId,
      note: data.note ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    if (error.code === "23514" && error.message.startsWith("The payment exceeds")) {
      return fail(error.message, { amount: [error.message] });
    }
    if (error.code === "23514") return fail(error.message);
    if (error.code === "42501") return fail("Only an owner, finance or administratie member can register payments.");
    return fail(mapDbError(error));
  }
  return ok({ paymentId: payment.id });
}

/** Deletes a payment. Allowed for the payment's creator and for roles with
 * `invoicing` `delete` (owner); RLS enforces the same. */
export async function deletePayment(paymentId: string): Promise<ActionResult> {
  const idResult = uuidSchema.safeParse(paymentId);
  if (!idResult.success) return fail("Invalid payment id.");

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, session } = ctx.context;
  if (!can(actor, "invoicing", "update")) {
    return fail("Only an owner, finance or administratie member can delete payments.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: payment, error: readError } = await supabase
    .from("invoice_payments")
    .select("id, created_by")
    .eq("id", idResult.data)
    .maybeSingle<{ id: string; created_by: string | null }>();
  if (readError) return fail(mapDbError(readError));
  if (!payment) return fail("Payment not found, or you do not have permission to view it.");

  if (payment.created_by !== session.userId && !can(actor, "invoicing", "delete")) {
    return fail("Only the member who registered this payment, or an owner, can delete it.");
  }

  // RLS filters silently, so ask for the deleted row back to detect "nothing deleted".
  const { data: deleted, error } = await supabase
    .from("invoice_payments")
    .delete()
    .eq("id", payment.id)
    .select("id");
  if (error) return fail(mapDbError(error));
  if (!deleted || deleted.length === 0) return fail("You do not have permission to delete this payment.");
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// creditInvoice
// ---------------------------------------------------------------------------

const creditSchema = z.object({
  invoiceId: z.string().uuid("Invalid invoice id."),
  reason: z.string().trim().min(1, "A reason is required.").max(1000, "The reason is too long."),
});

export interface CreditInvoiceResult {
  creditNoteId: string;
  creditNoteNumber: string;
  email: InvoiceEmailOutcome;
}

/**
 * Credits an invoice: the DB function `credit_invoice` creates the credit note
 * (same number series, negated snapshot), marks the invoice credited, sets the
 * quote back to Draft (no Accepted status exists), the work order back to Completed and rolls back the
 * contract period - all in one transaction. Then the credit note PDF is stored
 * and best-effort e-mailed to the same invoice contact as the invoice (outcome
 * recorded on the credit-note row). Needs `invoicing` `create`.
 */
export async function creditInvoice(input: { invoiceId: string; reason: string }): Promise<ActionResult<CreditInvoiceResult>> {
  const parsed = creditSchema.safeParse(input);
  if (!parsed.success) return fail("Please correct the highlighted fields.", parsed.error.flatten().fieldErrors);

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId, session } = ctx.context;
  if (!can(actor, "invoicing", "create")) {
    return fail("Only an owner, finance or administratie member can credit invoices.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: creditNoteId, error } = await supabase.rpc("credit_invoice", {
    p_invoice_id: parsed.data.invoiceId,
    p_reason: parsed.data.reason,
  });
  if (error) {
    if (error.code === "23514" && error.message.includes("reason")) {
      return fail(error.message, { reason: [error.message] });
    }
    if (error.code && ["P0002", "23505", "23514", "42501"].includes(error.code)) return fail(error.message);
    return fail(mapDbError(error));
  }
  if (!creditNoteId) return fail("Could not create the credit note.");

  const { data: creditNote, error: readError } = await supabase
    .from("invoices")
    .select("id, invoice_number")
    .eq("id", creditNoteId as string)
    .single<{ id: string; invoice_number: string }>();
  if (readError) return fail(mapDbError(readError));

  // Store the credit note PDF (best effort; the first open stores it otherwise), then e-mail it.
  await getInvoicePdfById(supabase, creditNote.id);
  const email = await sendInvoiceEmailById(supabase, organizationId, session.organization?.name ?? "", creditNote.id);

  return ok({ creditNoteId: creditNote.id, creditNoteNumber: creditNote.invoice_number, email });
}
