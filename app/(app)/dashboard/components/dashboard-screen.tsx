import type { CurrentSession } from "@/lib/auth/session";
import { getDashboardDataset } from "@/lib/dashboard/data";
import type { DashboardFilters } from "@/lib/dashboard/compute";
import { hasFeature } from "@/lib/rbac/features";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { DashboardView } from "./dashboard-view";

export interface DashboardScreenProps {
  session: CurrentSession;
  actor: PermissionActor;
  initialFilters: DashboardFilters;
}

/**
 * Data-fetching half of the dashboard, rendered inside the page's `Suspense`
 * boundary so the hero paints immediately and the skeleton streams in place
 * of the widgets. Fetches one bounded dataset under the caller's RLS and hands
 * it to the client-side cross-filtering view.
 */
export async function DashboardScreen({ session, actor, initialFilters }: DashboardScreenProps) {
  const organization = session.organization;
  const [dataset, clientsOn, assetsOn] = await Promise.all([
    getDashboardDataset(session, actor),
    organization ? hasFeature(organization, "clients") : false,
    organization ? hasFeature(organization, "assets") : false,
  ]);

  return (
    <DashboardView
      dataset={dataset}
      initialFilters={initialFilters}
      links={{
        clients: clientsOn && can(actor, "clients", "read"),
        assets: assetsOn && can(actor, "assets", "read"),
        workOrders: dataset.visible.workOrders,
        activities: dataset.visible.activities,
      }}
    />
  );
}
