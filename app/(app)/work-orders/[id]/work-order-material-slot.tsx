import { listWorkOrderArticles } from "../work-order-articles-actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { WorkOrderMaterialSection } from "../components/work-order-material-section";
import { WorkOrderMaterialStatsReporter } from "../components/work-order-hero-context";

/**
 * Async Server Component doing `WorkOrderMaterialSection`'s own fetch — issue
 * #146. Rendered inside its own `<Suspense>` from `[id]/page.tsx` so it
 * streams in independently of the hero/relation cards and the Hours/
 * Checklist slots, instead of gating the whole page's first paint behind the
 * old 15-way `Promise.all`. Reports the "Material" tile (and, for a caller
 * with no `canSeeCosts`, the "To invoice" tile too) back up to the hero's
 * stat strip via `WorkOrderMaterialStatsReporter` — see that component's own
 * doc comment in `work-order-hero-context.tsx`.
 */
export async function WorkOrderMaterialSlot({
  workOrderId,
  canCreateWorkOrderArticles,
  canUpdateWorkOrderArticlesAny,
  canUpdateWorkOrderArticlesOwn,
  canDelete,
  currentUserId,
  reportToInvoice,
}: {
  workOrderId: string;
  canCreateWorkOrderArticles: boolean;
  canUpdateWorkOrderArticlesAny: boolean;
  canUpdateWorkOrderArticlesOwn: boolean;
  canDelete: boolean;
  currentUserId: string;
  /** `!canSeeCosts` — computed by `[id]/page.tsx`, see
   * `WorkOrderMaterialStatsReporter`'s own doc comment for why. */
  reportToInvoice: boolean;
}) {
  const [workOrderArticlesResult, articlesForSelectResult] = await Promise.all([
    listWorkOrderArticles(workOrderId),
    // Only needed to populate the "which article was consumed" picker, and
    // only a caller who can log one at all ever sees it — skip the round
    // trip entirely for a plain read-only viewer, same "don't fetch what
    // can't render" reasoning `[id]/page.tsx` documents for its own fetches.
    canCreateWorkOrderArticles ? listArticlesForSelect() : Promise.resolve(null),
  ]);

  const workOrderArticles = workOrderArticlesResult.data?.workOrderArticles ?? [];
  const articlesForSelect = articlesForSelectResult?.data?.articles ?? [];

  return (
    <>
      <WorkOrderMaterialStatsReporter workOrderArticles={workOrderArticles} reportToInvoice={reportToInvoice} />
      <WorkOrderMaterialSection
        mode="edit"
        workOrderId={workOrderId}
        workOrderArticles={workOrderArticles}
        articles={articlesForSelect}
        canCreate={canCreateWorkOrderArticles}
        canUpdateAny={canUpdateWorkOrderArticlesAny}
        canUpdateOwn={canUpdateWorkOrderArticlesOwn}
        canDelete={canDelete}
        currentUserId={currentUserId}
      />
    </>
  );
}
