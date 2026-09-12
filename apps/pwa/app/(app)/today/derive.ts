/**
 * Pure helpers that fold a `CachedWorkItem` (the real, server-synced
 * `work_orders` row) together with this device's LOCAL state (a running
 * clock, a local sign-off) into the Today screen's simplified
 * Planned/In progress/Signed bucket (issue #170, IMPLEMENTATION.md §6).
 *
 * The real `work_order_status` reference list has no "Signed" value at all
 * (New -> Scheduled -> En Route -> In Progress -> Completed -> Invoiced —
 * see `/api/workitems/today`'s own doc comment) — "Signed" only exists
 * client-side, from this device's own local sign-off record, since signing
 * off a work receipt stays local-only in this story (see
 * `lib/offline/db.ts`'s top doc comment on the #170 tables' scope
 * boundary). So the mapping here is a deliberate simplification, not a 1:1
 * status mirror:
 * - "signed" — this device has a local sign-off for the order, regardless
 *   of its real server-side status.
 * - "in_progress" — a clock is running on it right now (on THIS device), or
 *   its real status is `in_progress`.
 * - "planned" — everything else (`new`/`scheduled`/`en_route`, and also
 *   `completed`/`invoiced` — a same-day work order that's already fully
 *   wrapped up server-side has no distinct Today-screen treatment of its
 *   own here, it just falls back to the neutral bucket).
 */
import type { CachedWorkItem } from "@/lib/offline/db";

export type TodayFlowStatus = "planned" | "in_progress" | "signed";

export interface TodayWorkItem extends CachedWorkItem {
  flowStatus: TodayFlowStatus;
  /** A clock is running on this order on THIS device right now. */
  isRunning: boolean;
}

export function deriveTodayFlowStatus(
  item: CachedWorkItem,
  runningWorkOrderId: string | null,
  signedWorkOrderIds: ReadonlySet<string>,
): TodayFlowStatus {
  if (signedWorkOrderIds.has(item.id)) return "signed";
  if (item.id === runningWorkOrderId || item.status?.value === "in_progress") return "in_progress";
  return "planned";
}

export function deriveTodayWorkItems(
  items: CachedWorkItem[],
  runningWorkOrderId: string | null,
  signedWorkOrderIds: ReadonlySet<string>,
): TodayWorkItem[] {
  return items.map((item) => ({
    ...item,
    flowStatus: deriveTodayFlowStatus(item, runningWorkOrderId, signedWorkOrderIds),
    isRunning: item.id === runningWorkOrderId,
  }));
}

/**
 * The "Now" card selection rule (IMPLEMENTATION.md §6): the order with a
 * running timer; if none, the earliest-scheduled order that isn't Signed.
 * NEVER "the last opened order" — that would make the list feel arbitrary.
 * Items are assumed already sorted by `scheduledAt` (nulls last), matching
 * `getCachedWorkItems`'s own ordering.
 */
export function selectNowItem(items: TodayWorkItem[]): TodayWorkItem | null {
  const running = items.find((item) => item.isRunning);
  if (running) return running;
  return items.find((item) => item.flowStatus !== "signed") ?? null;
}
