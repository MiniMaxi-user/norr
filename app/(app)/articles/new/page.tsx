import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { listArticleGroups } from "../groups-actions";
import { flattenArticleGroups } from "../group-tree";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { ArticleScreen } from "../components/article-screen";

export const metadata = { title: "New article" };

/**
 * Full-page article create form (issue #123, "Article popup" — converting
 * the old `ArticleFormPanel` `mode: "create"` slide-in into a real page per
 * `docs/ARCHITECTURE.md`'s "Popup vs. full page" section: Articles is a
 * top-level module entity like Assets/Work Orders, with no product-owner
 * override the way Clients has). Gated on `can(actor, "articles", "create")`
 * — only `owner`/`administratie` per `lib/rbac/permissions.ts`'s `articles`
 * entry; every other role has plain `read` only, so this route 404s for
 * them rather than rendering a form they could never submit.
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
      breadcrumbItems={[{ label: "Articles", href: "/articles" }, { label: "New article" }]}
      groups={flattenArticleGroups(groupsResult.data?.groups ?? [])}
      units={unitsResult.data?.items ?? []}
      manufacturers={manufacturersResult.data?.items ?? []}
      vatRates={vatRatesResult.data?.items ?? []}
    />
  );
}
