/**
 * Pure counter (volume) settlement for contract quotes (issue #239). Not a
 * "use server" file and no server-only imports, so it is unit-testable.
 *
 * Usage of one counter over an invoicing period, per covered asset:
 *   latest reading at or before the END of the period end date
 *   - latest reading at or before the START (00:00 UTC) of the period start date.
 * The start boundary is the very start of the start day so that it matches the
 * previous period's end reading (which includes its whole last day).
 * Readings flagged `needsReview` are ignored.
 *
 * Optional per-asset baseline date (issue #269): the asset is covered only from
 * that date (contract start, or the date it was added to the contract). Its
 * start boundary is then max(start of the period start day, END of the
 * baseline day), so a reading on the baseline date itself counts as baseline.
 * An asset whose baseline lies after the period end is not part of the period.
 */

import { addMonthsIso, computeContractPeriod } from "./contract-quote-helpers";

export interface CounterReading {
  assetId: string;
  /** ISO timestamp (timestamptz). */
  readAt: string;
  value: number;
  needsReview: boolean;
}

export interface CounterAsset {
  id: string;
  name: string;
}

export interface CounterUsageResult {
  /** Sum of the usage of all assets that could be settled. */
  usage: number;
  /** Per skipped/rejected asset: why it did not count. */
  issues: string[];
  /** Number of readings flagged needs_review inside the period (ignored). */
  reviewReadingsInPeriod: number;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function startOfDayMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00.000Z`);
}

function endOfDayMs(iso: string): number {
  return Date.parse(`${iso}T23:59:59.999Z`);
}

/**
 * One coverage window of an asset on a contract (issue #274): covered from `start`
 * (baseline: the END of that day is the start boundary) up to and including `end`
 * (the removal date: the closing reading on that day counts); `end` null = still open.
 * An asset can have several windows (removed, then added again).
 */
export interface CoverageWindowInput {
  assetId: string;
  start: string | null;
  end: string | null;
}

export function computeCounterUsage(
  assets: readonly CounterAsset[],
  readings: readonly CounterReading[],
  periodStart: string,
  periodEnd: string,
  baselineDates?: ReadonlyMap<string, string | null>,
): CounterUsageResult {
  const windows: CoverageWindowInput[] = [];
  const seen = new Set<string>();
  for (const asset of assets) {
    if (seen.has(asset.id)) continue; // an asset covered twice counts once
    seen.add(asset.id);
    windows.push({ assetId: asset.id, start: baselineDates?.get(asset.id) ?? null, end: null });
  }
  return computeWindowedCounterUsage(assets, windows, readings, periodStart, periodEnd);
}

/**
 * Windowed variant (issue #274): every coverage window counts separately, from
 * max(start of the period start day, END of the window start day) to
 * min(END of the period end day, END of the window end day). Nothing after a window's
 * end counts; a window entirely outside the period is not part of it.
 */
export function computeWindowedCounterUsage(
  assets: readonly CounterAsset[],
  windows: readonly CoverageWindowInput[],
  readings: readonly CounterReading[],
  periodStart: string,
  periodEnd: string,
): CounterUsageResult {
  const periodStartMs = startOfDayMs(periodStart);
  const periodEndMs = endOfDayMs(periodEnd);
  const nameById = new Map(assets.map((a) => [a.id, a.name]));

  const byAsset = new Map<string, { at: number; value: number; needsReview: boolean }[]>();
  for (const reading of readings) {
    const list = byAsset.get(reading.assetId) ?? [];
    list.push({ at: Date.parse(reading.readAt), value: reading.value, needsReview: reading.needsReview });
    byAsset.set(reading.assetId, list);
  }

  let usage = 0;
  let reviewReadingsInPeriod = 0;
  const issues: string[] = [];
  const seenWindows = new Set<string>();

  for (const window of windows) {
    const windowKey = `${window.assetId}|${window.start ?? ""}|${window.end ?? ""}`;
    if (seenWindows.has(windowKey)) continue;
    seenWindows.add(windowKey);
    const name = nameById.get(window.assetId) ?? window.assetId;

    const startMs = window.start ? Math.max(periodStartMs, endOfDayMs(window.start)) : periodStartMs;
    const endMs = window.end ? Math.min(periodEndMs, endOfDayMs(window.end)) : periodEndMs;
    if (startMs > endMs) continue; // not covered (yet / anymore) during this period

    const all = byAsset.get(window.assetId) ?? [];
    reviewReadingsInPeriod += all.filter((r) => r.needsReview && r.at >= startMs && r.at <= endMs).length;

    const valid = all.filter((r) => !r.needsReview);
    const latestAtOrBefore = (limit: number) =>
      valid.filter((r) => r.at <= limit).reduce<{ at: number; value: number } | null>(
        (best, r) => (best === null || r.at > best.at ? r : best),
        null,
      );

    const startReading = latestAtOrBefore(startMs);
    const endReading = latestAtOrBefore(endMs);

    if (!endReading) {
      issues.push(`no reading at ${endMs < periodEndMs ? "removal date" : "period end"} for ${name}`);
    }
    if (!startReading) {
      issues.push(`no reading at period start for ${name}`);
    }
    if (!startReading || !endReading) continue;

    const delta = round3(endReading.value - startReading.value);
    if (delta < 0) {
      issues.push(
        `counter went down for ${name} (start ${startReading.value}, end ${endReading.value}); counter resets are not supported, asset not counted`,
      );
      continue;
    }
    usage += delta;
  }

  return { usage: round3(usage), issues, reviewReadingsInPeriod };
}

/** Usage above the included quantity (2 decimals, quote line precision), or 0. */
export function computeOverage(usage: number, included: number): number {
  const overage = Math.round((usage - included) * 100) / 100;
  return overage > 0 ? overage : 0;
}

/** "<counter> – usage x, included y, overage z (<period>)". */
export function describeOverage(
  counterLabel: string,
  usage: number,
  included: number,
  overage: number,
  periodLabel: string,
): string {
  return `${counterLabel} – usage ${usage}, included ${included}, overage ${overage} (${periodLabel})`;
}

export type InvoicingTiming = "in_advance" | "in_arrears";

export interface SettlementPeriodInput {
  timing: InvoicingTiming;
  /** The period this quote invoices (fixed lines). */
  invoicedPeriod: { start: string; end: string };
  contractStart: string;
  contractEnd: string | null;
  /** Periods already invoiced (the invoiced period has this zero-based index). */
  invoicedPeriodCount: number;
  /** Billing TERMS interval in months; null = non-recurring. */
  intervalMonths: number | null;
}

/** Period number `index` (zero-based) of a contract, anchored on the contract
 * start like the DB (start + index * interval months). */
export function contractPeriodByIndex(
  contractStart: string,
  index: number,
  intervalMonths: number | null,
  contractEnd: string | null,
): { start: string; end: string } {
  const start = intervalMonths ? addMonthsIso(contractStart, index * intervalMonths) : contractStart;
  return computeContractPeriod(start, contractStart, index, intervalMonths, contractEnd);
}

/**
 * The counter period whose overage a contract quote settles (issue #269):
 * in arrears = the invoiced period itself; in advance = the PREVIOUS period
 * (none for the first quote, which has no earlier period).
 */
export function planSettlementPeriod(input: SettlementPeriodInput): { start: string; end: string } | null {
  if (input.timing === "in_arrears") return input.invoicedPeriod;
  if (input.invoicedPeriodCount < 1) return null;
  return contractPeriodByIndex(
    input.contractStart,
    input.invoicedPeriodCount - 1,
    input.intervalMonths,
    input.contractEnd,
  );
}

/** Whether a period quote may be generated today: in advance from the period
 * start (`next_invoice_date <= today`, checked by the caller); in arrears only
 * once the period has ended. */
export function isPeriodQuoteDue(timing: InvoicingTiming, period: { start: string; end: string }, today: string): boolean {
  return timing === "in_arrears" ? period.end < today : period.start <= today;
}
