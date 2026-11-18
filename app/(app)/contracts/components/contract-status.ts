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
