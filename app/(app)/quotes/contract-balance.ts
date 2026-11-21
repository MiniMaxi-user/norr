/**
 * Pure helpers for the contract final balance, pro rata billing and counter
 * settlement windows (issue #271). Not a "use server" file and no server-only
 * imports, so everything here is unit-testable. Dates are ISO `YYYY-MM-DD`
 * strings handled in UTC. Pro rata is always by calendar days (inclusive).
 *
 * Concepts (see .claude/specs/271-contract-final-balance.md):
 *  - invoice period: contract period anchored on the contract start, capped at
 *    the contract end date. "Full" period = the same period without the cap.
 *  - settlement window: the date range a counter settlement covers.
 */

import {
  addDaysIso,
  formatPeriodLabel,
  scaleContractLine,
} from "./contract-quote-helpers";
import {
  computeOverage,
  contractPeriodByIndex,
  describeOverage,
  type InvoicingTiming,
} from "./counter-settlement";

export type SettlementFrequency = "with_invoice" | "monthly" | "quarterly" | "annually";

export interface DateRange {
  start: string;
  end: string;
}

const MAX_ITERATIONS = 2000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y as number, m: m as number, d: d as number };
}

function maxIso(a: string, b: string): string {
  return a > b ? a : b;
}

function minIso(a: string, b: string): string {
  return a < b ? a : b;
}

/* ------------------------------------------------------------------ */
/* Day counting and pro rata                                           */
/* ------------------------------------------------------------------ */

/** Number of calendar days from `start` to `end`, both inclusive (0 when end < start). */
export function daysInclusive(start: string, end: string): number {
  const a = parseIso(start);
  const b = parseIso(end);
  const diff = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000) + 1;
  return diff > 0 ? diff : 0;
}

/** Pro rata factor of a (capped) part of a full period: days(part) / days(full), at most 1.
 * A full period gives exactly 1. */
export function proRataFactor(part: DateRange, full: DateRange): number {
  const fullDays = daysInclusive(full.start, full.end);
  if (fullDays === 0) return 1;
  return Math.min(1, daysInclusive(part.start, part.end) / fullDays);
}

/** Invoice period `index` WITHOUT the contract end cap. Non-recurring terms (no
 * interval): a single one-day placeholder (start = end = contract start); callers
 * treat non-recurring contracts as factor 1. */
export function uncappedPeriodByIndex(contractStart: string, index: number, intervalMonths: number | null): DateRange {
  return contractPeriodByIndex(contractStart, index, intervalMonths, null);
}

/** Capped invoice period `index` (cap = `contractEnd`) with its full period and the
 * pro rata factor (1 for full periods and non-recurring terms). */
export function invoicePeriodWithFactor(
  contractStart: string,
  index: number,
  intervalMonths: number | null,
  contractEnd: string | null,
): { period: DateRange; full: DateRange; factor: number } {
  const period = contractPeriodByIndex(contractStart, index, intervalMonths, contractEnd);
  const full = uncappedPeriodByIndex(contractStart, index, intervalMonths);
  return { period, full, factor: intervalMonths ? proRataFactor(period, full) : 1 };
}

/**
 * Included counter quantity for any window: sum over the (full) invoice periods
 * overlapping the window of `lineQuantity * multiplier * overlapDays / fullPeriodDays`.
 * Non-recurring terms (no interval): `lineQuantity * multiplier`. For a window equal
 * to a full invoice period this is exactly `lineQuantity * multiplier`.
 * Rounded to 3 decimals like the existing included quantity.
 */
export function includedForWindow(
  lineQuantity: number,
  multiplier: number,
  contractStart: string,
  intervalMonths: number | null,
  window: DateRange,
): number {
  if (!intervalMonths) return round3(lineQuantity * multiplier);
  const winStart = maxIso(window.start, contractStart);
  if (window.end < winStart) return 0;
  const a = parseIso(contractStart);
  const b = parseIso(winStart);
  const monthsApart = (b.y - a.y) * 12 + (b.m - a.m);
  let index = Math.max(0, Math.floor(monthsApart / intervalMonths) - 1);
  let total = 0;
  for (let i = 0; i < MAX_ITERATIONS; i += 1, index += 1) {
    const full = uncappedPeriodByIndex(contractStart, index, intervalMonths);
    if (full.start > window.end) break;
    const start = maxIso(full.start, winStart);
    const end = minIso(full.end, window.end);
    if (end < start) continue;
    total += (lineQuantity * multiplier * daysInclusive(start, end)) / daysInclusive(full.start, full.end);
  }
  return round3(total);
}

/* ------------------------------------------------------------------ */
/* Settlement dates and windows                                        */
/* ------------------------------------------------------------------ */

/**
 * The first settlement date STRICTLY AFTER `afterDate` for a calendar frequency
 * (always the 1st of a month): monthly = every month, quarterly = months congruent to
 * `month` mod 3, annually = `month`. `month` is 1..12 (defaults to 1 when missing).
 * `with_invoice` has no calendar settlement dates: returns null.
 */
export function nextSettlementDate(
  afterDate: string,
  frequency: SettlementFrequency,
  month: number | null,
): string | null {
  if (frequency === "with_invoice") return null;
  const settlementMonth = month ?? 1;
  const { y, m } = parseIso(afterDate);
  for (let step = 1; step <= 25; step += 1) {
    const candidate = new Date(Date.UTC(y, m - 1 + step, 1));
    const candidateMonth = candidate.getUTCMonth() + 1; // 1..12
    const matches =
      frequency === "monthly" ||
      (frequency === "quarterly" && (candidateMonth - settlementMonth) % 3 === 0) ||
      (frequency === "annually" && candidateMonth === settlementMonth);
    if (matches) return candidate.toISOString().slice(0, 10);
  }
  return null;
}

export interface SettlementWindowsInput {
  /** First day not yet settled (last settled end + 1, or the contract start). */
  from: string;
  /** Upper clip: no window extends past it (the final balance passes the end date E). */
  to?: string | null;
  frequency: SettlementFrequency;
  month: number | null;
  contractStart: string;
  /** Billing TERMS interval in months; null = non-recurring. */
  intervalMonths: number | null;
  contractEnd: string | null;
  /** Only windows that are complete AND ended before `today` (generate-quotes mode).
   * A window cut short by `to` is then dropped; a window ended by the contract end
   * date counts as complete. Requires `today`. Without it, the last window may be a
   * partial one clipped to `to` (final balance mode). */
  dueOnly?: boolean;
  today?: string;
  /** Stop when a window would start after this date (no clipping; for open-ended UI use). */
  maxWindowStart?: string;
}

/**
 * Settlement windows from `from`:
 *  - with_invoice: the invoice periods (capped at the contract end), the first one
 *    starting at max(period start, from).
 *  - calendar frequencies: a window starts at `from`/the day after the previous window
 *    and ends the day before the next settlement date.
 * All windows are clipped to `to` and the contract end date (see `dueOnly`).
 */
export function settlementWindows(input: SettlementWindowsInput): DateRange[] {
  const { from, frequency, month, contractStart, intervalMonths, contractEnd, dueOnly, today, maxWindowStart } = input;
  let clip = input.to ?? contractEnd ?? null;
  if (input.to && contractEnd) clip = minIso(input.to, contractEnd);
  if (dueOnly) {
    if (!today) throw new Error("settlementWindows: dueOnly requires today");
    const yesterday = addDaysIso(today, -1);
    clip = clip ? minIso(clip, yesterday) : yesterday;
  }

  const windows: DateRange[] = [];
  const consider = (naturalStart: string, naturalEndUncapped: string): "continue" | "stop" => {
    const start = maxIso(naturalStart, from);
    if (maxWindowStart && start > maxWindowStart) return "stop";
    if (clip && start > clip) return "stop";
    const naturalEnd = contractEnd ? minIso(naturalEndUncapped, contractEnd) : naturalEndUncapped;
    if (naturalEnd < start) return "continue";
    if (!clip || naturalEnd <= clip) {
      windows.push({ start, end: naturalEnd });
    } else if (!dueOnly) {
      windows.push({ start, end: clip });
    } else {
      return "stop";
    }
    return "continue";
  };

  if (frequency === "with_invoice") {
    for (let index = 0; index < MAX_ITERATIONS; index += 1) {
      const period = contractPeriodByIndex(contractStart, index, intervalMonths, contractEnd);
      if (consider(period.start, period.end) === "stop") break;
      if (!intervalMonths) break; // non-recurring: a single period
    }
    return windows;
  }

  let start = maxIso(from, contractStart);
  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const boundary = nextSettlementDate(start, frequency, month);
    if (!boundary) break;
    const end = addDaysIso(boundary, -1);
    if (consider(start, end) === "stop") break;
    start = addDaysIso(boundary, 0);
  }
  return windows;
}

/* ------------------------------------------------------------------ */
/* Line builders                                                       */
/* ------------------------------------------------------------------ */

/** The parts of a contract line (contract_line_items) the balance needs. */
export interface BalanceContractLine {
  id: string;
  articleId: string | null;
  articleNumber: string | null;
  /** Line description or article description. */
  description: string;
  quantity: number;
  unitPrice: number;
  sortOrder: number;
  isVolume: boolean;
  volumeItemId: string | null;
  /** Counter label (volume item label). */
  counterLabel: string;
  overageUnitPrice: number | null;
  creditUnderUse: boolean;
}

export type QuoteLineKind = "period" | "credit" | "overage" | "under_use";

export interface QuoteLineDraft {
  kind: QuoteLineKind;
  articleId: string | null;
  articleNumber: string | null;
  description: string;
  /** Negative for credit and under-use credit lines. */
  quantity: number;
  unitPrice: number;
  sortOrder: number;
}

type LineWithoutOrder = Omit<QuoteLineDraft, "sortOrder">;

/** Line amount at 2 decimals (negative for credit lines). */
export function lineAmount(line: { quantity: number; unitPrice: number }): number {
  return round2(line.quantity * line.unitPrice);
}

/** A contract line for an invoice period: price scaled by `multiplier * factor`
 * (factor = pro rata factor of a shortened period, 1 for a full one). The description
 * gets the period label appended like the regular period quotes. */
export function buildPeriodLine(
  line: BalanceContractLine,
  multiplier: number,
  factor: number,
  periodLabel: string,
): LineWithoutOrder {
  const scaled = scaleContractLine(line.quantity, line.unitPrice, multiplier * factor);
  return {
    kind: "period",
    articleId: line.articleId,
    articleNumber: line.articleNumber,
    description: `${line.description} (${periodLabel})`.slice(0, 2000),
    quantity: scaled.quantity,
    unitPrice: scaled.unitPrice,
  };
}

/** Credit for the prepaid part of an invoiced period after the end date: same scaling
 * as {@link buildPeriodLine}, negative quantity, description `Credit <line> (<range>)`. */
export function buildPrepaidCreditLine(
  line: BalanceContractLine,
  multiplier: number,
  factor: number,
  rangeLabel: string,
): LineWithoutOrder {
  const scaled = scaleContractLine(line.quantity, line.unitPrice, multiplier * factor);
  return {
    kind: "credit",
    articleId: line.articleId,
    articleNumber: line.articleNumber,
    description: `Credit ${line.description} (${rangeLabel})`.slice(0, 2000),
    quantity: -scaled.quantity,
    unitPrice: scaled.unitPrice,
  };
}

/** Included quantity not used (2 decimals), or 0. */
export function computeUnderUse(usage: number, included: number): number {
  const under = round2(included - usage);
  return under > 0 ? under : 0;
}

/** "<counter> – under-use credit: usage x, included y, under-use z (<window>)". */
export function describeUnderUse(
  counterLabel: string,
  usage: number,
  included: number,
  underUse: number,
  windowLabel: string,
): string {
  return `${counterLabel} – under-use credit: usage ${usage}, included ${included}, under-use ${underUse} (${windowLabel})`;
}

/** Overage line at `overageUnitPrice`; null when there is no overage or the line has no
 * overage price (the caller adds a warning in the latter case). */
export function buildOverageLine(
  line: BalanceContractLine,
  usage: number,
  included: number,
  windowLabel: string,
): LineWithoutOrder | null {
  const overage = computeOverage(usage, included);
  if (overage <= 0 || line.overageUnitPrice === null) return null;
  return {
    kind: "overage",
    articleId: line.articleId,
    articleNumber: line.articleNumber,
    description: describeOverage(line.counterLabel, usage, included, overage, windowLabel).slice(0, 2000),
    quantity: overage,
    unitPrice: line.overageUnitPrice,
  };
}

/** Under-use credit line at the line's own unit price, quantity -(included - usage);
 * null unless `creditUnderUse` is on and usage is below the included quantity. */
export function buildUnderUseCreditLine(
  line: BalanceContractLine,
  usage: number,
  included: number,
  windowLabel: string,
): LineWithoutOrder | null {
  if (!line.creditUnderUse) return null;
  const underUse = computeUnderUse(usage, included);
  if (underUse <= 0) return null;
  return {
    kind: "under_use",
    articleId: line.articleId,
    articleNumber: line.articleNumber,
    description: describeUnderUse(line.counterLabel, usage, included, underUse, windowLabel).slice(0, 2000),
    quantity: -underUse,
    unitPrice: line.unitPrice,
  };
}

/* ------------------------------------------------------------------ */
/* Final balance                                                       */
/* ------------------------------------------------------------------ */

export interface BalanceContract {
  startDate: string;
  /** The end date E being applied (<= today for a complete balance). */
  endDate: string;
  timing: InvoicingTiming;
  /** Billing TERMS interval in months; null = non-recurring. */
  intervalMonths: number | null;
  /** terms months / period months (see billingMultiplier). */
  multiplier: number;
  frequency: SettlementFrequency;
  settlementMonth: number | null;
  invoicedPeriodCount: number;
}

/** An existing period quote of the contract (not final, not a counter settlement quote). */
export interface ExistingPeriodQuote {
  id: string;
  periodStart: string;
  periodEnd: string;
  /** Has an invoice (any status): such a quote is never replaced. */
  invoiced: boolean;
  quoteNumber?: string | null;
  invoiceNumber?: string | null;
  /** Quote total when known (display only). */
  amount?: number | null;
}

export interface WindowUsage {
  usage: number;
  issues: string[];
  reviewReadingsInPeriod: number;
  /** Covered assets of this counter excluded from the window (settled without a reading).
   * Together with `issues` this marks the usage as incomplete: no under-use credit then. */
  skippedAssets?: number;
}

/** Usage of the counter of `line` over `window` (the server action wires this to
 * computeCounterUsage with the readings and closing readings; skipped assets excluded). */
export type UsageProvider = (window: DateRange, line: BalanceContractLine) => WindowUsage;

export interface FinalBalanceInput {
  contract: BalanceContract;
  lines: readonly BalanceContractLine[];
  /** Existing contract period quotes (final / counter settlement quotes excluded). */
  periodQuotes: readonly ExistingPeriodQuote[];
  /** End of the last settled window in the ledger, null when nothing is settled yet. */
  lastSettledEnd: string | null;
  usageFor: UsageProvider;
}

export type BalancePeriodStatus = "invoiced" | "quoted" | "open";

export interface BalancePeriod {
  index: number;
  /** The period as charged: capped at E for open periods, as invoiced otherwise. */
  period: DateRange;
  full: DateRange;
  status: BalancePeriodStatus;
  /** Pro rata factor of the charged part (1 for full periods). */
  factor: number;
  proRata: boolean;
  /** Existing quote for the period (invoiced or quoted). */
  quoteId: string | null;
  quoteNumber: string | null;
  invoiceNumber: string | null;
  /** invoiced: invoiced amount when known; quoted/open: the amount charged by the final quote. */
  amount: number | null;
}

export interface CounterBalance {
  lineId: string;
  counterLabel: string;
  volumeItemId: string | null;
  included: number;
  usage: number;
  overage: number;
  underUse: number;
  creditUnderUse: boolean;
  overageAmount: number;
  /** Under-use credit amount as a positive number (0 when not credited). */
  underUseCreditAmount: number;
  /** Usage issues, review notices and a missing overage price for this counter. */
  warnings: string[];
  lines: QuoteLineDraft[];
}

export interface CounterWindowBalance {
  window: DateRange;
  label: string;
  counters: CounterBalance[];
}

export interface FinalBalancePlan {
  periods: BalancePeriod[];
  /** Un-invoiced period quotes to delete (open periods and periods after the end date). */
  quotesToReplace: string[];
  openLines: QuoteLineDraft[];
  creditLines: QuoteLineDraft[];
  counterWindows: CounterWindowBalance[];
  /** All lines for the final quote in order: open, credit, counter; sortOrder assigned. */
  quoteLines: QuoteLineDraft[];
  /** Range covered by the counter windows, null when there are none. */
  counterRange: DateRange | null;
  warnings: string[];
  totals: { toInvoice: number; toCredit: number; net: number };
}

export interface EvaluateCounterWindowInput {
  window: DateRange;
  /** Volume lines with a counter. */
  lines: readonly BalanceContractLine[];
  multiplier: number;
  contractStart: string;
  intervalMonths: number | null;
  usageFor: UsageProvider;
}

/** Evaluates one settlement window for every counter line: included (pro rata),
 * usage, overage line and (when enabled) under-use credit line. Lines have sortOrder 0
 * (callers re-number). Shared by the final balance and "Generate contract quotes". */
export function evaluateCounterWindow(input: EvaluateCounterWindowInput): {
  balance: CounterWindowBalance;
  warnings: string[];
} {
  const { window, lines, multiplier, contractStart, intervalMonths, usageFor } = input;
  const label = formatPeriodLabel(window.start, window.end);
  const warnings: string[] = [];
  const counters: CounterBalance[] = [];
  for (const line of lines) {
    const own: string[] = [];
    const used = usageFor(window, line);
    for (const issue of used.issues) own.push(`${line.counterLabel}: ${issue}`);
    if (used.reviewReadingsInPeriod > 0) {
      own.push(`${line.counterLabel}: ${used.reviewReadingsInPeriod} reading(s) in ${label} need review and were ignored.`);
    }
    const included = includedForWindow(line.quantity, multiplier, contractStart, intervalMonths, window);
    const overageQuantity = computeOverage(used.usage, included);
    const overageLine = buildOverageLine(line, used.usage, included, label);
    if (overageQuantity > 0 && !overageLine) {
      own.push(
        `${line.counterLabel}: usage exceeds the included quantity but the line has no overage price; no overage line added.`,
      );
    }
    // Incomplete data (missing/declining readings, skipped assets): usage is understated, so
    // crediting under-use would over-credit. Overage behaviour is unchanged.
    const incomplete = used.issues.length > 0 || (used.skippedAssets ?? 0) > 0;
    let underUseLine = incomplete ? null : buildUnderUseCreditLine(line, used.usage, included, label);
    if (incomplete && line.creditUnderUse && computeUnderUse(used.usage, included) > 0) {
      own.push(`${line.counterLabel}: under-use not credited because readings are incomplete`);
      underUseLine = null;
    }
    const drafts = [overageLine, underUseLine].filter((l): l is LineWithoutOrder => l !== null);
    warnings.push(...own);
    counters.push({
      lineId: line.id,
      counterLabel: line.counterLabel,
      volumeItemId: line.volumeItemId,
      included,
      usage: used.usage,
      overage: overageQuantity,
      underUse: computeUnderUse(used.usage, included),
      creditUnderUse: line.creditUnderUse,
      overageAmount: overageLine ? lineAmount(overageLine) : 0,
      underUseCreditAmount: underUseLine ? Math.abs(lineAmount(underUseLine)) : 0,
      warnings: own,
      lines: withOrder(drafts, 0),
    });
  }
  return { balance: { window, label, counters }, warnings };
}

/** Ledger `details` JSON for a window: one entry per counter. `creditedUnderUse` is the
 * under-use quantity that was credited (0 when crediting is off or there was none). */
export function counterWindowDetails(balance: CounterWindowBalance): {
  volumeItemId: string | null;
  counterLabel: string;
  included: number;
  usage: number;
  overage: number;
  underUse: number;
  creditedUnderUse: number;
  warnings: string[];
}[] {
  return balance.counters.map((c) => ({
    volumeItemId: c.volumeItemId,
    counterLabel: c.counterLabel,
    included: c.included,
    usage: c.usage,
    overage: c.overage,
    underUse: c.underUse,
    creditedUnderUse: c.underUseCreditAmount > 0 ? c.underUse : 0,
    warnings: c.warnings,
  }));
}

function withOrder(lines: LineWithoutOrder[], startAt: number): QuoteLineDraft[] {
  return lines.map((line, i) => ({ ...line, sortOrder: startAt + i }));
}

/**
 * Pure final balance for ending a contract on `contract.endDate` (E):
 *  1. Every period with index >= invoicedPeriodCount and start <= E is charged pro rata
 *     up to E (capped period vs its full period). Their un-invoiced quotes are replaced.
 *  2. In advance: every invoiced period whose end lies after E is credited for the part
 *     max(E+1, period start) .. min(full end, invoiced end), pro rata, for every line.
 *     (The invoiced end is taken from the existing quote when known so that a period that
 *     was itself shortened is not over-credited.)
 *  3. Every unsettled settlement window from lastSettledEnd+1 up to E (per frequency, the
 *     last one possibly partial) is settled per counter line: overage and, when enabled,
 *     under-use credit. Included quantity is pro rata via {@link includedForWindow}.
 * Totals: toInvoice = positive line amounts, toCredit = absolute negative line amounts.
 */
export function planFinalBalance(input: FinalBalanceInput): FinalBalancePlan {
  const { contract, lines, periodQuotes, lastSettledEnd, usageFor } = input;
  const E = contract.endDate;
  const recurring = Boolean(contract.intervalMonths);
  const sortedLines = [...lines].sort((a, b) => a.sortOrder - b.sortOrder);
  const warnings: string[] = [];
  const quotesToReplace: string[] = [];
  const periods: BalancePeriod[] = [];
  const periodLines: LineWithoutOrder[] = [];
  const creditLines: LineWithoutOrder[] = [];

  const quoteByStart = new Map(periodQuotes.map((q) => [q.periodStart, q]));
  const priceOf = (drafts: LineWithoutOrder[]) => round2(drafts.reduce((sum, l) => sum + lineAmount(l), 0));

  // --- Periods -----------------------------------------------------------
  const count = contract.invoicedPeriodCount;
  const lastIndex = recurring ? Number.MAX_SAFE_INTEGER : 0;
  for (let index = 0; index <= lastIndex && index < MAX_ITERATIONS; index += 1) {
    const invoiced = index < count;
    const full = uncappedPeriodByIndex(contract.startDate, index, contract.intervalMonths);
    const start = recurring ? full.start : contract.startDate;
    if (!invoiced && start > E) break;
    const quote = quoteByStart.get(start) ?? null;

    if (invoiced) {
      const chargedEnd = quote ? quote.periodEnd : contractPeriodByIndex(contract.startDate, index, contract.intervalMonths, null).end;
      const charged: DateRange = { start, end: chargedEnd };
      const factor = recurring ? proRataFactor(charged, full) : 1;
      periods.push({
        index,
        period: charged,
        full,
        status: "invoiced",
        factor,
        proRata: factor < 1,
        quoteId: quote?.id ?? null,
        quoteNumber: quote?.quoteNumber ?? null,
        invoiceNumber: quote?.invoiceNumber ?? null,
        amount: quote?.amount ?? null,
      });

      if (contract.timing === "in_advance" && recurring && chargedEnd > E) {
        const from = maxIso(addDaysIso(E, 1), start);
        const creditRange = { start: from, end: minIso(full.end, chargedEnd) };
        if (creditRange.end >= creditRange.start) {
          const factorCredit = proRataFactor(creditRange, full);
          const label = formatPeriodLabel(creditRange.start, creditRange.end);
          for (const line of sortedLines) {
            creditLines.push(buildPrepaidCreditLine(line, contract.multiplier, factorCredit, label));
          }
        }
      } else if (contract.timing === "in_arrears" && start > E) {
        warnings.push(
          `Period ${formatPeriodLabel(start, chargedEnd)} was invoiced in arrears but lies after the end date; it is not credited automatically.`,
        );
      }
      continue;
    }

    // Open (or quoted but not yet invoiced) period up to E.
    const capped = contractPeriodByIndex(contract.startDate, index, contract.intervalMonths, E);
    const factor = recurring ? proRataFactor(capped, full) : 1;
    const label = formatPeriodLabel(capped.start, capped.end);
    const drafts = sortedLines.map((line) => buildPeriodLine(line, contract.multiplier, factor, label));
    periodLines.push(...drafts);
    if (quote && !quote.invoiced) quotesToReplace.push(quote.id);
    periods.push({
      index,
      period: capped,
      full,
      status: quote ? "quoted" : "open",
      factor,
      proRata: factor < 1,
      quoteId: quote?.id ?? null,
      quoteNumber: quote?.quoteNumber ?? null,
      invoiceNumber: null,
      amount: priceOf(drafts),
    });
  }

  // Un-invoiced quotes for periods that start after E are replaced too (nothing to bill there).
  for (const quote of periodQuotes) {
    if (!quote.invoiced && quote.periodStart > E && !quotesToReplace.includes(quote.id)) {
      quotesToReplace.push(quote.id);
    }
  }

  // --- Counter windows -----------------------------------------------------
  const counterLines = sortedLines.filter((line) => line.isVolume && line.volumeItemId);
  const counterWindows: CounterWindowBalance[] = [];
  const counterDrafts: LineWithoutOrder[] = [];
  if (counterLines.length > 0) {
    const from = lastSettledEnd ? addDaysIso(lastSettledEnd, 1) : contract.startDate;
    const windows = settlementWindows({
      from,
      to: E,
      frequency: contract.frequency,
      month: contract.settlementMonth,
      contractStart: contract.startDate,
      intervalMonths: contract.intervalMonths,
      contractEnd: E,
    });
    for (const window of windows) {
      const evaluated = evaluateCounterWindow({
        window,
        lines: counterLines,
        multiplier: contract.multiplier,
        contractStart: contract.startDate,
        intervalMonths: contract.intervalMonths,
        usageFor,
      });
      warnings.push(...evaluated.warnings);
      for (const counter of evaluated.balance.counters) counterDrafts.push(...counter.lines);
      counterWindows.push(evaluated.balance);
    }
  }

  const ordered = [...periodLines, ...creditLines, ...counterDrafts];
  const quoteLines = withOrder(ordered, 0);
  const openLines = quoteLines.filter((l) => l.kind === "period");
  const credits = quoteLines.filter((l) => l.kind === "credit");
  const amounts = quoteLines.map(lineAmount);
  const toInvoice = round2(amounts.filter((a) => a > 0).reduce((s, a) => s + a, 0));
  const toCredit = round2(amounts.filter((a) => a < 0).reduce((s, a) => s - a, 0));
  const first = counterWindows[0];
  const last = counterWindows[counterWindows.length - 1];

  return {
    periods,
    quotesToReplace,
    openLines,
    creditLines: credits,
    counterWindows,
    quoteLines,
    counterRange: first && last ? { start: first.window.start, end: last.window.end } : null,
    warnings,
    totals: { toInvoice, toCredit, net: round2(toInvoice - toCredit) },
  };
}

/* ------------------------------------------------------------------ */
/* UI schedule                                                         */
/* ------------------------------------------------------------------ */

export interface SettlementScheduleInput {
  startDate: string;
  endDate: string | null;
  timing: InvoicingTiming;
  intervalMonths: number | null;
  frequency: SettlementFrequency;
  settlementMonth: number | null;
  invoicedPeriodCount: number;
  lastSettledEnd: string | null;
  today: string;
}

export interface SettlementSchedule {
  /** Date the next period quote can be generated: in advance = the next period start,
   * in arrears = the day after the next period ends. Null when nothing further is invoiced. */
  nextInvoiceDate: string | null;
  /** Date the next counter settlement can be generated: calendar frequencies = the day
   * after the open window ends; with_invoice = the next invoice date that settles
   * (in advance: the first quote settles nothing, so the second period start). Null when none. */
  nextSettlementDate: string | null;
  /** The settlement window that contains today (or the first open one when today lies
   * before it). Null when the contract has no further windows. */
  currentWindow: DateRange | null;
}

export function describeSettlementSchedule(input: SettlementScheduleInput): SettlementSchedule {
  const { startDate, endDate, timing, intervalMonths, frequency, settlementMonth, invoicedPeriodCount, lastSettledEnd, today } = input;

  const invoiceDateFor = (index: number): string | null => {
    if (!intervalMonths && index > 0) return null;
    const period = contractPeriodByIndex(startDate, index, intervalMonths, endDate);
    if (endDate && period.start > endDate) return null;
    return timing === "in_arrears" ? addDaysIso(period.end, 1) : period.start;
  };
  const nextInvoiceDate = invoiceDateFor(invoicedPeriodCount);

  const from = lastSettledEnd ? addDaysIso(lastSettledEnd, 1) : startDate;
  const windows = settlementWindows({
    from,
    frequency,
    month: settlementMonth,
    contractStart: startDate,
    intervalMonths,
    contractEnd: endDate,
    maxWindowStart: maxIso(today, from),
  });
  const currentWindow = windows.find((w) => w.end >= today) ?? null;

  let nextSettlementDate: string | null;
  if (frequency === "with_invoice") {
    nextSettlementDate = timing === "in_arrears" ? nextInvoiceDate : invoiceDateFor(Math.max(invoicedPeriodCount, 1));
  } else {
    nextSettlementDate = currentWindow ? addDaysIso(currentWindow.end, 1) : null;
  }

  return { nextInvoiceDate, nextSettlementDate, currentWindow };
}
