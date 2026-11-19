/**
 * Sends checklist toggles queued while offline (issue #230,
 * `localChecklistToggles`) to the server one by one
 * (`PATCH /api/work-orders/[id]/checklist/items/[itemId]`). Best-effort, like
 * `photo-sync.ts`: called on Today mount, on the browser's `online` event and
 * on the work order screen's `online` event. A toggle that still can't reach
 * the server stays queued; one the server rejects (item gone, not assigned
 * anymore: 4xx) is dropped, since retrying can never succeed. Whatever stays
 * queued is also applied by the finish POST, so nothing is lost either way.
 */
import { deleteLocalChecklistToggleIfUnchanged, getAllLocalChecklistToggles } from "./db";

let running = false;

export async function syncPendingChecklistToggles(currentUserId: string): Promise<void> {
  if (running) return;
  running = true;
  try {
    const toggles = await getAllLocalChecklistToggles(currentUserId);
    for (const toggle of toggles) {
      try {
        const response = await fetch(`/api/work-orders/${toggle.workOrderId}/checklist/items/${toggle.itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isChecked: toggle.isChecked }),
        });
        if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 401)) {
          // Only if it was not toggled again while the PATCH was in flight.
          await deleteLocalChecklistToggleIfUnchanged(toggle.itemId, toggle.at);
        }
      } catch {
        // Still offline — the next attempt retries.
      }
    }
  } finally {
    running = false;
  }
}
