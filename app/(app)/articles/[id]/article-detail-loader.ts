import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { getArticle } from "../actions";
import { listArticleGroups } from "../groups-actions";
import { flattenArticleGroups } from "../group-tree";
import { getArticleComponentTree, listArticleParents } from "../components-actions";
import { ARTICLE_DETAIL_VIEW_KEY } from "../components/constants";
import type { ArticleDetailTab, ArticleScreenProps } from "../components/article-screen";

const TAB_IDS: ArticleDetailTab[] = ["overview", "bom"];

/**
 * Data-fetching + RBAC gating behind `/articles/[id]`. `hasFeature()` and the
 * module permission are resolved before anything renders; the bill-of-materials
 * tree is only fetched for a composite article (the tab only exists then).
 *
 * `?tab=` (explicit deep link) beats the last-used-view cookie; either falls
 * back to Overview when that tab does not exist for this article.
 */
export async function loadArticleScreenProps(
  id: string,
  requestedTab?: string,
): Promise<Omit<ArticleScreenProps, "cancelHref">> {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "articles"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "articles")) notFound();

  const articleResult = await getArticle(id);
  if (!articleResult.data) notFound();
  const { article, components } = articleResult.data;

  const [groupsResult, unitsResult, manufacturersResult, vatRatesResult, componentTreeResult, parentsResult, lastUsedTab] =
    await Promise.all([
      listArticleGroups(),
      listReferenceItems("article_unit"),
      listReferenceItems("article_manufacturer"),
      listReferenceItems("vat_rate"),
      article.is_composite ? getArticleComponentTree(id) : Promise.resolve(null),
      listArticleParents(id),
      preferencesStore.getLastUsedView(session.userId, ARTICLE_DETAIL_VIEW_KEY),
    ]);

  const available = (raw: string | null | undefined): ArticleDetailTab | null => {
    if (!raw || !TAB_IDS.includes(raw as ArticleDetailTab)) return null;
    return raw === "bom" && !article.is_composite ? null : (raw as ArticleDetailTab);
  };

  return {
    mode: "edit",
    article,
    components,
    componentTree: componentTreeResult?.data?.tree,
    parents: parentsResult.data?.parents ?? [],
    groups: flattenArticleGroups(groupsResult.data?.groups ?? []),
    units: unitsResult.data?.items ?? [],
    manufacturers: manufacturersResult.data?.items ?? [],
    vatRates: vatRatesResult.data?.items ?? [],
    canCreate: can(actor, "articles", "create"),
    canUpdate: can(actor, "articles", "update"),
    canDelete: can(actor, "articles", "delete"),
    defaultTab: available(requestedTab) ?? available(lastUsedTab) ?? "overview",
  };
}
