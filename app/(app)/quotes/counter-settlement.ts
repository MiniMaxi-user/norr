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

export function computeCounterUsage(
  assets: readonly CounterAsset[],
  readings: readonly CounterReading[],
  periodStart: string,
  periodEnd: string,
  baselineDates?: ReadonlyMap<string, string | null>,
): CounterUsageResult {
  const periodStartMs = startOfDayMs(periodStart);
  const endMs = endOfDayMs(periodEnd);

  const byAsset = new Map<string, { at: number; value: number; needsReview: boolean }[]>();
  for (const reading of readings) {
    const list = byAsset.get(reading.assetId) ?? [];
    list.push({ at: Date.parse(reading.readAt), value: reading.value, needsReview: reading.needsReview });
    byAsset.set(reading.assetId, list);
  }

  let usage = 0;
  let reviewReadingsInPeriod = 0;
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const asset of assets) {
    if (seen.has(asset.id)) continue; // an asset covered twice counts once
    seen.add(asset.id);

    const baseline = baselineDates?.get(asset.id) ?? null;
    const startMs = baseline ? Math.max(periodStartMs, endOfDayMs(baseline)) : periodStartMs;
    if (startMs > endMs) continue; // not covered yet during this period

    const all = byAsset.get(asset.id) ?? [];
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
      issues.push(`no reading at period end for ${asset.name}`);
    }
    if (!startReading) {
      issues.push(`no reading at period start for ${asset.name}`);
    }
    if (!startReading || !endReading) continue;

    const delta = round3(endReading.value - startReading.value);
    if (delta < 0) {
      issues.push(
        `counter went down for ${asset.name} (start ${startReading.value}, end ${endReading.value}); counter resets are not supported, asset not counted`,
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
