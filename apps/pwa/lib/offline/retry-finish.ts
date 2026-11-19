/**
 * Retries a previously-failed "Finish workitem" POST (bug report,
 * 2026-09-13 — "geef ook een badge als een workitem niet gesynced is").
 * `work-order-detail.tsx`'s `handleFinish` already writes a local
 * `signoffs` row with `pendingSync: true` BEFORE attempting `POST
 * /api/work-orders/[id]/finish`, and only clears the periods/articles it
 * sent (`clearSyncedWorkOrderData`) once that POST actually succeeds — so a
 * device that went offline right at Finish still has everything this needs
 * (the periods/articles are still sitting in `clockPeriods`/`localArticles`
 * for that work order) to retry from scratch here, without the engineer
 * re-doing anything.
 *
 * Issue #225: queued offline volume readings (`localVolumeReadings`) are sent
 * in the same POST (`volumeReadings`) and cleared with the rest.
 *
 * Called from `today-screen.tsx` on mount and on the browser's `online`
 * event — not from the work-order-detail screen itself, since a
 * `pendingSync` order is no longer reachable from Today (product feedback,
 * 2026-09-12: a signed-off order stops being a `<Link>`), so Today is the
 * only place this can plausibly retry from.
 */
import {
  clearSyncedWorkOrderData,
  deleteLocalSignOff,
  getClockPeriodsForOrder,
  getLocalArticles,
  getLocalVolumeReadings,
  getPendingSignOffs,
  markSignOffSynced,
} from "./db";

/** Re-POSTs `/api/work-orders/[id]/finish` for every work order
 * `currentUserId` has a `pendingSync` local sign-off for. Best-effort and
 * sequential (there's realistically at most one or two pending at a time):
 * a row that still fails (still offline, or a real server error) is simply
 * left `pendingSync` for the next attempt — never throws, since a caller on
 * a page mount or an `online` handler has nothing useful to do with a
 * rejection here anyway. */
export async function retryPendingSignOffs(currentUserId: string): Promise<void> {
  const pending = await getPendingSignOffs(currentUserId);
  for (const signOff of pending) {
    try {
      const [periods, articles, volumeReadings] = await Promise.all([
        getClockPeriodsForOrder(signOff.workOrderId, currentUserId),
        getLocalArticles(signOff.workOrderId, currentUserId),
        getLocalVolumeReadings(signOff.workOrderId, currentUserId),
      ]);
      const response = await fetch(`/api/work-orders/${signOff.workOrderId}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periods: periods
            .filter((period) => period.endedAt !== null)
            .map((period) => ({ kind: period.kind, startedAt: period.startedAt, endedAt: period.endedAt })),
          articles: articles.map((article) => ({ articleId: article.articleId, quantity: article.quantity })),
          solution: signOff.solution,
          signatureDataUrl: signOff.signatureDataUrl,
          signedAt: signOff.signedAt,
          volumeReadings: volumeReadings.map((reading) => ({
            id: reading.id,
            volumeItemId: reading.volumeItemId,
            value: reading.value,
            readAt: reading.readAt,
            notes: reading.notes,
          })),
        }),
      });
      if (!response.ok) {
        // Issue #225: a 400 means the server rejected the finish itself (e.g.
        // a required volume/solution is missing — typically a finish queued
        // by an older app version). Retrying can never succeed, so drop the
        // local sign-off: the work order becomes openable on Today again and
        // the engineer completes the Sign tab's checklist and finishes anew.
        // Hours/articles/volume readings stay queued locally (not cleared),
        // and the solution/signature draft is kept in `drafts`.
        if (response.status === 400) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          console.error(
            `retryPendingSignOffs: server rejected finish of ${signOff.workOrderId}: ${payload?.error ?? "unknown"}`,
          );
          await deleteLocalSignOff(signOff.workOrderId);
        }
        continue;
      }
      // Same cleanup order `handleFinish` itself does on a first-try
      // success — see `clearSyncedWorkOrderData`'s own doc comment on why
      // this only ever runs after the POST is confirmed to have landed.
      await clearSyncedWorkOrderData(signOff.workOrderId, currentUserId);
      await markSignOffSynced(signOff.workOrderId);
    } catch {
      // Still offline, or a real server error — leave `pendingSync` as-is;
      // the next `online` event or Today-mount tries again.
    }
  }
}
