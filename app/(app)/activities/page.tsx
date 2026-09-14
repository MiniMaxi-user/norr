import { Suspense } from "react";
import { notFound } from "next/navigation";
import { OverviewHeroBand, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, canAny, type PermissionActor } from "@/lib/rbac/permissions";
import { ActivitiesScreen } from "./components/activities-screen";
import { ActivitiesScreenSkeleton } from "./components/activities-screen-skeleton";

export const metadata = { title: "Activities" };

interface ActivitiesPageProps {
  searchParams: Promise<{
    page?: string;
    clientId?: string;
    statusId?: string;
    typeId?: string;
    actionHolderId?: string;
  }>;
}

/**
 * Activities module entry point (issue #59 frontend half) —
 * mirrors `app/(app)/work-orders/page.tsx`'s shape exactly: Server Component
 * resolving session/entitlement/RBAC once, handing everything data-dependent
 * to a screen component behind `Suspense` so the page shell paints
 * immediately.
 *
 * Per docs/ARCHITECTURE.md ("a module/view that isn't entitled for the
 * tenant must not render, not just be disabled"): `hasFeature()` is checked
 * here, before anything module-specific renders, and `notFound()`s
 * otherwise — same gate `./actions.ts` applies server-action-side via
 * `requireModuleContext`.
 */
export default async function ActivitiesPage({ searchParams }: ActivitiesPageProps) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "activities"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "activities")) notFound();

  const params = await searchParams;
  const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);

  return (
    <Stack gap="lg">
      <OverviewHeroBand
        title="Activities"
        subtitle="Calls, breakdowns, maintenance, appointments, and email follow-ups logged against your clients."
      />

      <Suspense
        key={`${page}:${params.clientId ?? ""}:${params.statusId ?? ""}:${params.typeId ?? ""}:${params.actionHolderId ?? ""}`}
        fallback={<ActivitiesScreenSkeleton />}
      >
        <ActivitiesScreen
          page={page}
          clientId={params.clientId}
          statusId={params.statusId}
          typeId={params.typeId}
          actionHolderId={params.actionHolderId}
          canCreate={canAny(actor, "activities", ["create", "create_own"])}
          canEdit={canAny(actor, "activities", ["update", "update_own"])}
          canDelete={can(actor, "activities", "delete")}
        />
      </Suspense>
    </Stack>
  );
}
