/**
 * When may a work order in `to_review` be approved (→ `completed`)? Only once
 * it is properly wrapped up (product decision, issue #222):
 *  - description, solution and type are filled in;
 *  - client, site and asset are linked;
 *  - no time registration is still running;
 *  - every checklist item is ticked (when a checklist is attached).
 *
 * Pure and shared: `approveWorkOrderReview` (`./actions.ts`) enforces it
 * server-side, and the web LivePanel uses the same function to list what is
 * still missing instead of offering an Approve button that would fail.
 */
export interface ApprovalReadinessInput {
  description: string | null;
  solution: string | null;
  typeId: string | null;
  clientId: string | null;
  siteId: string | null;
  assetId: string | null;
  /** Time entries without an end time. */
  runningTimeEntries: number;
  /** Checklist items not yet ticked (0 when no checklist is attached). */
  openChecklistItems: number;
}

export function approvalBlockers(input: ApprovalReadinessInput): string[] {
  const blockers: string[] = [];
  if (!input.description?.trim()) blockers.push("Add a description");
  if (!input.solution?.trim()) blockers.push("Add a solution");
  if (!input.typeId) blockers.push("Choose a type");
  if (!input.clientId) blockers.push("Link a client");
  if (!input.siteId) blockers.push("Link a site");
  if (!input.assetId) blockers.push("Link an asset");
  if (input.runningTimeEntries > 0) {
    blockers.push(
      input.runningTimeEntries === 1
        ? "Stop the running time registration"
        : `Stop the ${input.runningTimeEntries} running time registrations`,
    );
  }
  if (input.openChecklistItems > 0) {
    blockers.push(
      input.openChecklistItems === 1
        ? "Tick the last open checklist item"
        : `Tick the ${input.openChecklistItems} open checklist items`,
    );
  }
  return blockers;
}
