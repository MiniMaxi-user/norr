import { Suspense } from "react";
import { notFound } from "next/navigation";
import { WebListSkeleton } from "@yourorg/ui/web";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { ArticlesList } from "./components/articles-list";
import type { ArticlesSearchParams } from "./components/articles-query";

export const metadata = { title: "Articles" };

/**
 * Articles module entry point (issue #92, list-page shell of issue #222).
 * Server Component: resolves session/entitlement/RBAC once here, then hands
 * everything data-dependent to `ArticlesList` behind a `Suspense` boundary
 * (fallback `WebListSkeleton`, header paints at once). The `Suspense` is NOT
 * keyed on the filter params: the table changes the URL in a transition,
 * keeping the old rows on screen (dimmed) while the new page loads.
 *
 * Per docs/ARCHITECTURE.md ("a module/view that isn't entitled for the
 * tenant must not render, not just be disabled"): `hasFeature()` is checked
 * here and `notFound()`s otherwise — same gate every Server Action in
 * `./actions.ts` applies via `requireModuleContext`. Articles has no
 * multiple views, so no view switcher.
 */
export default async function ArticlesPage({ searchParams }: { searchParams: Promise<ArticlesSearchParams> }) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "articles"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "articles")) notFound();

  const params = await searchParams;

  return (
    <Suspense fallback={<WebListSkeleton module="Articles" title="Articles" columns={9} />}>
      <ArticlesList
        params={params}
        canCreate={can(actor, "articles", "create")}
        canEdit={can(actor, "articles", "update")}
        canDelete={can(actor, "articles", "delete")}
      />
    </Suspense>
  );
}
