import { Suspense } from "react";
import { notFound } from "next/navigation";
import { WebListSkeleton } from "@yourorg/ui/web";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, canAny, type PermissionActor } from "@/lib/rbac/permissions";
import { ActivitiesList } from "./components/activities-list";
import type { ActivitiesSearchParams } from "./components/activities-query";

export const metadata = { title: "Activities" };

/**
 * Activities module entry point (issue #59 frontend half, list-page shell of
 * issue #222). Server Component resolving session/entitlement/RBAC once,
 * handing everything data-dependent to `ActivitiesList` behind `Suspense`
 * (fallback `WebListSkeleton`). The `Suspense` is NOT keyed on the filter
 * params: the table changes the URL in a transition, keeping the old rows on
 * screen (dimmed) while the new page loads.
 *
 * Per docs/ARCHITECTURE.md ("a module/view that isn't entitled for the
 * tenant must not render, not just be disabled"): `hasFeature()` is checked
 * here and `notFound()`s otherwise, same gate `./actions.ts` applies
 * server-action-side via `requireModuleContext`.
 */
export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<ActivitiesSearchParams> }) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "activities"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "activities")) notFound();

  const params = await searchParams;

  return (
    <Suspense fallback={<WebListSkeleton module="Activities" title="Activities" columns={7} />}>
      <ActivitiesList
        params={params}
        canCreate={canAny(actor, "activities", ["create", "create_own"])}
        canDelete={can(actor, "activities", "delete")}
      />
    </Suspense>
  );
}
