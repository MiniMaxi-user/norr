import type {
  ContractInvoicingTiming,
  ContractStatus as ContractStoredStatus,
  CounterSettlementFrequency,
} from "../schema";

/**
 * Derived lifecycle of a contract, from its dates alone (there is no stored
 * status column): Upcoming (starts in the future), Active, Ended (end date in
 * the past). Pure and deterministic — callers inject `now`.
 */
export type ContractPhase = "upcoming" | "active" | "ended";

export interface ContractStatus {
  phase: ContractPhase;
  label: string;
  /** Whole days until the end date (negative once ended); `null` = open-ended. */
  daysToEnd: number | null;
  /** Whole days until the start date (negative once started). */
  daysToStart: number;
}

const DAY = 24 * 60 * 60 * 1000;

function dayNumber(isoDate: string): number {
  return Math.floor(new Date(`${isoDate}T00:00:00Z`).getTime() / DAY);
}

function todayNumber(now: number): number {
  const date = new Date(now);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
}

export function getContractStatus(
  contract: { start_date: string; end_date: string | null },
  now: number = Date.now(),
): ContractStatus {
  const today = todayNumber(now);
  const daysToStart = dayNumber(contract.start_date) - today;
  const daysToEnd = contract.end_date ? dayNumber(contract.end_date) - today : null;
  if (daysToStart > 0) return { phase: "upcoming", label: "Upcoming", daysToEnd, daysToStart };
  if (daysToEnd !== null && daysToEnd < 0) return { phase: "ended", label: "Ended", daysToEnd, daysToStart };
  return { phase: "active", label: "Active", daysToEnd, daysToStart };
}

export function pluralDays(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

/* ---- Stored status (issue #270) and invoicing timing (issue #269) ---------- */

export const CONTRACT_STATUS_LABEL: Record<ContractStoredStatus, string> = {
  draft: "Draft",
  active: "Active",
  ended: "Ended",
};

export const CONTRACT_STATUS_TONE: Record<ContractStoredStatus, "info" | "success" | "neutral"> = {
  draft: "info",
  active: "success",
  ended: "neutral",
};

export const INVOICING_TIMING_LABEL: Record<ContractInvoicingTiming, string> = {
  in_advance: "In advance",
  in_arrears: "In arrears",
};

export const INVOICING_TIMING_NOTE =
  "In advance: each period is invoiced when it starts. In arrears: each period is invoiced after it ends, including its counter overage.";

/* ---- Counter settlement (issue #271) -------------------------------------- */

export const COUNTER_SETTLEMENT_LABEL: Record<CounterSettlementFrequency, string> = {
  with_invoice: "With every invoice",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

export const COUNTER_SETTLEMENT_NOTE =
  "When counter overage (and credited under-use) is billed: with every invoice, or on a separate counter settlement quote on a fixed date.";

export const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
