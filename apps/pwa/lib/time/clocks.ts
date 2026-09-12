/**
 * Timer state model (issue #170, IMPLEMENTATION.md §5) — "the place where it
 * quickly goes wrong. Hours belong to a work order, not the app."
 *
 * `computeClockSummary` is the pure, standalone-testable core: elapsed time
 * is always `base + (start ? now - start : 0)`, recomputed from a
 * `startedAt` timestamp, never accumulated on an interval tick — that's what
 * lets it survive a closed app or an hour in the background. It takes a
 * plain array of `ClockPeriod`s (no Dexie dependency) so it can be unit
 * tested in isolation, per IMPLEMENTATION.md §7's suggestion that this file
 * be "los te testen" (testable on its own).
 *
 * `toggleClock`/`finishWorkOrder`/`getRunningWorkOrderId` are the
 * orchestration layer on top: they read/write `lib/offline/db.ts`'s
 * `clockPeriods` table to actually enforce the rules —
 * - Max ONE work order runs, app-wide: starting a timer closes every other
 *   open period first.
 * - Within one order, `travel` and `work` are mutually exclusive: starting
 *   one closes the other if it's running.
 * - `Finish` closes any running period(s) on that order.
 */
import {
  endClockPeriod,
  getClockPeriodsForOrder,
  getOpenClockPeriods,
  startClockPeriod,
  type ClockPeriod,
} from "@/lib/offline/db";

export type ClockKind = "travel" | "work";

export interface ClockSummary {
  /** Total travel ms — every closed travel period, plus the running one's
   * elapsed time if it's the one currently open. */
  travelMs: number;
  workMs: number;
  /** Which kind is currently running for THIS work order, or `null` if
   * nothing on it is running (it may still be running on another order —
   * callers that need the app-wide running order use
   * `getRunningWorkOrderId`). */
  runningKind: ClockKind | null;
}

/** Pure recompute of `{travelMs, workMs, runningKind}` for one work order
 * from its full period list — never sums/accumulates across calls, always
 * derived fresh from `startedAt`/`endedAt` + `now`. Safe to call every
 * second (or once, on a cold load) with the same result shape either way. */
export function computeClockSummary(periods: ClockPeriod[], now: number): ClockSummary {
  let travelMs = 0;
  let workMs = 0;
  let runningKind: ClockKind | null = null;

  for (const period of periods) {
    const elapsed = (period.endedAt ?? now) - period.startedAt;
    if (period.kind === "travel") travelMs += elapsed;
    else workMs += elapsed;
    if (period.endedAt === null) runningKind = period.kind;
  }

  return { travelMs, workMs, runningKind };
}

/** Human `H:MM:SS` (tabular-nums in the UI) for the big sticky-timer digit. */
export function formatClockDigits(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

/** Human `Xh YYm` for the Travel/Work subtotal line and Hours tab. */
export function formatClockHoursMinutes(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

/** The work order id with a currently-running period for `userId`, or
 * `null` if nothing is running — drives the Today screen's "Now" card rule
 * (IMPLEMENTATION.md §6: the running order, else the next non-signed one)
 * and the bottom bar's Today-vs-detail framing. */
export async function getRunningWorkOrderId(userId: string): Promise<string | null> {
  const [open] = await getOpenClockPeriods(userId);
  return open?.workOrderId ?? null;
}

/**
 * Starts/stops `kind` on `workOrderId` for `userId` at `now`, enforcing
 * IMPLEMENTATION.md §5's rules:
 * - If `kind` is already running on THIS order, stop it (close the period).
 * - Otherwise, close every other currently-open period first (any order, any
 *   kind — this is both the "max one order runs" rule AND the "travel/work
 *   are mutually exclusive within one order" rule, since a same-order
 *   other-kind period is also just an "other open period" from this
 *   function's point of view), then open a new period for `kind`.
 */
export async function toggleClock(workOrderId: string, kind: ClockKind, userId: string, now: number): Promise<void> {
  const open = await getOpenClockPeriods(userId);
  const ownPeriod = open.find((period) => period.workOrderId === workOrderId && period.kind === kind);

  if (ownPeriod?.id !== undefined) {
    await endClockPeriod(ownPeriod.id, now);
    return;
  }

  await Promise.all(
    open
      .filter((period): period is ClockPeriod & { id: number } => period.id !== undefined)
      .map((period) => endClockPeriod(period.id, now)),
  );

  await startClockPeriod({ workOrderId, userId, kind, startedAt: now });
}

/** Closes any running period(s) on `workOrderId` for `userId` — the
 * `Finish work order`/`Send work receipt` action. Only ever needs to close
 * at most one (max-one-order-running is already enforced by `toggleClock`),
 * but defensively checks both kinds. */
export async function finishWorkOrderClock(workOrderId: string, userId: string, now: number): Promise<void> {
  const open = await getOpenClockPeriods(userId);
  await Promise.all(
    open
      .filter((period) => period.workOrderId === workOrderId && period.id !== undefined)
      .map((period) => endClockPeriod(period.id as number, now)),
  );
}

/** Convenience wrapper: `computeClockSummary` fed straight from
 * `lib/offline/db.ts`'s stored periods for `workOrderId`. */
export async function getClockSummaryForOrder(
  workOrderId: string,
  userId: string,
  now: number,
): Promise<ClockSummary> {
  const periods = await getClockPeriodsForOrder(workOrderId, userId);
  return computeClockSummary(periods, now);
}
