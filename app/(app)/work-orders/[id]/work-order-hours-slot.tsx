import { listTimeEntries } from "../time-entries-actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { getWorkOrderCostSummary, getUnresolvedWorkOrderTimeEntries } from "../quote-sync-actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { WorkOrderHoursSection } from "../components/work-order-hours-section";
import { WorkOrderCostStatsReporter } from "../components/work-order-hero-context";

/**
 * Async Server Component doing `WorkOrderHoursSection`'s own fetch — issue
 * #146. Rendered inside its own `<Suspense>` from `[id]/page.tsx`, streaming
 * in independently of the hero/relation cards and the Material/Checklist
 * slots. `timeEntries`/`timeEntryTypes` are fetched for every edit-mode
 * caller (an engineer sees their own hours); `costSummary`/
 * `unresolvedTimeEntryCount` (issue #109) only when `canSeeCosts` — same
 * "don't fetch what can't render" reasoning `[id]/page.tsx` documents for its
 * own fetches. Reports the "To invoice" tile back up to the hero's stat strip
 * via `WorkOrderCostStatsReporter` when `canSeeCosts` (the
 * `!canSeeCosts` engineer fallback is owned by `WorkOrderMaterialSlot`'s own
 * reporter instead — see that component's doc comment).
 */
export async function WorkOrderHoursSlot({
  workOrderId,
  assignedTo,
  currentUserId,
  members,
  canLogTimeForOthers,
  canUpdateTimeEntriesAny,
  canUpdateTimeEntriesOwn,
  canDelete,
  canSeeCosts,
}: {
  workOrderId: string;
  assignedTo: string | null;
  currentUserId: string;
  members: OrgMemberRecord[];
  canLogTimeForOthers: boolean;
  canUpdateTimeEntriesAny: boolean;
  canUpdateTimeEntriesOwn: boolean;
  canDelete: boolean;
  canSeeCosts: boolean;
}) {
  const [timeEntriesResult, timeEntryTypesResult, costSummaryResult, unresolvedTimeEntriesResult] =
    await Promise.all([
      listTimeEntries(workOrderId),
      listReferenceItems("time_entry_type"),
      canSeeCosts ? getWorkOrderCostSummary(workOrderId) : Promise.resolve(null),
      canSeeCosts ? getUnresolvedWorkOrderTimeEntries(workOrderId) : Promise.resolve(null),
    ]);

  const timeEntries = timeEntriesResult.data?.timeEntries ?? [];
  const timeEntryTypes = timeEntryTypesResult.data?.items ?? [];
  const costSummary = costSummaryResult?.data ?? null;
  const unresolvedTimeEntryCount = unresolvedTimeEntriesResult?.data?.unresolvedTimeEntryIds.length ?? 0;

  return (
    <>
      {canSeeCosts && <WorkOrderCostStatsReporter costSummary={costSummary} />}
      <WorkOrderHoursSection
        mode="edit"
        workOrderId={workOrderId}
        timeEntries={timeEntries}
        members={members}
        entryTypes={timeEntryTypes}
        assignedTo={assignedTo}
        currentUserId={currentUserId}
        canLogTimeForOthers={canLogTimeForOthers}
        canUpdateAny={canUpdateTimeEntriesAny}
        canUpdateOwn={canUpdateTimeEntriesOwn}
        canDelete={canDelete}
        canSeeCosts={canSeeCosts}
        costSummary={costSummary}
        unresolvedTimeEntryCount={unresolvedTimeEntryCount}
      />
    </>
  );
}
