import { getWorkOrderChecklist } from "../checklist-actions";
import { listChecklistTemplates } from "@/lib/checklist-templates/actions";
import { WorkOrderChecklistSection } from "../components/work-order-checklist-section";
import { WorkOrderChecklistStatsReporter } from "../components/work-order-hero-context";

/**
 * Async Server Component doing `WorkOrderChecklistSection`'s own fetch —
 * issue #146. Rendered inside its own `<Suspense>` from `[id]/page.tsx`,
 * ONLY when `canAccessChecklists` (checklists are their own separately-
 * entitled module, not folded into `planning` — see `[id]/page.tsx`'s own
 * comment) — matching the "don't render, not just fetch, what this org/role
 * can't access" feature-flag rule (CLAUDE.md rule 3 / docs/ARCHITECTURE.md).
 * Reports the "Checklist" tile back up to the hero's stat strip via
 * `WorkOrderChecklistStatsReporter`.
 */
export async function WorkOrderChecklistSlot({
  workOrderId,
  currentUserId,
  canAttachChecklist,
  canDetachChecklist,
  canUpdateChecklistAny,
  canUpdateChecklistOwn,
}: {
  workOrderId: string;
  currentUserId: string;
  canAttachChecklist: boolean;
  canDetachChecklist: boolean;
  canUpdateChecklistAny: boolean;
  canUpdateChecklistOwn: boolean;
}) {
  const [checklistResult, checklistTemplatesResult] = await Promise.all([
    getWorkOrderChecklist(workOrderId),
    // Only needed to populate the "attach a checklist" template picker, and
    // only owner/planner ever see that affordance — skip the round trip
    // entirely for every other role, same reasoning `[id]/page.tsx` documents
    // for its own fetches.
    canAttachChecklist ? listChecklistTemplates() : Promise.resolve(null),
  ]);

  const checklist = checklistResult.data?.checklist ?? null;
  const checklistItems = checklistResult.data?.items ?? [];
  const checklistTemplates = checklistTemplatesResult?.data?.templates ?? [];

  return (
    <>
      <WorkOrderChecklistStatsReporter checklist={checklist} checklistItems={checklistItems} />
      <WorkOrderChecklistSection
        mode="edit"
        workOrderId={workOrderId}
        checklist={checklist}
        items={checklistItems}
        templates={checklistTemplates}
        currentUserId={currentUserId}
        canAccess
        canAttach={canAttachChecklist}
        canDetach={canDetachChecklist}
        canUpdateAny={canUpdateChecklistAny}
        canUpdateOwn={canUpdateChecklistOwn}
      />
    </>
  );
}
