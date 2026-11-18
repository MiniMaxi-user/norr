import { Suspense } from "react";
import { notFound } from "next/navigation";
import { WebListSkeleton } from "@yourorg/ui/web";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { AssetsScreen } from "./components/assets-screen";
import type { AssetsSearchParams } from "./components/assets-query";
import type { AssetsView } from "./components/assets-view-switcher";

export const metadata = { title: "Assets" };

function parseView(raw: string | undefined): AssetsView | undefined {
  return raw === "list" || raw === "map" ? raw : undefined;
}

/**
 * Assets module entry point (issue #9 frontend half, list-page shell of
 * issue #222). Server Component: resolves session/entitlement/RBAC once
 * here, then hands everything data-dependent to `AssetsScreen` behind a
 * `Suspense` boundary so the page header paints immediately and the
 * table/map streams in behind a shaped skeleton (docs/ARCHITECTURE.md
 * "Premium UX requirements"). The `Suspense` is deliberately not keyed on the
 * filter params: the table changes the URL in a transition, keeping the old
 * rows on screen while the new page loads.
 *
 * Per the same doc ("a module/view that isn't entitled for the tenant must
 * not render, not just be disabled"): `hasFeature()` is checked here, before
 * anything module-specific renders, and `notFound()`s otherwise — same
 * gate `app/(app)/assets/actions.ts` applies server-action-side via
 * `requireModuleContext`.
 */
export default async function AssetsPage({ searchParams }: { searchParams: Promise<AssetsSearchParams> }) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "assets"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "assets")) notFound();

  const params = await searchParams;
  const view: AssetsView =
    parseView(params.view) ??
    parseView((await preferencesStore.getLastUsedView(session.userId, "assets")) ?? undefined) ??
    "list";

  return (
    <Suspense fallback={<WebListSkeleton module="Assets" title="Assets" columns={6} />}>
      <AssetsScreen
        view={view}
        params={params}
        canCreate={can(actor, "assets", "create")}
        canEdit={can(actor, "assets", "update") || can(actor, "assets", "update_own")}
        canDelete={can(actor, "assets", "delete")}
      />
    </Suspense>
  );
}
