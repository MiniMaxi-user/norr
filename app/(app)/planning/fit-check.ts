import type { WorkOrderRecord } from "../work-orders/actions";
import { TOTAL_SLOTS, dateForSlot } from "./date-utils";

/**
 * Client-side PREVIEW of the exact fit/overlap rule
 * `app/(app)/work-orders/planning-actions.ts`'s `scheduleWorkOrder` enforces
 * authoritatively, server-side (issue #164, Planning module). This drives
 * the scheduler grid's live green/red drag-hover accent and the non-drag
 * fallback's per-cell `aria-disabled` state — it is NOT the real
 * enforcement (the server call is, and its rejection must still be handled
 * gracefully even when this preview said "fits"), just a same-rule preview
 * so the UI doesn't wait on a round trip to tell someone a drop is invalid.
 */
export function isSlotValid(
  slotIndex: number,
  durationMinutes: number,
  date: Date,
  engineerId: string,
  scheduledWorkOrders: WorkOrderRecord[],
  excludeWorkOrderId?: string,
): boolean {
  if (slotIndex < 0 || slotIndex >= TOTAL_SLOTS) return false;

  const newStart = dateForSlot(date, slotIndex).getTime();
  const newEnd = newStart + durationMinutes * 60_000;
  const windowEnd = dateForSlot(date, TOTAL_SLOTS).getTime();
  if (newEnd > windowEnd) return false;

  return !scheduledWorkOrders.some((workOrder) => {
    if (workOrder.id === excludeWorkOrderId) return false;
    if (workOrder.assigned_to !== engineerId) return false;
    if (!workOrder.scheduled_at || workOrder.duration_minutes == null) return false;
    const start = new Date(workOrder.scheduled_at).getTime();
    const end = start + workOrder.duration_minutes * 60_000;
    return newStart < end && start < newEnd;
  });
}

/** Grid-column span for a block of `durationMinutes` on the half-hour grid
 * — rounded UP so a duration that isn't an exact multiple of 30 still gets a
 * visually complete cell rather than being clipped. */
export function spanForDuration(durationMinutes: number): number {
  return Math.max(1, Math.ceil(durationMinutes / 30));
}
