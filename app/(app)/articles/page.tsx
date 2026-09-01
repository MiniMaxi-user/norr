import { Suspense } from "react";
import { notFound } from "next/navigation";
import { OverviewHeroBand, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { ArticlesScreen } from "./components/articles-screen";
import { ArticlesScreenSkeleton } from "./components/articles-screen-skeleton";

export const metadata = { title: "Articles" };

interface ArticlesPageProps {
  searchParams: Promise<{
    search?: string;
    groupId?: string;
    manufacturerItemId?: string;
    active?: string;
    composite?: string;
    page?: string;
  }>;
}

/**
 * Articles module entry point (issue #92, "Artikel database" — UI half).
 * Server Component: resolves session/entitlement/RBAC once here, then hands
 * everything data-dependent to `ArticlesScreen` behind a `Suspense` boundary
 * so the page shell (heading) paints immediately and the filtered list
 * streams in behind a shaped skeleton (docs/ARCHITECTURE.md "Premium UX
 * requirements"), same shape `app/(app)/assets/page.tsx` uses.
 *
 * Per docs/ARCHITECTURE.md ("a module/view that isn't entitled for the
 * tenant must not render, not just be disabled"): `hasFeature()` is checked
 * here, before anything module-specific renders, and `notFound()`s
 * otherwise — same gate every Server Action in `./actions.ts` applies via
 * `requireModuleContext`.
 *
 * Articles has no multiple views (list/kanban/map, ...) yet, so — unlike
 * Assets/Planning — there's no view switcher or last-used-view preference
 * to read here.
 */
export default async function ArticlesPage({ searchParams }: ArticlesPageProps) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "articles"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "articles")) notFound();

  const params = await searchParams;
  const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);

  return (
    <Stack gap="lg">
      <OverviewHeroBand title="Articles" subtitle="Your organization&rsquo;s product and parts catalog." />

      <Suspense
        key={`${params.search ?? ""}:${params.groupId ?? ""}:${params.manufacturerItemId ?? ""}:${params.active ?? ""}:${params.composite ?? ""}:${page}`}
        fallback={<ArticlesScreenSkeleton />}
      >
        <ArticlesScreen
          search={params.search}
          groupId={params.groupId}
          manufacturerItemId={params.manufacturerItemId}
          active={params.active}
          composite={params.composite}
          page={page}
          canCreate={can(actor, "articles", "create")}
          canEdit={can(actor, "articles", "update")}
          canDelete={can(actor, "articles", "delete")}
        />
      </Suspense>
    </Stack>
  );
}
