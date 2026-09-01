import { Suspense } from "react";
import { notFound } from "next/navigation";
import { OverviewHeroBand, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { AssetsScreen } from "./components/assets-screen";
import { AssetsScreenSkeleton } from "./components/assets-screen-skeleton";
import type { AssetsView } from "./components/assets-view-switcher";

export const metadata = { title: "Assets" };

interface AssetsPageProps {
  searchParams: Promise<{
    clientId?: string;
    siteId?: string;
    view?: string;
    page?: string;
  }>;
}

function parseView(raw: string | undefined): AssetsView | undefined {
  return raw === "list" || raw === "map" ? raw : undefined;
}

/**
 * Assets module entry point (issue #9 frontend half). Server Component:
 * resolves session/entitlement/RBAC once here, then hands everything data-
 * dependent to `AssetsScreen` behind a `Suspense` boundary so the page shell
 * (heading) paints immediately and the list/map/toolbar stream in behind a
 * shaped skeleton (docs/ARCHITECTURE.md "Premium UX requirements").
 *
 * Per the same doc ("a module/view that isn't entitled for the tenant must
 * not render, not just be disabled"): `hasFeature()` is checked here, before
 * anything module-specific renders, and `notFound()`s otherwise — same
 * gate `app/(app)/assets/actions.ts` applies server-action-side via
 * `requireModuleContext`.
 */
export default async function AssetsPage({ searchParams }: AssetsPageProps) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "assets"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "assets")) notFound();

  const params = await searchParams;
  const requestedView = parseView(params.view);
  const view: AssetsView =
    requestedView ?? (parseView((await preferencesStore.getLastUsedView(session.userId, "assets")) ?? undefined) ?? "list");
  const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);

  return (
    <Stack gap="lg">
      <OverviewHeroBand title="Assets" subtitle="Equipment installed at your clients&rsquo; sites." />

      <Suspense
        key={`${view}:${params.clientId ?? ""}:${params.siteId ?? ""}:${page}`}
        fallback={<AssetsScreenSkeleton view={view} />}
      >
        <AssetsScreen
          view={view}
          clientId={params.clientId}
          siteId={params.siteId}
          page={page}
          canCreate={can(actor, "assets", "create")}
          canEdit={can(actor, "assets", "update") || can(actor, "assets", "update_own")}
          canDelete={can(actor, "assets", "delete")}
        />
      </Suspense>
    </Stack>
  );
}
