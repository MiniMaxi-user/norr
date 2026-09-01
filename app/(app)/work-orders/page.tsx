import { Suspense } from "react";
import { notFound } from "next/navigation";
import { OverviewHeroBand, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, canAny, type PermissionActor } from "@/lib/rbac/permissions";
import { WorkOrdersScreen } from "./components/work-orders-screen";
import { WorkOrdersScreenSkeleton } from "./components/work-orders-screen-skeleton";

export const metadata = { title: "Work Orders" };

interface WorkOrdersPageProps {
  searchParams: Promise<{ page?: string }>;
}

/**
 * Work Orders module entry point (issue #13 frontend half) — mirrors
 * `app/(app)/assets/page.tsx`'s shape exactly: Server Component resolving
 * session/entitlement/RBAC once, handing everything data-dependent to a
 * screen component behind `Suspense` so the page shell paints immediately.
 *
 * A plain paginated list view, deliberately not a view-switcher — this
 * task's scope is the Work Order *entity* (list/detail/create/edit); the
 * calendar/kanban/drag-and-drop Planning/Dispatch board named in
 * docs/ROADMAP.md is separate, larger, follow-on work.
 *
 * Per docs/ARCHITECTURE.md ("a module/view that isn't entitled for the
 * tenant must not render, not just be disabled"): `hasFeature()` is checked
 * here, before anything module-specific renders, and `notFound()`s
 * otherwise — same gate `app/(app)/work-orders/actions.ts` applies server-
 * action-side via `requireModuleContext`.
 */
export default async function WorkOrdersPage({ searchParams }: WorkOrdersPageProps) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "planning"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "planning")) notFound();

  const params = await searchParams;
  const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);

  return (
    <Stack gap="lg">
      <OverviewHeroBand title="Work Orders" subtitle="Jobs dispatched to your team, across every client and site." />

      <Suspense key={`${page}`} fallback={<WorkOrdersScreenSkeleton />}>
        <WorkOrdersScreen
          page={page}
          canCreate={can(actor, "planning", "create")}
          canEdit={canAny(actor, "planning", ["update", "update_own"])}
          canDelete={can(actor, "planning", "delete")}
        />
      </Suspense>
    </Stack>
  );
}
