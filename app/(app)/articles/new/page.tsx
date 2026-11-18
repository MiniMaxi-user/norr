import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listArticleGroups } from "../groups-actions";
import { flattenArticleGroups } from "../group-tree";
import { ArticleScreen } from "../components/article-screen";

export const metadata = { title: "New article" };

/**
 * `mode: "create"` render of the shared `ArticleScreen` (web design system,
 * issue #222): a top-level module record gets a real page (docs/ARCHITECTURE.md
 * "Popup vs. full page"), replacing the old "create a placeholder article, then
 * open it in edit mode" shortcut. Gated on `can(actor, "articles", "create")` —
 * owner or administratie, matching `createArticle`'s own RBAC check (and the RLS
 * INSERT policy) exactly; `hasFeature()` is checked before anything renders.
 */
export default async function NewArticlePage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "articles"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "articles")) notFound();
  if (!can(actor, "articles", "create")) notFound();

  const [groupsResult, unitsResult, manufacturersResult, vatRatesResult] = await Promise.all([
    listArticleGroups(),
    listReferenceItems("article_unit"),
    listReferenceItems("article_manufacturer"),
    listReferenceItems("vat_rate"),
  ]);

  return (
    <ArticleScreen
      mode="create"
      groups={flattenArticleGroups(groupsResult.data?.groups ?? [])}
      units={unitsResult.data?.items ?? []}
      manufacturers={manufacturersResult.data?.items ?? []}
      vatRates={vatRatesResult.data?.items ?? []}
      cancelHref="/articles"
    />
  );
}
