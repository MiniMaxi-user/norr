import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { WebListSkeleton } from "@yourorg/ui/web";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { WorkOrdersList } from "./components/work-orders-list";
import type { WorkOrdersSearchParams } from "./components/work-orders-query";
import { REVIEW_STATUS_VALUES } from "./tabs";

export const metadata = { title: "Work Orders" };

/**
 * Work Orders module entry point (issue #13 frontend half, list-page shell of
 * issue #222) — same shape as `app/(app)/assets/page.tsx`: Server Component
 * resolving session/entitlement/RBAC once, handing everything data-dependent
 * to `WorkOrdersList` behind `Suspense` so the header paints immediately and
 * the table streams in behind a shaped `WebListSkeleton`. The `Suspense` is
 * deliberately not keyed on the filter params: the table changes the URL in a
 * transition, keeping the old rows on screen while the new page loads.
 *
 * A plain list, deliberately not a view-switcher — the calendar/kanban
 * Planning/Dispatch board lives in `app/(app)/planning`.
 *
 * Per docs/ARCHITECTURE.md ("a module/view that isn't entitled for the
 * tenant must not render, not just be disabled"): `hasFeature()` is checked
 * here, before anything module-specific renders, and `notFound()`s
 * otherwise — same gate `app/(app)/work-orders/actions.ts` applies server-
 * action-side via `requireModuleContext`.
 */
export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<WorkOrdersSearchParams> }) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "planning"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "planning")) notFound();

  const params = await searchParams;

  // Legacy Review / Orders / Completed deep links (issue #207) map onto the
  // Open / Done / All toggle and the Status dropdown.
  if (params.tab !== undefined) {
    const next = new URLSearchParams();
    if (params.tab === "completed") next.set("seg", "done");
    else if (params.tab === "review") {
      const statuses = await listReferenceItems("work_order_status");
      const review = (statuses.data?.items ?? []).find((item) =>
        (REVIEW_STATUS_VALUES as readonly string[]).includes(item.value),
      );
      next.set("seg", "all");
      if (review) next.set("status", review.id);
    }
    const query = next.toString();
    redirect(query ? `/work-orders?${query}` : "/work-orders");
  }

  return (
    <Suspense fallback={<WebListSkeleton module="Work orders" title="Work orders" columns={7} />}>
      <WorkOrdersList
        params={params}
        canCreate={can(actor, "planning", "create")}
        canDelete={can(actor, "planning", "delete")}
      />
    </Suspense>
  );
}
