import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getArticle } from "../actions";
import { listArticleGroups } from "../groups-actions";
import { flattenArticleGroups } from "../group-tree";
import { getArticleComponentTree } from "../components-actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import type { ArticleScreenProps } from "../components/article-screen";

/**
 * Shared data-fetching + RBAC gating behind `/articles/[id]` and
 * `/articles/[id]/edit` — both routes render the exact same `ArticleScreen`
 * with the exact same props except `startInEditMode` (each route's own
 * `page.tsx` decides that one directly), so this is the one place the rest of
 * this logic lives rather than being duplicated across both `page.tsx` files.
 */
export async function loadArticleScreenProps(
  id: string,
): Promise<Omit<ArticleScreenProps, "breadcrumbItems" | "startInEditMode">> {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "articles"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "articles")) notFound();

  const articleResult = await getArticle(id);
  if (!articleResult.data) notFound();
  const { article, components } = articleResult.data;

  const canEdit = can(actor, "articles", "update");
  const canDelete = can(actor, "articles", "delete");

  const [groupsResult, unitsResult, manufacturersResult, vatRatesResult, componentTreeResult] = await Promise.all([
    listArticleGroups(),
    listReferenceItems("article_unit"),
    listReferenceItems("article_manufacturer"),
    listReferenceItems("vat_rate"),
    // Only a composite article has a bill-of-materials tree worth fetching —
    // matches `ArticleStatusSection`'s own `isCompositePersisted` gate on the
    // rendering side, so a plain article never pays for this extra query.
    article.is_composite ? getArticleComponentTree(id) : null,
  ]);

  return {
    article,
    components,
    componentTree: componentTreeResult?.data?.tree,
    readOnly: !canEdit,
    groups: flattenArticleGroups(groupsResult.data?.groups ?? []),
    units: unitsResult.data?.items ?? [],
    manufacturers: manufacturersResult.data?.items ?? [],
    vatRates: vatRatesResult.data?.items ?? [],
    canDelete,
  };
}
