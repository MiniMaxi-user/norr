import type { WorkOrderRecord } from "../work-orders/actions";
import { totalSlots, dateForSlot, type WorkingHours } from "./date-utils";

export type SlotConflict = "none" | "outside" | "overlap";

/**
 * Client-side PREVIEW of the exact fit/overlap rule
 * `app/(app)/work-orders/planning-actions.ts`'s `scheduleWorkOrder` enforces
 * authoritatively, server-side (issue #164, Planning module). This drives
 * the scheduler grid's live drop preview (warning tint / red conflict) and the
 * non-drag fallback's per-cell disabled state — it is NOT the real
 * enforcement (the server call is, and its rejection must still be handled
 * gracefully even when this preview said "fits"), just a same-rule preview
 * so the UI doesn't wait on a round trip to tell someone a drop is invalid.
 */
export function slotConflict(
  slotIndex: number,
  durationMinutes: number,
  date: Date,
  hours: WorkingHours,
  engineerId: string,
  scheduledWorkOrders: WorkOrderRecord[],
  excludeWorkOrderId?: string,
): SlotConflict {
  const slots = totalSlots(hours);
  if (slotIndex < 0 || slotIndex >= slots) return "outside";

  const newStart = dateForSlot(date, slotIndex, hours).getTime();
  const newEnd = newStart + durationMinutes * 60_000;
  const windowEnd = dateForSlot(date, slots, hours).getTime();
  if (newEnd > windowEnd) return "outside";

  const overlaps = scheduledWorkOrders.some((workOrder) => {
    if (workOrder.id === excludeWorkOrderId) return false;
    if (workOrder.assigned_to !== engineerId) return false;
    if (!workOrder.scheduled_at || workOrder.duration_minutes == null) return false;
    const start = new Date(workOrder.scheduled_at).getTime();
    const end = start + workOrder.duration_minutes * 60_000;
    return newStart < end && start < newEnd;
  });
  return overlaps ? "overlap" : "none";
}

export function isSlotValid(
  slotIndex: number,
  durationMinutes: number,
  date: Date,
  hours: WorkingHours,
  engineerId: string,
  scheduledWorkOrders: WorkOrderRecord[],
  excludeWorkOrderId?: string,
): boolean {
  return slotConflict(slotIndex, durationMinutes, date, hours, engineerId, scheduledWorkOrders, excludeWorkOrderId) === "none";
}

/** Grid-column span for a block of `durationMinutes` on the half-hour grid
 * — rounded UP so a duration that isn't an exact multiple of 30 still gets a
 * visually complete cell rather than being clipped. */
export function spanForDuration(durationMinutes: number): number {
  return Math.max(1, Math.ceil(durationMinutes / 30));
}
