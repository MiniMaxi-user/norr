import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, canAny, type PermissionActor } from "@/lib/rbac/permissions";
import { getAsset } from "../actions";
import { getClient } from "@/app/(app)/clients/actions";
import { AssetDetail } from "./asset-detail";

export const metadata = { title: "Asset details" };

interface AssetDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AssetDetailPage({ params }: AssetDetailPageProps) {
  const { id } = await params;

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

  // "New activity" entry point (issue #59, AC: "Activiteit kan vanaf een
  // asset gemaakt worden") — a separately-entitled module, gated the same
  // way every other cross-module surface on this page would be (checked
  // here, before rendering, not just disabled).
  const canCreateActivityFromAsset =
    Boolean(session.organization) &&
    (await hasFeature(session.organization, "activities")) &&
    canAccessModule(actor, "activities") &&
    canAny(actor, "activities", ["create", "create_own"]);

  return (
    <AssetDetail
      asset={asset}
      client={client}
      site={site}
      canEdit={canEdit}
      canDelete={canDelete}
      canCreateActivityFromAsset={canCreateActivityFromAsset}
    />
  );
}
