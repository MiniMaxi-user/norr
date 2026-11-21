"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAny } from "@/lib/rbac/permissions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import {
  counterWindowDetails,
  buildPeriodLine,
  evaluateCounterWindow,
  proRataFactor,
  settlementWindows,
  uncappedPeriodByIndex,
  type BalanceContractLine,
  type DateRange,
  type QuoteLineDraft,
} from "./contract-balance";
import { loadCounterData, makeUsageProvider, type CounterData } from "./counter-data";
import { CONTRACT_SELECT, toBalanceLines, type ContractRow } from "./contract-quote-data";
import { isPeriodQuoteDue, planSettlementPeriod } from "./counter-settlement";
import {
  addDaysIso,
  billingMultiplier,
  billingPeriodMonths,
  computeContractPeriod,
  describeContractAssets,
  formatPeriodLabel,
  type ContractAssetNote,
} from "./contract-quote-helpers";

/**
 * Contract quote generation (issue #210) and the per-contract quote list
 * (issue #211, item 7).
 *
 * `generateContractQuotes` — "Generate contract quotes" button on /quotes:
 *  - Candidates (issues #269/#270/#271): ACTIVE contracts. A period quote is
 *    generated when `next_invoice_date` is set and <= today (server date, UTC); in
 *    arrears additionally only once the period END is before today. Draft and
 *    ended contracts get nothing. An ACTIVE contract whose end date has passed
 *    gets nothing either: it awaits its final balance (contracts/end-actions.ts)
 *    and is returned in `pendingFinalBalance`, like an ENDED contract without a
 *    final settlement (final settlement quote or final ledger row).
 *    This run no longer creates final settlement quotes.
 *  - Pro rata (#271): the last period of a contract with an end date is capped at
 *    the end date; its lines are priced by days (capped days / full period days), so
 *    full periods are unchanged. The included counter quantity of any settlement
 *    window is pro rata by days too (contract-balance.ts, includedForWindow).
 *  - Counter settlement windows (#271) come from the contract's
 *    `counter_settlement_frequency`; the ledger `contract_counter_settlements` is the
 *    single source of "already settled" (next unsettled window starts the day after
 *    the latest settled end, or on the contract start):
 *      with_invoice (default): the period quote settles the unsettled windows up to the
 *        period it settles (in arrears = the invoiced period itself, in advance = the
 *        PREVIOUS period; none for the first in-advance quote). The overage lines (and
 *        under-use credit lines for lines with credit_under_use) are on the period quote.
 *      monthly/quarterly/annually: period quotes carry no counter lines; each due window
 *        (calendar windows ending the day before the settlement dates, window end <
 *        today) gets its own \`is_counter_settlement\` quote. A window with nothing to
 *        bill only gets its ledger row (no quote).
 *    Per asset the baseline is the asset's coverage start (contract start or the date it
 *    was added; \`contract_covered_assets\` RPC): a reading on that date counts.
 *  - One period quote per contract per run. A contract's period is SKIPPED when a
 *    contract quote already exists for (contract_id, contract_period_start =
 *    next_invoice_date) (a 23505 from the partial unique index is treated the same).
 *    \`next_invoice_date\` only advances once that quote is invoiced (DB trigger on
 *    invoices), so the following period is generated only after invoicing.
 *  - Period: start = next_invoice_date. With a recurring billing TERMS item
 *    (\`interval_months\`): end = contract start_date + (invoiced_period_count +
 *    1) x interval_months - 1 day (anchored on the contract start like the DB,
 *    so month-end starts stay contiguous). Non-recurring terms (per visit / one
 *    time) or no terms: end = contract end_date when set, else the start date itself
 *    (a one-off charge). The end is always capped at the contract's end_date.
 *  - Quote: quote_type 'contract', client = contract's client, no site, default
 *    (draft) status, name "<contract number> — <period>", no valid_until.
 *  - Lines come from contract_line_items. Their prices are per billing PERIOD
 *    (contracts.billing_period_id) while billing TERMS is the invoicing frequency,
 *    so multiplier = terms.interval_months / period.interval_months (period months
 *    from the item's interval_months, else monthly=1, quarterly=3, annually=12; if
 *    either is unknown/non-recurring: 1). The multiplier (times the pro rata factor)
 *    scales the quantity when exact at 2 decimals, otherwise the unit price (rounded
 *    to cents). Each line description gets the invoiced period appended.
 *  - \`is_volume\` lines are billed like any other contract line at their contracted
 *    quantity x price per period; a volume line linked to a counter additionally
 *    gets an overage line (usage above the included quantity at overage_unit_price)
 *    and, when credit_under_use is on, an under-use credit line (negative quantity at
 *    the line's own unit price). Usage = sum over the covered assets whose model has
 *    the counter of (latest reading <= end of window end) - (latest reading <= start
 *    of window start); see counter-settlement.ts. Readings flagged needs_review are
 *    ignored; missing readings and counter resets skip the asset. All of that is
 *    reported as warnings (quote notes + result).
 *  - Quote notes: plain-text contract details + covered assets, so they are
 *    traceable and printed on the invoice.
 */

export interface PendingFinalBalance {
  contractId: string;
  contractNumber: string;
  endDate: string | null;
  /** active = end date passed but still active; ended = ended without a final balance (legacy). */
  status: "active" | "ended";
}

export interface GenerateContractQuotesResult {
  /** Quotes created (period quotes and counter settlement quotes). */
  created: number;
  skipped: number;
  /** Counter settlement windows settled without a quote (nothing to bill): ledger row only. */
  settledWithoutQuote: number;
  errors: { contractId: string; contractNumber: string; error: string }[];
  /** Quote was created, but counter settlement needs attention (issue #239). */
  warnings: { contractId: string; contractNumber: string; message: string }[];
  /** Contracts that need their final balance completed (issue #271); link to /contracts/[id]/end. */
  pendingFinalBalance: PendingFinalBalance[];
}

const MAX_CONTRACTS_PER_RUN = 500;
const IN_CHUNK = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type InvoiceEmbed = { invoice_number: string; kind: "invoice" | "credit_note"; credited_at: string | null };

/** A quote can have credited invoices and credit notes besides its live
 * invoice (issue #236); the contract's quote list shows the live one. */
function pickLiveInvoice(embed: InvoiceEmbed | InvoiceEmbed[] | null): { invoice_number: string } | null {
  const rows = Array.isArray(embed) ? embed : embed ? [embed] : [];
  return rows.find((r) => r.kind === "invoice" && r.credited_at === null) ?? null;
}

interface LedgerRow {
  contract_id: string;
  period_start: string;
  period_end: string;
  is_final: boolean;
}

/** One unit of work for a contract: the period quote (maybe) and the counter windows. */
interface ContractPlan {
  contract: ContractRow;
  lines: BalanceContractLine[];
  multiplier: number;
  /** Period quote to create, or null. */
  period: DateRange | null;
  /** with_invoice: windows settled on the period quote. */
  periodWindows: DateRange[];
  /** Calendar frequencies: due windows, each with its own counter settlement quote. */
  calendarWindows: DateRange[];
}

export async function generateContractQuotes(): Promise<ActionResult<GenerateContractQuotesResult>> {
  const quotesCtx = await requireModuleContext("quotes");
  if (!quotesCtx.ok) return fail(quotesCtx.error);
  const contractsCtx = await requireModuleContext("contracts");
  if (!contractsCtx.ok) return fail(contractsCtx.error);
  const actor = quotesCtx.context.actor;
  // Meters off: no counter settlement and no readings asked (#247).
  const metersOn = await hasFeature(quotesCtx.context.session.organization, "meters");

  if (!can(actor, "quotes", "create")) {
    return fail("Only an owner or planner can generate contract quotes.");
  }
  if (!canAny(actor, "contracts", ["read"])) {
    return fail("You do not have permission to view contracts.");
  }

  const supabase = await createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const result: GenerateContractQuotesResult = {
    created: 0,
    skipped: 0,
    settledWithoutQuote: 0,
    errors: [],
    warnings: [],
    pendingFinalBalance: [],
  };

  // Contracts awaiting their final balance: active with a passed end date, and
  // ended without a final settlement (final settlement quote or final ledger row).
  const { data: lapsedData, error: lapsedError } = await supabase
    .from("contracts")
    .select("id, contract_number, end_date, status")
    .eq("status", "active")
    .lt("end_date", today)
    .order("end_date", { ascending: true })
    .limit(MAX_CONTRACTS_PER_RUN);
  if (lapsedError) return fail(mapDbError(lapsedError));
  const { data: endedData, error: endedError } = await supabase
    .from("contracts")
    .select("id, contract_number, end_date, status")
    .eq("status", "ended")
    .order("end_date", { ascending: true })
    .limit(MAX_CONTRACTS_PER_RUN);
  if (endedError) return fail(mapDbError(endedError));
  type PendingRow = { id: string; contract_number: string; end_date: string | null; status: "active" | "ended" };
  const lapsed = (lapsedData ?? []) as PendingRow[];
  const endedRows = (endedData ?? []) as PendingRow[];
  const hasFinal = new Set<string>();
  for (const ids of chunk(endedRows.map((r) => r.id), IN_CHUNK)) {
    const [{ data: finalQuotes, error: fqError }, { data: finalLedger, error: flError }] = await Promise.all([
      supabase.from("quotes").select("contract_id").eq("is_final_settlement", true).in("contract_id", ids),
      supabase.from("contract_counter_settlements").select("contract_id").eq("is_final", true).in("contract_id", ids),
    ]);
    if (fqError ?? flError) return fail(mapDbError((fqError ?? flError) as { code?: string; message: string }));
    for (const r of finalQuotes ?? []) hasFinal.add(r.contract_id as string);
    for (const r of finalLedger ?? []) hasFinal.add(r.contract_id as string);
  }
  for (const row of [...lapsed, ...endedRows.filter((r) => !hasFinal.has(r.id))]) {
    result.pendingFinalBalance.push({
      contractId: row.id,
      contractNumber: row.contract_number,
      endDate: row.end_date,
      status: row.status,
    });
  }
  const lapsedIds = new Set(lapsed.map((r) => r.id));

  // Active contracts that may need a period quote or a counter settlement.
  const { data: contractData, error: contractsError } = await supabase
    .from("contracts")
    .select(CONTRACT_SELECT)
    .eq("status", "active")
    .or(`next_invoice_date.lte.${today},counter_settlement_frequency.neq.with_invoice`)
    .order("next_invoice_date", { ascending: true, nullsFirst: false })
    .limit(MAX_CONTRACTS_PER_RUN);
  if (contractsError) return fail(mapDbError(contractsError));
  const candidates = ((contractData ?? []) as unknown as ContractRow[]).filter((c) => !lapsedIds.has(c.id));
  if (candidates.length === 0) return ok(result);

  // Existing period quotes (skip set) and the settlement ledger.
  const candidateIds = candidates.map((c) => c.id);
  const existingPeriods = new Set<string>();
  const ledger = new Map<string, LedgerRow[]>();
  for (const ids of chunk(candidateIds, IN_CHUNK)) {
    const [{ data: quoteData, error: quoteError }, { data: ledgerData, error: ledgerError }] = await Promise.all([
      supabase
        .from("quotes")
        .select("contract_id, contract_period_start")
        .eq("quote_type", "contract")
        .eq("is_final_settlement", false)
        .eq("is_counter_settlement", false)
        .in("contract_id", ids),
      supabase
        .from("contract_counter_settlements")
        .select("contract_id, period_start, period_end, is_final")
        .in("contract_id", ids),
    ]);
    if (quoteError ?? ledgerError) return fail(mapDbError((quoteError ?? ledgerError) as { code?: string; message: string }));
    for (const q of quoteData ?? []) existingPeriods.add(`${q.contract_id as string}|${q.contract_period_start as string}`);
    for (const row of (ledgerData ?? []) as LedgerRow[]) {
      const list = ledger.get(row.contract_id) ?? [];
      list.push(row);
      ledger.set(row.contract_id, list);
    }
  }
  const lastSettledEndOf = (contractId: string): string | null =>
    (ledger.get(contractId) ?? []).reduce<string | null>((best, r) => (best === null || r.period_end > best ? r.period_end : best), null);

  // Plan per contract.
  const plans: ContractPlan[] = [];
  for (const contract of candidates) {
    const lines = toBalanceLines(contract, metersOn);
    const hasCounterLine = lines.some((l) => l.isVolume && l.volumeItemId);
    const intervalMonths = contract.billing_terms?.interval_months ?? null;
    const multiplier = billingMultiplier(intervalMonths, billingPeriodMonths(contract.billing_period));
    const frequency = contract.counter_settlement_frequency;
    if (metersOn && frequency !== "with_invoice" && !intervalMonths) {
      result.errors.push({
        contractId: contract.id,
        contractNumber: contract.contract_number,
        error: "Periodic counter settlement requires recurring billing terms.",
      });
      continue;
    }
    const lastEnd = lastSettledEndOf(contract.id);
    const from = lastEnd ? addDaysIso(lastEnd, 1) : contract.start_date;

    let period: DateRange | null = null;
    let periodWindows: DateRange[] = [];
    if (contract.next_invoice_date && contract.next_invoice_date <= today) {
      if (existingPeriods.has(`${contract.id}|${contract.next_invoice_date}`)) {
        result.skipped += 1;
      } else {
        const computed = computeContractPeriod(
          contract.next_invoice_date,
          contract.start_date,
          contract.invoiced_period_count,
          intervalMonths,
          contract.end_date,
        );
        if (isPeriodQuoteDue(contract.invoicing_timing, computed, today)) {
          period = computed;
          if (frequency === "with_invoice" && hasCounterLine) {
            const settled = planSettlementPeriod({
              timing: contract.invoicing_timing,
              invoicedPeriod: computed,
              contractStart: contract.start_date,
              contractEnd: contract.end_date,
              invoicedPeriodCount: contract.invoiced_period_count,
              intervalMonths,
            });
            if (settled && from <= settled.end) {
              periodWindows = settlementWindows({
                from,
                to: settled.end,
                frequency: "with_invoice",
                month: null,
                contractStart: contract.start_date,
                intervalMonths,
                contractEnd: contract.end_date,
              });
            }
          }
        }
      }
    }

    const calendarWindows =
      frequency !== "with_invoice" && hasCounterLine
        ? settlementWindows({
            from,
            frequency,
            month: contract.counter_settlement_month,
            contractStart: contract.start_date,
            intervalMonths,
            contractEnd: contract.end_date,
            dueOnly: true,
            today,
          })
        : [];

    if (period || calendarWindows.length > 0) {
      plans.push({ contract, lines, multiplier, period, periodWindows, calendarWindows });
    }
  }

  // Counter data, loaded once for every plan that settles a counter.
  const counterPlans = plans.filter((p) => p.periodWindows.length > 0 || p.calendarWindows.length > 0);
  let counterData: CounterData | null = null;
  let counterLoadError: string | null = null;
  if (counterPlans.length > 0) {
    const latestEnd = counterPlans
      .flatMap((p) => [...p.periodWindows, ...p.calendarWindows].map((w) => w.end))
      .reduce((a, b) => (a > b ? a : b));
    const loaded = await loadCounterData(
      supabase,
      counterPlans.map((p) => ({
        id: p.contract.id,
        startDate: p.contract.start_date,
        volumeItemIds: p.lines.filter((l) => l.isVolume && l.volumeItemId).map((l) => l.volumeItemId as string),
      })),
      latestEnd,
    );
    if ("error" in loaded) counterLoadError = loaded.error;
    else counterData = loaded.data;
  }

  for (const plan of plans) {
    const { contract } = plan;
    const needsCounters = plan.periodWindows.length > 0 || plan.calendarWindows.length > 0;
    if (needsCounters && !counterData) {
      result.errors.push({
        contractId: contract.id,
        contractNumber: contract.contract_number,
        error: `Counter usage could not be settled (${counterLoadError ?? "no data"}).`,
      });
      continue;
    }

    const assets: ContractAssetNote[] = contract.contract_assets
      .filter((link) => link.removed_on === null)
      .map((link) => link.asset)
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      .map((asset) => ({
        name: asset.name,
        serialNumber: asset.serial_number,
        externalReference: asset.external_reference,
        model: asset.asset_model?.name ?? null,
        siteName: formatSiteAddressShort(asset.site),
      }));

    const counterLines = plan.lines.filter((l) => l.isVolume && l.volumeItemId);
    const intervalMonths = contract.billing_terms?.interval_months ?? null;
    const usageFor = counterData ? makeUsageProvider({ contractId: contract.id, data: counterData }) : null;

    const evaluateWindows = (windows: DateRange[]) => {
      const warnings: string[] = [];
      const lines: QuoteLineDraft[] = [];
      const balances = windows.map((window) => {
        const evaluated = evaluateCounterWindow({
          window,
          lines: counterLines,
          multiplier: plan.multiplier,
          contractStart: contract.start_date,
          intervalMonths,
          usageFor: usageFor as NonNullable<typeof usageFor>,
        });
        warnings.push(...evaluated.warnings);
        for (const counter of evaluated.balance.counters) lines.push(...counter.lines);
        return evaluated.balance;
      });
      return { balances, lines, warnings };
    };

    const buildNotes = (headline: string[], warnings: string[]) =>
      [
        `Contract: ${contract.contract_number}${contract.external_reference ? ` — ${contract.external_reference}` : ""}`,
        contract.contract_type ? `Type: ${contract.contract_type.label}` : null,
        contract.billing_terms ? `Billing terms: ${contract.billing_terms.label}` : null,
        contract.billing_period ? `Billing period: ${contract.billing_period.label}` : null,
        contract.invoicing_timing === "in_arrears" ? "Invoicing: in arrears" : "Invoicing: in advance",
        ...headline,
        `Contract start: ${formatPeriodLabel(contract.start_date, null)}`,
        `Contract end: ${contract.end_date ? formatPeriodLabel(contract.end_date, null) : "open-ended"}`,
        "",
        describeContractAssets(assets),
        warnings.length > 0 ? `\nCounter settlement warnings:\n${warnings.map((w) => `- ${w}`).join("\n")}` : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n")
        .trim();

    const reportWarnings = (warnings: string[]) => {
      for (const message of warnings) {
        result.warnings.push({ contractId: contract.id, contractNumber: contract.contract_number, message });
      }
    };
    const reportError = (error: string) =>
      result.errors.push({ contractId: contract.id, contractNumber: contract.contract_number, error });

    // --- Period quote (with_invoice: also settles its windows) -----------------
    if (plan.period) {
      const period = plan.period;
      const periodLabel = formatPeriodLabel(period.start, period.end);
      const full = uncappedPeriodByIndex(contract.start_date, contract.invoiced_period_count, intervalMonths);
      const factor = intervalMonths ? proRataFactor(period, full) : 1;
      const periodLines = [...plan.lines]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((line) => buildPeriodLine(line, plan.multiplier, factor, periodLabel));

      const settled = plan.periodWindows.length > 0 ? evaluateWindows(plan.periodWindows) : null;
      const settlementStart = plan.periodWindows[0]?.start;
      const settlementEnd = plan.periodWindows[plan.periodWindows.length - 1]?.end;
      const settlementLabel =
        settlementStart && settlementEnd ? formatPeriodLabel(settlementStart, settlementEnd) : null;
      const warnings = settled?.warnings ?? [];

      const { data: quote, error: quoteError } = await supabase
        .from("quotes")
        .insert({
          client_id: contract.client_id,
          name: `${contract.contract_number} — ${periodLabel}`.slice(0, 200),
          notes: buildNotes(
            [
              `Period invoiced: ${periodLabel}`,
              ...(settlementLabel ? [`Counter usage settled: ${settlementLabel}`] : []),
              ...(factor < 1 ? [`Pro rata: ${Math.round(factor * 10000) / 100}% of the full period (by days)`] : []),
            ],
            warnings,
          ),
          quote_type: "contract",
          contract_id: contract.id,
          contract_period_start: period.start,
          contract_period_end: period.end,
          ...(settlementStart && settlementEnd
            ? { counter_settlement_start: settlementStart, counter_settlement_end: settlementEnd }
            : {}),
        })
        .select("id")
        .single<{ id: string }>();

      if (quoteError || !quote) {
        if (quoteError?.code === "23505") result.skipped += 1;
        else reportError(quoteError ? mapDbError(quoteError) : "Quote could not be created.");
      } else {
        const lineRows = [...periodLines, ...(settled?.lines ?? [])].map((line, index) => ({
          quote_id: quote.id,
          article_id: line.articleId,
          article_number: line.articleNumber,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          sort_order: index,
        }));
        let failed: string | null = null;
        if (lineRows.length > 0) {
          const { error: linesError } = await supabase.from("quote_line_items").insert(lineRows);
          if (linesError) failed = mapDbError(linesError);
        }
        if (!failed && settled) {
          const { error: ledgerError } = await supabase.from("contract_counter_settlements").insert(
            settled.balances.map((balance) => ({
              contract_id: contract.id,
              period_start: balance.window.start,
              period_end: balance.window.end,
              quote_id: quote.id,
              is_final: false,
              details: counterWindowDetails(balance),
            })),
          );
          if (ledgerError) failed = ledgerError.code === "23505" ? "Counter settlement was claimed in the meantime; run again." : mapDbError(ledgerError);
        }
        if (failed) {
          // Roll back the half-built quote (cascades its ledger rows) so the next run retries cleanly.
          await supabase.from("quotes").delete().eq("id", quote.id);
          reportError(failed);
        } else {
          reportWarnings(warnings);
          result.created += 1;
        }
      }
    }

    // --- Counter settlement quotes (monthly/quarterly/annually) -----------------
    for (const window of plan.calendarWindows) {
      const evaluated = evaluateWindows([window]);
      const balance = evaluated.balances[0];
      if (!balance) continue;
      const label = balance.label;
      const details = counterWindowDetails(balance);

      if (evaluated.lines.length === 0) {
        const { error: ledgerError } = await supabase.from("contract_counter_settlements").insert({
          contract_id: contract.id,
          period_start: window.start,
          period_end: window.end,
          quote_id: null,
          is_final: false,
          details,
        });
        if (ledgerError) {
          if (ledgerError.code === "23505") result.skipped += 1;
          else reportError(mapDbError(ledgerError));
          break;
        }
        reportWarnings(evaluated.warnings);
        result.settledWithoutQuote += 1;
        continue;
      }

      const { data: quote, error: quoteError } = await supabase
        .from("quotes")
        .insert({
          client_id: contract.client_id,
          name: `${contract.contract_number} — Counter settlement ${label}`.slice(0, 200),
          notes: buildNotes([`Counter settlement: ${label}`], evaluated.warnings),
          quote_type: "contract",
          contract_id: contract.id,
          contract_period_start: window.start,
          contract_period_end: window.end,
          counter_settlement_start: window.start,
          counter_settlement_end: window.end,
          is_counter_settlement: true,
        })
        .select("id")
        .single<{ id: string }>();
      if (quoteError || !quote) {
        reportError(quoteError ? mapDbError(quoteError) : "Quote could not be created.");
        break;
      }
      const { error: linesError } = await supabase.from("quote_line_items").insert(
        evaluated.lines.map((line, index) => ({
          quote_id: quote.id,
          article_id: line.articleId,
          article_number: line.articleNumber,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          sort_order: index,
        })),
      );
      let failed = linesError ? mapDbError(linesError) : null;
      if (!failed) {
        const { error: ledgerError } = await supabase.from("contract_counter_settlements").insert({
          contract_id: contract.id,
          period_start: window.start,
          period_end: window.end,
          quote_id: quote.id,
          is_final: false,
          details,
        });
        if (ledgerError) failed = ledgerError.code === "23505" ? null : mapDbError(ledgerError);
        if (ledgerError?.code === "23505") {
          await supabase.from("quotes").delete().eq("id", quote.id);
          result.skipped += 1;
          break;
        }
      }
      if (failed) {
        await supabase.from("quotes").delete().eq("id", quote.id);
        reportError(failed);
        break;
      }
      reportWarnings(evaluated.warnings);
      result.created += 1;
    }
  }

  return ok(result);
}

// ---------------------------------------------------------------------------
// Quotes of one contract (contract detail screen)
// ---------------------------------------------------------------------------

export interface ContractQuoteRecord {
  id: string;
  name: string;
  quote_type: "default" | "contract";
  status: { value: string; label: string; color: string | null } | null;
  contract_period_start: string | null;
  contract_period_end: string | null;
  /** Counter period whose overage this quote settles (issue #269), if any. */
  counter_settlement_start: string | null;
  counter_settlement_end: string | null;
  /** Final balance quote created when the contract ended (issue #271). */
  is_final_settlement: boolean;
  /** Periodic counter settlement quote (issue #271): not a billing period. */
  is_counter_settlement: boolean;
  total: number;
  created_at: string;
  /** Null while not invoiced, and for roles that cannot read invoices
   * (invoices are owner/administratie only). */
  invoice_number: string | null;
}

/** All quotes (any status) generated for / linked to `contractId`, newest
 * first. Org-scoped via RLS. */
export async function listQuotesForContract(
  contractId: string,
): Promise<ActionResult<{ quotes: ContractQuoteRecord[] }>> {
  const idResult = z.string().uuid("Invalid contract id.").safeParse(contractId);
  if (!idResult.success) return fail("Invalid contract id.");

  const ctx = await requireModuleContext("quotes");
  if (!ctx.ok) return fail(ctx.error);
  if (!canAny(ctx.context.actor, "quotes", ["read"])) {
    return fail("You do not have permission to view quotes.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("quotes")
    .select(
      "id, name, quote_type, contract_period_start, contract_period_end, created_at," +
        " counter_settlement_start, counter_settlement_end, is_final_settlement, is_counter_settlement," +
        " quote_status:reference_list_items!quotes_status_id_fkey(value,label,color)," +
        " quote_line_items(quantity,unit_price,discount_percent)," +
        " invoice:invoices(invoice_number,kind,credited_at)",
    )
    .eq("contract_id", idResult.data)
    .order("created_at", { ascending: false });
  if (error) return fail(mapDbError(error));

  type Row = {
    id: string;
    name: string;
    quote_type: "default" | "contract";
    contract_period_start: string | null;
    contract_period_end: string | null;
    counter_settlement_start: string | null;
    counter_settlement_end: string | null;
    is_final_settlement: boolean;
    is_counter_settlement: boolean;
    created_at: string;
    quote_status: { value: string; label: string; color: string | null } | null;
    quote_line_items: { quantity: number | string; unit_price: number | string; discount_percent: number | string }[];
    invoice: InvoiceEmbed | InvoiceEmbed[] | null;
  };

  const quotes = ((data ?? []) as unknown as Row[]).map((row): ContractQuoteRecord => {
    const sum = row.quote_line_items.reduce(
      (acc, item) => acc + Number(item.quantity) * Number(item.unit_price) * (1 - Number(item.discount_percent) / 100),
      0,
    );
    const invoice = pickLiveInvoice(row.invoice);
    return {
      id: row.id,
      name: row.name,
      quote_type: row.quote_type,
      status: row.quote_status,
      contract_period_start: row.contract_period_start,
      contract_period_end: row.contract_period_end,
      counter_settlement_start: row.counter_settlement_start,
      counter_settlement_end: row.counter_settlement_end,
      is_final_settlement: row.is_final_settlement,
      is_counter_settlement: row.is_counter_settlement,
      total: Math.round(sum * 100) / 100,
      created_at: row.created_at,
      invoice_number: invoice?.invoice_number ?? null,
    };
  });

  return ok({ quotes });
}
