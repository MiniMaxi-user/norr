import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, canAny, type PermissionActor } from "@/lib/rbac/permissions";
import { getAsset } from "../../actions";
import { listWorkOrders } from "@/app/(app)/work-orders/actions";
import { countContractsForAsset } from "@/app/(app)/contracts/actions";
import { listActivities } from "@/app/(app)/activities/actions";
import { AssetFormScreen, type AssetLinkedRecordsSummary } from "../../components/asset-form-screen";

export const metadata = { title: "Edit Asset" };

interface EditAssetPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Full-page asset edit form (asset new/edit design handoff, variant A) —
 * replaces the `AssetFormDialog` slide-in panel's `mode="edit"` render
 * (issue #53, reversed by the product owner this session; see
 * `docs/ARCHITECTURE.md`'s "Popup vs. full page" section).
 *
 * A caller without edit rights on THIS asset (per the same `canEdit`
 * derivation `[id]/page.tsx` uses — `update` OR `update_own`) is redirected
 * to the read-only detail page (`/assets/[id]`) rather than 404ing or
 * rendering a disabled form — that page is the actual answer for a viewer
 * who lands here (a stale bookmark, a shared link), not a dead end.
 *
 * "Linked records" counts (Work Orders/Contracts/Activities) are each gated
 * on that module's own feature flag + module access + read permission,
 * fetched only when all three hold — same "don't fetch/render what can't be
 * seen" rule `[id]/page.tsx`'s own `canCreateActivityFromAsset` already
 * follows, extended here to Work Orders/Contracts too.
 */
export default async function EditAssetPage({ params }: EditAssetPageProps) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "assets"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "assets")) notFound();

  const assetResult = await getAsset(id);
  if (!assetResult.data) notFound();
  const asset = assetResult.data.asset;

  const canEdit = can(actor, "assets", "update") || can(actor, "assets", "update_own");
  if (!canEdit) redirect(`/assets/${asset.id}`);

  const canDelete = can(actor, "assets", "delete");

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
  const canCreateActivity =
    activitiesEnabled && canAccessModule(actor, "activities") && canAny(actor, "activities", ["create", "create_own"]);

  const [workOrdersResult, contractsCountResult, activitiesResult] = await Promise.all([
    canSeeWorkOrders ? listWorkOrders({ assetId: asset.id, limit: 1 }) : Promise.resolve(null),
    canSeeContracts ? countContractsForAsset(asset.id) : Promise.resolve(null),
    canSeeActivities ? listActivities({ assetId: asset.id, limit: 1 }) : Promise.resolve(null),
  ]);

  const linkedRecords: AssetLinkedRecordsSummary = {
    canSeeWorkOrders,
    workOrderCount: workOrdersResult?.data?.count ?? 0,
    canSeeContracts,
    contractCount: contractsCountResult?.data?.count ?? 0,
    canSeeActivities,
    activityCount: activitiesResult?.data?.count ?? 0,
    canCreateActivity,
  };

  return (
    <AssetFormScreen
      mode="edit"
      breadcrumbItems={[{ label: "Assets", href: "/assets" }, { label: asset.name }]}
      asset={asset}
      cancelHref={`/assets/${asset.id}`}
      canDelete={canDelete}
      linkedRecords={linkedRecords}
    />
  );
}
