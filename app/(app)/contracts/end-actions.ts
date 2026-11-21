"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { assetVolumeReadingValueSchema } from "@/lib/asset-volumes/schema";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import {
  counterWindowDetails,
  planFinalBalance,
  type BalanceContractLine,
  type BalancePeriod,
  type CounterWindowBalance,
  type ExistingPeriodQuote,
  type QuoteLineDraft,
  type UsageProvider,
} from "../quotes/contract-balance";
import { CONTRACT_SELECT, toBalanceLines, type ContractRow } from "../quotes/contract-quote-data";
import { coveredAssetsForCounter, loadCounterData, makeUsageProvider } from "../quotes/counter-data";
import {
  addDaysIso,
  billingMultiplier,
  billingPeriodMonths,
  describeContractAssets,
  formatPeriodLabel,
} from "../quotes/contract-quote-helpers";
import type { ContractStatus, CounterSettlementFrequency } from "./schema";
import { requiredIsoDateSchema } from "./schema";

/**
 * Ending a contract (issue #271): the final balance flow behind the End contract page.
 *
 * All four mutating/reading entry points need the `contracts` module and
 * `can(actor, "contracts", "update")` (owner/finance; the `complete_contract_end` RPC
 * checks the same roles, and thereby lets finance create the final settlement quote
 * and the closing readings the table policies would not allow them directly).
 *
 *  - getContractEndBalance: read-only preview. End date in the future = 'schedule'
 *    mode (summary only); otherwise 'complete' mode with closing-reading rows and the
 *    full balance (periods, credits, counter windows, totals). Entered closing readings
 *    override stored readings on the end date, without saving anything. Every
 *    covered asset × counter needs a closing reading.
 *  - scheduleContractEnd / cancelScheduledContractEnd: future end date, contract stays
 *    active.
 *  - completeContractEnd: recomputes everything server-side (never trusts client
 *    amounts) and calls the atomic RPC (readings + replaced quotes + final quote +
 *    final ledger rows + status ended).
 *  - getContractFinalBalanceSummary: read-only summary for an ended contract.
 *
 * Dates are UTC dates, like the RPC.
 */

const uuidSchema = z.string().uuid("Invalid id.");

const endDateSchema = requiredIsoDateSchema.refine(
  (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
  "Enter a valid date.",
);

const rowKeySchema = z.object({
  assetId: uuidSchema,
  volumeItemId: uuidSchema,
});

const endInputSchema = z.object({
  endDate: endDateSchema,
  /** Closing readings entered on the page (value on the end date). */
  closingReadings: z.array(rowKeySchema.extend({ value: assetVolumeReadingValueSchema })).max(2000).default([]),
});

export type ContractEndInput = z.input<typeof endInputSchema>;

export interface ContractEndSummary {
  id: string;
  contractNumber: string;
  status: ContractStatus;
  startDate: string;
  /** Current end_date (may be a scheduled one). */
  endDate: string | null;
  endScheduledAt: string | null;
  hasFinalSettlement: boolean;
  invoicingTiming: "in_advance" | "in_arrears";
  invoicedPeriodCount: number;
  /** Billing terms interval in months; null = non-recurring. */
  intervalMonths: number | null;
  counterSettlementFrequency: CounterSettlementFrequency;
  counterSettlementMonth: number | null;
  /** End of the last settled window (ledger). */
  lastSettledEnd: string | null;
  hasCounterLines: boolean;
  /** At least one counter line credits under-use. */
  creditsUnderUse: boolean;
}

export interface EndReadingRow {
  assetId: string;
  assetName: string;
  serialNumber: string | null;
  volumeItemId: string;
  counterLabel: string;
  /** Date from which the asset is covered (contract start or the date it was added). */
  baselineDate: string;
  /** Latest accepted reading before the end date. */
  lastReading: { value: number; readAt: string } | null;
  /** Accepted reading that already exists on the end date. Such a row needs no input. */
  closingReading: { value: number; readAt: string } | null;
  /** Value entered in this request (preview), not saved yet. */
  enteredValue: number | null;
  /** Has an existing closing reading or an entered value. Every row needs one. */
  resolved: boolean;
}

export interface ContractEndBalance {
  contract: ContractEndSummary;
  /** 'schedule' = end date in the future (only `contract` is meaningful); 'complete' = balance. */
  mode: "schedule" | "complete";
  endDate: string;
  readingRows: EndReadingRow[];
  periods: BalancePeriod[];
  /** Un-invoiced period quotes that the final quote replaces (deleted on completion). */
  quotesToReplace: { id: string; quoteNumber: string | null; name: string }[];
  openLines: QuoteLineDraft[];
  creditLines: QuoteLineDraft[];
  counterWindows: CounterWindowBalance[];
  warnings: string[];
  totals: { toInvoice: number; toCredit: number; net: number };
  /** Reading rows without closing reading, entered value or skip. Completing needs 0. */
  missingReadings: number;
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function rpcError(error: { code?: string; message: string }): string {
  return error.code === "23514" || error.code === "42501" || error.code === "P0002"
    ? error.message
    : mapDbError(error);
}

interface RpcArgs {
  p_contract_id: string;
  p_end_date: string;
  p_readings: { asset_id: string; volume_item_id: string; value: number }[];
  p_quote: Record<string, string | null> | null;
  p_lines: {
    article_id: string | null;
    article_number: string | null;
    description: string;
    quantity: number;
    unit_price: number;
    sort_order: number;
  }[];
  p_settlements: { period_start: string; period_end: string; details: unknown }[];
  p_delete_quote_ids: string[];
}

interface BuiltBalance {
  balance: ContractEndBalance;
  rpc: RpcArgs | null;
  /** Problems that block completion (readings below the previous one, unknown rows, ...). */
  blockers: string[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function loadFinalState(supabase: Supabase, contractId: string): Promise<{ hasFinal: boolean } | { error: string }> {
  const [{ data: quotes, error: quotesError }, { data: ledger, error: ledgerError }] = await Promise.all([
    supabase.from("quotes").select("id").eq("contract_id", contractId).eq("is_final_settlement", true).limit(1),
    supabase.from("contract_counter_settlements").select("id").eq("contract_id", contractId).eq("is_final", true).limit(1),
  ]);
  const error = quotesError ?? ledgerError;
  if (error) return { error: mapDbError(error) };
  return { hasFinal: (quotes ?? []).length > 0 || (ledger ?? []).length > 0 };
}

async function buildEndBalance(
  supabase: Supabase,
  contractId: string,
  input: z.output<typeof endInputSchema>,
  today: string,
): Promise<{ error: string } | BuiltBalance> {
  const { data, error } = await supabase.from("contracts").select(CONTRACT_SELECT).eq("id", contractId).maybeSingle();
  if (error) return { error: mapDbError(error) };
  if (!data) return { error: "Contract not found." };
  const contract = data as unknown as ContractRow;

  const finalState = await loadFinalState(supabase, contractId);
  if ("error" in finalState) return finalState;

  if (contract.status === "draft") return { error: "A draft contract cannot be ended." };
  if (contract.status === "ended" && finalState.hasFinal) return { error: "This contract already has a final balance." };
  const E = input.endDate;
  if (E < contract.start_date) return { error: "The end date cannot be before the start date of the contract." };

  const lines: BalanceContractLine[] = toBalanceLines(contract);
  const counterLines = lines.filter((l) => l.isVolume && l.volumeItemId);
  const intervalMonths = contract.billing_terms?.interval_months ?? null;
  const multiplier = billingMultiplier(intervalMonths, billingPeriodMonths(contract.billing_period));

  const { data: ledgerData, error: ledgerError } = await supabase
    .from("contract_counter_settlements")
    .select("contract_id, period_start, period_end, quote_id, is_final")
    .eq("contract_id", contractId);
  if (ledgerError) return { error: mapDbError(ledgerError) };
  const ledger = (ledgerData ?? []) as {
    period_end: string;
    quote_id: string | null;
  }[];

  const summary: ContractEndSummary = {
    id: contract.id,
    contractNumber: contract.contract_number,
    status: contract.status,
    startDate: contract.start_date,
    endDate: contract.end_date,
    endScheduledAt: contract.end_scheduled_at,
    hasFinalSettlement: finalState.hasFinal,
    invoicingTiming: contract.invoicing_timing,
    invoicedPeriodCount: contract.invoiced_period_count,
    intervalMonths,
    counterSettlementFrequency: contract.counter_settlement_frequency,
    counterSettlementMonth: contract.counter_settlement_month,
    lastSettledEnd: ledger.reduce<string | null>((best, r) => (best === null || r.period_end > best ? r.period_end : best), null),
    hasCounterLines: counterLines.length > 0,
    creditsUnderUse: counterLines.some((l) => l.creditUnderUse),
  };

  const empty = (mode: "schedule" | "complete"): ContractEndBalance => ({
    contract: summary,
    mode,
    endDate: E,
    readingRows: [],
    periods: [],
    quotesToReplace: [],
    openLines: [],
    creditLines: [],
    counterWindows: [],
    warnings: [],
    totals: { toInvoice: 0, toCredit: 0, net: 0 },
    missingReadings: 0,
  });

  if (E > today) {
    if (contract.status !== "active") return { error: "The end date of an ended contract cannot be in the future." };
    return { balance: empty("schedule"), rpc: null, blockers: [] };
  }

  // --- Existing period quotes -------------------------------------------------
  const { data: quoteData, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "id, name, quote_number, contract_period_start, contract_period_end," +
        " quote_line_items(quantity,unit_price,discount_percent)," +
        " invoice:invoices(invoice_number,kind,credited_at)",
    )
    .eq("contract_id", contractId)
    .eq("quote_type", "contract")
    .eq("is_final_settlement", false)
    .eq("is_counter_settlement", false);
  if (quoteError) return { error: mapDbError(quoteError) };
  type QuoteRow = {
    id: string;
    name: string;
    quote_number: string | null;
    contract_period_start: string;
    contract_period_end: string;
    quote_line_items: { quantity: number | string; unit_price: number | string; discount_percent: number | string }[];
    invoice:
      | { invoice_number: string; kind: string; credited_at: string | null }
      | { invoice_number: string; kind: string; credited_at: string | null }[]
      | null;
  };
  const quoteRows = (quoteData ?? []) as unknown as QuoteRow[];
  const quoteNames = new Map(quoteRows.map((q) => [q.id, { quoteNumber: q.quote_number, name: q.name }]));

  // Un-invoiced counter settlement quotes whose window extends beyond the end date are
  // replaced too (their ledger rows go with them), like un-invoiced period quotes.
  const { data: counterQuoteData, error: counterQuoteError } = await supabase
    .from("quotes")
    .select("id, name, quote_number, counter_settlement_end, invoice:invoices(id)")
    .eq("contract_id", contractId)
    .eq("quote_type", "contract")
    .eq("is_counter_settlement", true);
  if (counterQuoteError) return { error: mapDbError(counterQuoteError) };
  const extraReplace: string[] = [];
  for (const q of (counterQuoteData ?? []) as unknown as {
    id: string;
    name: string;
    quote_number: string | null;
    counter_settlement_end: string | null;
    invoice: { id: string }[] | { id: string } | null;
  }[]) {
    const hasInvoice = Array.isArray(q.invoice) ? q.invoice.length > 0 : Boolean(q.invoice);
    if (!hasInvoice && q.counter_settlement_end && q.counter_settlement_end > E) {
      extraReplace.push(q.id);
      quoteNames.set(q.id, { quoteNumber: q.quote_number, name: q.name });
    }
  }
  const periodQuotes: ExistingPeriodQuote[] = quoteRows.map((q) => {
    const invoices = Array.isArray(q.invoice) ? q.invoice : q.invoice ? [q.invoice] : [];
    const live = invoices.find((i) => i.kind === "invoice" && i.credited_at === null) ?? null;
    return {
      id: q.id,
      periodStart: q.contract_period_start,
      periodEnd: q.contract_period_end,
      invoiced: invoices.length > 0,
      quoteNumber: q.quote_number ?? q.name,
      invoiceNumber: live?.invoice_number ?? null,
      amount: round2(
        q.quote_line_items.reduce(
          (sum, l) => sum + Number(l.quantity) * Number(l.unit_price) * (1 - Number(l.discount_percent) / 100),
          0,
        ),
      ),
    };
  });

  const balanceContract = {
    startDate: contract.start_date,
    endDate: E,
    timing: contract.invoicing_timing,
    intervalMonths,
    multiplier,
    frequency: contract.counter_settlement_frequency,
    settlementMonth: contract.counter_settlement_month,
    invoicedPeriodCount: contract.invoiced_period_count,
  };

  // Un-invoiced period quotes that the final quote replaces also carry ledger rows
  // (the next in-advance quote settles the previous period); those windows become
  // unsettled again when the quote is deleted, so they do not count as settled here.
  const noUsage: UsageProvider = () => ({ usage: 0, issues: [], reviewReadingsInPeriod: 0 });
  const replaceIds = new Set([
    ...planFinalBalance({ contract: balanceContract, lines, periodQuotes, lastSettledEnd: null, usageFor: noUsage })
      .quotesToReplace,
    ...extraReplace,
  ]);
  const lastSettledEnd = ledger
    .filter((r) => !(r.quote_id && replaceIds.has(r.quote_id)))
    .reduce<string | null>((best, r) => (best === null || r.period_end > best ? r.period_end : best), null);

  // --- Counter data, reading rows, usage ----------------------------------------
  const blockers: string[] = [];
  const warnings: string[] = [];
  const readingRows: EndReadingRow[] = [];
  let usageFor: UsageProvider = noUsage;
  const toSend: { asset_id: string; volume_item_id: string; value: number }[] = [];

  if (counterLines.length > 0) {
    const loaded = await loadCounterData(
      supabase,
      [
        {
          id: contract.id,
          startDate: contract.start_date,
          volumeItemIds: counterLines.map((l) => l.volumeItemId as string),
        },
      ],
      E,
    );
    if ("error" in loaded) return { error: `Counter readings could not be loaded (${loaded.error}).` };
    const counterData = loaded.data;

    const entered = new Map(input.closingReadings.map((r) => [`${r.assetId}|${r.volumeItemId}`, r.value]));

    const seenCounters = new Set<string>();
    for (const line of counterLines) {
      const volumeItemId = line.volumeItemId as string;
      if (seenCounters.has(volumeItemId)) continue;
      seenCounters.add(volumeItemId);
      for (const asset of coveredAssetsForCounter(counterData, contract.id, volumeItemId)) {
        if (asset.baseline > E) continue; // not covered yet on the end date
        const key = `${asset.id}|${volumeItemId}`;
        const readings = counterData.readings.get(key) ?? [];
        const valid = readings.filter((r) => !r.needsReview);
        const closing = valid.find((r) => r.readAt.slice(0, 10) === E) ?? null;
        const last = valid.find((r) => r.readAt.slice(0, 10) < E) ?? null;
        const enteredValue = closing ? null : (entered.get(key) ?? null);
        if (enteredValue !== null && last && enteredValue < last.value) {
          const message = `${asset.name} – ${line.counterLabel}: closing reading ${enteredValue} is lower than the previous reading ${last.value}.`;
          blockers.push(message);
          warnings.push(message);
        }
        if (enteredValue !== null) toSend.push({ asset_id: asset.id, volume_item_id: volumeItemId, value: enteredValue });
        readingRows.push({
          assetId: asset.id,
          assetName: asset.name,
          serialNumber: asset.serialNumber,
          volumeItemId,
          counterLabel: line.counterLabel,
          baselineDate: asset.baseline,
          lastReading: last ? { value: last.value, readAt: last.readAt } : null,
          closingReading: closing ? { value: closing.value, readAt: closing.readAt } : null,
          enteredValue,
          resolved: Boolean(closing) || enteredValue !== null,
        });
      }
    }
    readingRows.sort(
      (a, b) => a.assetName.localeCompare(b.assetName) || a.counterLabel.localeCompare(b.counterLabel),
    );

    const rowKeys = new Set(readingRows.map((r) => `${r.assetId}|${r.volumeItemId}`));
    for (const key of entered.keys()) {
      if (!rowKeys.has(key)) blockers.push("A reading was supplied for an asset or counter that is not part of this contract.");
    }

    usageFor = makeUsageProvider({
      contractId: contract.id,
      data: counterData,
      closingReadings: new Map(toSend.map((r) => [`${r.asset_id}|${r.volume_item_id}`, r.value])),
      closingDate: E,
    });
  }

  const plan = planFinalBalance({ contract: balanceContract, lines, periodQuotes, lastSettledEnd, usageFor });
  for (const id of extraReplace) if (!plan.quotesToReplace.includes(id)) plan.quotesToReplace.push(id);
  if (lastSettledEnd && lastSettledEnd > E) {
    const message = `Counter usage is already settled up to ${lastSettledEnd}; choose an end date on or after it, or delete/credit the settlement quote first.`;
    plan.warnings.push(message);
    blockers.unshift(message);
  }
  const missingReadings = readingRows.filter((r) => !r.resolved).length;

  const balance: ContractEndBalance = {
    contract: summary,
    mode: "complete",
    endDate: E,
    readingRows,
    periods: plan.periods,
    quotesToReplace: plan.quotesToReplace.map((id) => ({
      id,
      quoteNumber: quoteNames.get(id)?.quoteNumber ?? null,
      name: quoteNames.get(id)?.name ?? "",
    })),
    openLines: plan.openLines,
    creditLines: plan.creditLines,
    counterWindows: plan.counterWindows,
    warnings: [...warnings, ...plan.warnings],
    totals: plan.totals,
    missingReadings,
  };

  // --- RPC arguments (complete only) ---------------------------------------------
  const assets = contract.contract_assets
    .map((link) => link.asset)
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
    .map((asset) => ({
      name: asset.name,
      serialNumber: asset.serial_number,
      externalReference: asset.external_reference,
      model: asset.asset_model?.name ?? null,
      siteName: formatSiteAddressShort(asset.site),
    }));
  const afterEnd = addDaysIso(E, 1);
  const label = formatPeriodLabel(E, null);
  const notes = [
    `Contract: ${contract.contract_number}${contract.external_reference ? ` — ${contract.external_reference}` : ""}`,
    contract.contract_type ? `Type: ${contract.contract_type.label}` : null,
    contract.billing_terms ? `Billing terms: ${contract.billing_terms.label}` : null,
    contract.billing_period ? `Billing period: ${contract.billing_period.label}` : null,
    contract.invoicing_timing === "in_arrears" ? "Invoicing: in arrears" : "Invoicing: in advance",
    `Final settlement of the contract ended on ${label}`,
    plan.counterRange ? `Counter usage settled: ${formatPeriodLabel(plan.counterRange.start, plan.counterRange.end)}` : null,
    `Contract start: ${formatPeriodLabel(contract.start_date, null)}`,
    "",
    describeContractAssets(assets),
    balance.warnings.length > 0 ? `\nSettlement warnings:\n${balance.warnings.map((w) => `- ${w}`).join("\n")}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n")
    .trim();

  const rpc: RpcArgs = {
    p_contract_id: contractId,
    p_end_date: E,
    p_readings: toSend,
    p_quote:
      plan.quoteLines.length > 0
        ? {
            name: `${contract.contract_number} — Final settlement ${label}`.slice(0, 200),
            notes,
            // Final quotes are not billing periods: end date + 1 (same convention as before).
            contract_period_start: afterEnd,
            contract_period_end: afterEnd,
            counter_settlement_start: plan.counterRange?.start ?? null,
            counter_settlement_end: plan.counterRange?.end ?? null,
          }
        : null,
    p_lines: plan.quoteLines.map((l) => ({
      article_id: l.articleId,
      article_number: l.articleNumber,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      sort_order: l.sortOrder,
    })),
    p_settlements: plan.counterWindows.map((w) => ({
      period_start: w.window.start,
      period_end: w.window.end,
      details: counterWindowDetails(w),
    })),
    p_delete_quote_ids: plan.quotesToReplace,
  };

  return { balance, rpc, blockers };
}

/** Module + permission gate shared by the end actions; `error` is set when refused. */
async function endContext(): Promise<{ error: string }  | { error?: undefined }> {
  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return { error: ctx.error ?? "Contracts are not available." };
  if (!can(ctx.context.actor, "contracts", "update")) {
    return { error: "Only an owner or finance user can end a contract." };
  }
  return {};
}

/**
 * Preview of ending a contract on `input.endDate`. Read-only; nothing is saved.
 * Mode 'schedule' (future end date, active contract) returns the summary only.
 */
export async function getContractEndBalance(
  contractId: string,
  input: ContractEndInput,
): Promise<ActionResult<ContractEndBalance>> {
  const idResult = uuidSchema.safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");
  const gate = await endContext();
  if (gate.error) return fail(gate.error);
  const parsed = endInputSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);

  const supabase = await createSupabaseServerClient();
  const built = await buildEndBalance(supabase, idResult.data, parsed.data, todayUtc());
  if ("error" in built) return fail(built.error);
  return ok(built.balance);
}

/** Schedules an ending on a future date: the contract stays active and `end_date` is set;
 * the previous end_date is saved once so cancelling can restore it. */
export async function scheduleContractEnd(
  contractId: string,
  endDate: string,
): Promise<ActionResult<{ endDate: string; endScheduledAt: string }>> {
  const idResult = uuidSchema.safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");
  const gate = await endContext();
  if (gate.error) return fail(gate.error);
  const dateResult = endDateSchema.safeParse(endDate);
  if (!dateResult.success) return fail("Enter a valid end date.", { endDate: ["Enter a valid end date."] });
  const today = todayUtc();
  if (dateResult.data <= today) {
    return fail("A scheduled end date must be in the future. Use the final balance for a date up to today.", {
      endDate: ["Must be in the future."],
    });
  }

  const supabase = await createSupabaseServerClient();
  const { data: current, error: currentError } = await supabase
    .from("contracts")
    .select("status, start_date, end_date, end_scheduled_at, end_date_before_scheduling")
    .eq("id", idResult.data)
    .maybeSingle<{
      status: ContractStatus;
      start_date: string;
      end_date: string | null;
      end_scheduled_at: string | null;
      end_date_before_scheduling: string | null;
    }>();
  if (currentError) return fail(mapDbError(currentError));
  if (!current) return fail("Contract not found.");
  if (current.status !== "active") return fail("Only an active contract can have a scheduled ending.");
  if (dateResult.data < current.start_date) return fail("The end date cannot be before the start date of the contract.");
  if (current.end_date && current.end_date < today) {
    return fail("The end date of this contract has passed. Complete the final balance instead.");
  }

  const scheduledAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("contracts")
    .update({
      end_date: dateResult.data,
      end_scheduled_at: current.end_scheduled_at ?? scheduledAt,
      end_date_before_scheduling: current.end_scheduled_at ? current.end_date_before_scheduling : current.end_date,
    })
    .eq("id", idResult.data)
    .eq("status", "active")
    .select("end_date, end_scheduled_at")
    .maybeSingle<{ end_date: string; end_scheduled_at: string }>();
  if (error) return fail(mapDbError(error));
  if (!data) return fail("Contract not found, its status changed in the meantime, or you do not have permission to update it.");
  revalidatePath("/contracts");
  revalidatePath(`/contracts/${idResult.data}`);
  return ok({ endDate: data.end_date, endScheduledAt: data.end_scheduled_at });
}

/** Cancels a scheduled ending while its end date has not passed: restores the previous end date. */
export async function cancelScheduledContractEnd(
  contractId: string,
): Promise<ActionResult<{ endDate: string | null }>> {
  const idResult = uuidSchema.safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");
  const gate = await endContext();
  if (gate.error) return fail(gate.error);

  const supabase = await createSupabaseServerClient();
  const { data: current, error: currentError } = await supabase
    .from("contracts")
    .select("status, end_date, end_scheduled_at, end_date_before_scheduling")
    .eq("id", idResult.data)
    .maybeSingle<{
      status: ContractStatus;
      end_date: string | null;
      end_scheduled_at: string | null;
      end_date_before_scheduling: string | null;
    }>();
  if (currentError) return fail(mapDbError(currentError));
  if (!current) return fail("Contract not found.");
  if (current.status !== "active" || !current.end_scheduled_at) return fail("This contract has no scheduled ending.");
  if (current.end_date && current.end_date < todayUtc()) {
    return fail("The scheduled end date has passed and can no longer be cancelled. Complete the final balance instead.");
  }

  const { data, error } = await supabase
    .from("contracts")
    .update({ end_date: current.end_date_before_scheduling, end_scheduled_at: null, end_date_before_scheduling: null })
    .eq("id", idResult.data)
    .eq("status", "active")
    .not("end_scheduled_at", "is", null)
    .select("end_date")
    .maybeSingle<{ end_date: string | null }>();
  if (error) return fail(mapDbError(error));
  if (!data) return fail("Contract not found, or the ending was already changed.");
  revalidatePath("/contracts");
  revalidatePath(`/contracts/${idResult.data}`);
  return ok({ endDate: data.end_date });
}

/**
 * Completes the final balance: recomputes server-side and calls `complete_contract_end`.
 * Every closing-reading row needs an existing closing reading, an entered value or a skip.
 * Returns the final settlement quote id (null when there was nothing to bill).
 */
export async function completeContractEnd(
  contractId: string,
  input: ContractEndInput,
): Promise<ActionResult<{ quoteId: string | null }>> {
  const idResult = uuidSchema.safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");
  const gate = await endContext();
  if (gate.error) return fail(gate.error);
  const parsed = endInputSchema.safeParse(input);
  if (!parsed.success) return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);

  const today = todayUtc();
  if (parsed.data.endDate > today) {
    return fail("The end date is in the future. Schedule the ending instead.", { endDate: ["Must be today or earlier."] });
  }

  const supabase = await createSupabaseServerClient();
  const built = await buildEndBalance(supabase, idResult.data, parsed.data, today);
  if ("error" in built) return fail(built.error);
  if (!built.rpc || built.balance.mode !== "complete") return fail("Nothing to complete for this end date.");
  if (built.blockers.length > 0) return fail(built.blockers[0] as string);
  if (built.balance.missingReadings > 0) {
    return fail(
      `${built.balance.missingReadings} closing reading(s) are still missing. Enter a reading or settle the row without one.`,
    );
  }

  const { data, error } = await supabase.rpc("complete_contract_end", built.rpc);
  if (error) return fail(rpcError(error));

  revalidatePath("/contracts");
  revalidatePath(`/contracts/${idResult.data}`);
  revalidatePath("/quotes");
  return ok({ quoteId: (data as string | null) ?? null });
}

export interface ContractFinalBalanceSummary {
  finalQuote: {
    id: string;
    quoteNumber: string | null;
    name: string;
    /** Total excl. VAT (sum of the lines, discounts applied). */
    total: number;
    invoiceNumber: string | null;
  } | null;
  /** Final ledger rows (windows settled by the final balance) with their per-counter figures. */
  settlements: {
    id: string;
    periodStart: string;
    periodEnd: string;
    quoteId: string | null;
    details: {
      volumeItemId: string | null;
      counterLabel: string;
      included: number;
      usage: number;
      overage: number;
      underUse: number;
      creditedUnderUse: number;
      warnings: string[];
    }[];
  }[];
}

/** Read-only summary of an ended contract's final balance. */
export async function getContractFinalBalanceSummary(
  contractId: string,
): Promise<ActionResult<ContractFinalBalanceSummary>> {
  const idResult = uuidSchema.safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");
  const ctx = await requireModuleContext("contracts");
  if (!ctx.ok) return fail(ctx.error);
  if (!canAny(ctx.context.actor, "contracts", ["read"])) {
    return fail("You do not have permission to view this contract.");
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: quoteData, error: quoteError }, { data: ledgerData, error: ledgerError }] = await Promise.all([
    supabase
      .from("quotes")
      .select(
        "id, name, quote_number, quote_line_items(quantity,unit_price,discount_percent)," +
          " invoice:invoices(invoice_number,kind,credited_at)",
      )
      .eq("contract_id", idResult.data)
      .eq("is_final_settlement", true)
      .limit(1),
    supabase
      .from("contract_counter_settlements")
      .select("id, period_start, period_end, quote_id, details")
      .eq("contract_id", idResult.data)
      .eq("is_final", true)
      .order("period_start", { ascending: true }),
  ]);
  const error = quoteError ?? ledgerError;
  if (error) return fail(mapDbError(error));

  type FinalQuoteRow = {
    id: string;
    name: string;
    quote_number: string | null;
    quote_line_items: { quantity: number | string; unit_price: number | string; discount_percent: number | string }[];
    invoice:
      | { invoice_number: string; kind: string; credited_at: string | null }
      | { invoice_number: string; kind: string; credited_at: string | null }[]
      | null;
  };
  const row = ((quoteData ?? []) as unknown as FinalQuoteRow[])[0];
  const invoices = row ? (Array.isArray(row.invoice) ? row.invoice : row.invoice ? [row.invoice] : []) : [];
  const live = invoices.find((i) => i.kind === "invoice" && i.credited_at === null) ?? null;

  return ok({
    finalQuote: row
      ? {
          id: row.id,
          quoteNumber: row.quote_number,
          name: row.name,
          total: round2(
            row.quote_line_items.reduce(
              (sum, l) => sum + Number(l.quantity) * Number(l.unit_price) * (1 - Number(l.discount_percent) / 100),
              0,
            ),
          ),
          invoiceNumber: live?.invoice_number ?? null,
        }
      : null,
    settlements: ((ledgerData ?? []) as unknown as {
      id: string;
      period_start: string;
      period_end: string;
      quote_id: string | null;
      details: ContractFinalBalanceSummary["settlements"][number]["details"] | null;
    }[]).map((r) => ({
      id: r.id,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      quoteId: r.quote_id,
      details: r.details ?? [],
    })),
  });
}
