import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, canAny, type PermissionActor } from "@/lib/rbac/permissions";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { getAsset } from "../actions";
import { getClient } from "@/app/(app)/clients/actions";
import { listWorkOrders } from "@/app/(app)/work-orders/actions";
import { listAssetContractCoverage } from "@/app/(app)/contracts/actions";
import { listActivities } from "@/app/(app)/activities/actions";
import { getAssetCompositionTree } from "../components-actions";
import { ASSET_DETAIL_VIEW_KEY } from "../components/constants";
import type { AssetDetailTab, AssetScreenProps } from "../components/asset-screen";
import { getAssetVolumes } from "@/lib/asset-volumes/actions";

/** High enough for "every work order/activity of this asset" in one request —
 * an asset page is a bounded, per-record view (same convention the client
 * detail page uses for its own tabs). */
const ALL_ASSET_ROWS_LIMIT = 500;

const TAB_IDS: AssetDetailTab[] = ["overview", "workOrders", "activities", "contracts", "structure", "volumes"];

/**
 * Shared data-fetching + RBAC gating behind `/assets/[id]` and
 * `/assets/[id]/edit` — both routes render the exact same `AssetScreen` with
 * the exact same props, so this is the one place that logic lives.
 *
 * Every related list (work orders, activities, contract coverage, volumes) is
 * fetched only when its module is entitled AND the actor may read it —
 * resolved here, before anything renders, so a tab the tenant/role can't use
 * never exists (not merely disabled). The composition tree is part of the
 * `assets` module itself.
 */
export async function loadAssetScreenProps(
  id: string,
  requestedTab?: string,
): Promise<Omit<AssetScreenProps, "cancelHref">> {
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

  const activitiesEnabled = await hasFeature(session.organization, "activities");
  const canCreateActivityFromAsset =
    activitiesEnabled && canAccessModule(actor, "activities") && canAny(actor, "activities", ["create", "create_own"]);
  const canSeeActivities =
    activitiesEnabled && canAccessModule(actor, "activities") && canAny(actor, "activities", ["read", "read_own"]);

  const planningEnabled = await hasFeature(session.organization, "planning");
  const canSeeWorkOrders =
    planningEnabled && canAccessModule(actor, "planning") && canAny(actor, "planning", ["read", "read_own"]);
  const canCreateWorkOrder = planningEnabled && canAccessModule(actor, "planning") && can(actor, "planning", "create");

  const canSeeContracts =
    (await hasFeature(session.organization, "contracts")) &&
    canAccessModule(actor, "contracts") &&
    canAny(actor, "contracts", ["read"]);

  // Volumes tab (issue #221): part of the `assets` feature (checked above);
  // only rendered when the actor can read asset_volumes.
  const canSeeVolumes = canAny(actor, "asset_volumes", ["read", "read_own"]);

  const [workOrdersResult, coverageResult, activitiesResult, volumesResult, treeResult, lastUsedTab] = await Promise.all([
    canSeeWorkOrders ? listWorkOrders({ assetId: asset.id, limit: ALL_ASSET_ROWS_LIMIT }) : Promise.resolve(null),
    canSeeContracts ? listAssetContractCoverage(asset.id) : Promise.resolve(null),
    canSeeActivities ? listActivities({ assetId: asset.id, limit: ALL_ASSET_ROWS_LIMIT }) : Promise.resolve(null),
    canSeeVolumes ? getAssetVolumes(asset.id) : Promise.resolve(null),
    getAssetCompositionTree(asset.id),
    preferencesStore.getLastUsedView(session.userId, ASSET_DETAIL_VIEW_KEY),
  ]);

  const volumes = volumesResult?.data ?? null;
  const workOrders = canSeeWorkOrders ? (workOrdersResult?.data?.workOrders ?? []) : null;
  const activities = canSeeActivities ? (activitiesResult?.data?.activities ?? []) : null;
  const contractCoverage = canSeeContracts ? (coverageResult?.data?.coverage ?? []) : null;

  // `?tab=` (explicit deep link, e.g. `?tab=volumes`) beats the last-used-view
  // cookie; either falls back to Overview when that tab does not exist for
  // this actor.
  const available = (rawTab: string | null | undefined): AssetDetailTab | null => {
    // "components" is the legacy value (tab renamed to Structure) that an old
    // last-used-view cookie may still hold.
    const tab = rawTab === "components" ? "structure" : rawTab;
    if (!tab || !TAB_IDS.includes(tab as AssetDetailTab)) return null;
    switch (tab as AssetDetailTab) {
      case "workOrders":
        return workOrders ? "workOrders" : null;
      case "activities":
        return activities ? "activities" : null;
      case "contracts":
        return contractCoverage ? "contracts" : null;
      case "volumes":
        return volumes ? "volumes" : null;
      case "structure":
        return "structure";
      default:
        return "overview";
    }
  };

  return {
    mode: "edit",
    asset,
    client,
    site,
    readOnly: !canEdit,
    canDelete,
    canCreateActivityFromAsset,
    canCreateWorkOrder,
    workOrders,
    activities,
    contractCoverage,
    tree: treeResult.data?.tree ?? null,
    volumes,
    defaultTab: available(requestedTab) ?? available(lastUsedTab) ?? "overview",
  };
}
