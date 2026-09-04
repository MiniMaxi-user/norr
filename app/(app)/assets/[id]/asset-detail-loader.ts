import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, canAny, type PermissionActor } from "@/lib/rbac/permissions";
import { getAsset } from "../actions";
import { getClient } from "@/app/(app)/clients/actions";
import { listWorkOrders } from "@/app/(app)/work-orders/actions";
import { countContractsForAsset } from "@/app/(app)/contracts/actions";
import { listActivities } from "@/app/(app)/activities/actions";
import type { RecentAssetActivityItem } from "../components/asset-recent-activities";
import type { AssetScreenProps } from "../components/asset-screen";

/** Both the "Recent activities" feed's row count and the per-source fetch
 * limit — five of each source is plenty to always have five real rows after
 * merging/sorting/truncating (`[id]/page.tsx`/`edit/page.tsx` never need
 * more than this many for a summary feed, unlike the module's own paginated
 * list views). */
const RECENT_ITEMS_LIMIT = 5;

/**
 * Shared data-fetching + RBAC gating behind `/assets/[id]` and
 * `/assets/[id]/edit` — both routes render the exact same `AssetScreen` with
 * the exact same props (asset new/edit design handoff v3: "not a distinct
 * mode, just another route rendering it"), so this is the one place that
 * logic lives rather than being duplicated across both `page.tsx` files.
 */
export async function loadAssetScreenProps(
  id: string,
): Promise<Omit<AssetScreenProps, "breadcrumbItems" | "cancelHref">> {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "assets"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "assets")) notFound();

  const assetResult = await getAsset(id);
  if (!assetResult.data) notFound();
  const asset = assetResult.data.asset;

  const clientResult = await getClient(asset.client_id);
  const client = clientResult.data?.client ?? null;
  const site = clientResult.data?.sites.find((candidate) => candidate.id === asset.site_id) ?? null;

  const canEdit = can(actor, "assets", "update") || can(actor, "assets", "update_own");
  const canDelete = can(actor, "assets", "delete");

  // "New activity" entry point (issue #59) — a separately-entitled module,
  // gated the same way every other cross-module surface on this page is
  // (checked here, before rendering, not just disabled).
  const canCreateActivityFromAsset =
    (await hasFeature(session.organization, "activities")) &&
    canAccessModule(actor, "activities") &&
    canAny(actor, "activities", ["create", "create_own"]);

  const canSeeWorkOrders =
    (await hasFeature(session.organization, "planning")) &&
    canAccessModule(actor, "planning") &&
    canAny(actor, "planning", ["read", "read_own"]);
  const canSeeContracts =
    (await hasFeature(session.organization, "contracts")) &&
    canAccessModule(actor, "contracts") &&
    canAny(actor, "contracts", ["read"]);
  const activitiesEnabled = await hasFeature(session.organization, "activities");
  const canSeeActivities =
    activitiesEnabled && canAccessModule(actor, "activities") && canAny(actor, "activities", ["read", "read_own"]);

  const [workOrdersResult, contractCountResult, activitiesResult] = await Promise.all([
    canSeeWorkOrders ? listWorkOrders({ assetId: asset.id, limit: RECENT_ITEMS_LIMIT }) : Promise.resolve(null),
    canSeeContracts ? countContractsForAsset(asset.id) : Promise.resolve(null),
    canSeeActivities ? listActivities({ assetId: asset.id, limit: RECENT_ITEMS_LIMIT }) : Promise.resolve(null),
  ]);

  const recentItems: RecentAssetActivityItem[] = [
    ...(activitiesResult?.data?.activities ?? []).map((activity) => ({
      key: `activity-${activity.id}`,
      kind: "activity" as const,
      href: `/activities/${activity.id}`,
      title: activity.description,
      date: activity.reported_at,
    })),
    ...(workOrdersResult?.data?.workOrders ?? []).map((workOrder) => ({
      key: `workorder-${workOrder.id}`,
      kind: "workorder" as const,
      href: `/work-orders/${workOrder.id}`,
      title: workOrder.title,
      date: workOrder.scheduled_at ?? workOrder.created_at,
    })),
  ]
    .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
    .slice(0, RECENT_ITEMS_LIMIT);

  return {
    mode: "edit",
    asset,
    client,
    site,
    readOnly: !canEdit,
    canDelete,
    canCreateActivityFromAsset,
    workOrderCount: workOrdersResult?.data?.count ?? 0,
    contractCount: contractCountResult?.data?.count ?? 0,
    activityCount: activitiesResult?.data?.count ?? 0,
    recentItems,
    // The asset's own client's Activities tab isn't asset-filtered (that tab
    // has no `?assetId=` scoping of its own today), but it's the closest
    // honest destination — `/assets/[id]` itself has no tabs to link into,
    // per this component's own doc comment.
    viewAllHref: canSeeActivities ? `/clients/${asset.client_id}?tab=activities` : undefined,
  };
}
