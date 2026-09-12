/**
 * Pure helpers that fold a `CachedWorkItem` (the real, server-synced
 * `work_orders` row) together with this device's LOCAL state (a running
 * clock, a local sign-off) into the Today screen's simplified
 * Planned/In progress/Signed bucket (issue #170, IMPLEMENTATION.md §6).
 *
 * "Signed" here means "finished" — the Today screen's one terminal
 * bucket, entered either way a work order can be finished:
 * - this device has a local sign-off for it (`lib/offline/db.ts`'s
 *   `signoffs` table — still local-only, see that file's top doc
 *   comment), or
 * - its real server-side `work_order_status` is `completed`/`invoiced`
 *   (product feedback, 2026-09-12: "Finish workitem" now actually writes
 *   this via `POST /api/work-orders/[id]/finish`, so a finished order is
 *   "Signed" here even freshly synced on a device that never opened it —
 *   e.g. finished on a different device, or by a desktop user).
 *
 * - "in_progress" — a clock is running on it right now (on THIS device), or
 *   its real status is `in_progress`.
 * - "planned" — everything else (`new`/`scheduled`/`en_route`).
 */
import type { CachedWorkItem } from "@/lib/offline/db";

export type TodayFlowStatus = "planned" | "in_progress" | "signed";

export interface TodayWorkItem extends CachedWorkItem {
  flowStatus: TodayFlowStatus;
  /** A clock is running on this order on THIS device right now. */
  isRunning: boolean;
}

const FINISHED_STATUS_VALUES = new Set(["completed", "invoiced"]);

export function deriveTodayFlowStatus(
  item: CachedWorkItem,
  runningWorkOrderId: string | null,
  signedWorkOrderIds: ReadonlySet<string>,
): TodayFlowStatus {
  if (signedWorkOrderIds.has(item.id) || (item.status?.value && FINISHED_STATUS_VALUES.has(item.status.value))) {
    return "signed";
  }
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
