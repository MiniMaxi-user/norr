import { notFound } from "next/navigation";
import { Breadcrumbs, Heading, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getAsset } from "../../actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { AssetForm } from "../../components/asset-form";

export const metadata = { title: "Edit asset" };

interface EditAssetPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Full-page asset edit form (docs/ARCHITECTURE.md "Popup vs. full page —
 * pick by weight, not habit") — replaces the old `AssetFormDialog` opened
 * from the Assets list row action, the Clients detail page's Assets tab
 * table, and the asset detail page's "Edit" action.
 */
export default async function EditAssetPage({ params }: EditAssetPageProps) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "assets"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "assets")) notFound();
  if (!can(actor, "assets", "update") && !can(actor, "assets", "update_own")) notFound();

  const [assetResult, clientsResult, assetTypesResult, assetStatusesResult, assetSubtypesResult] = await Promise.all([
    getAsset(id),
    listClients({ limit: 200 }),
    listReferenceItems("asset_type"),
    listReferenceItems("asset_status"),
    listReferenceItems("asset_subtype"),
  ]);
  if (!assetResult.data) notFound();
  const asset = assetResult.data.asset;

  const clients = clientsResult.data?.clients ?? [];
  const assetTypes = assetTypesResult.data?.items ?? [];
  const assetStatuses = assetStatusesResult.data?.items ?? [];
  const assetSubtypes = assetSubtypesResult.data?.items ?? [];

  const clientResult = await getClient(asset.client_id);
  const client = clientResult.data?.client ?? null;

  const breadcrumbItems = client
    ? [
        { label: "Clients", href: "/clients" },
        { label: client.name, href: `/clients/${client.id}` },
        { label: asset.name, href: `/assets/${asset.id}` },
        { label: "Edit" },
      ]
    : [{ label: "Assets", href: "/assets" }, { label: asset.name, href: `/assets/${asset.id}` }, { label: "Edit" }];

  return (
    <Stack gap="lg">
      <Breadcrumbs items={breadcrumbItems} />
      <Heading level={1}>Edit {asset.name}</Heading>
      <AssetForm
        mode="edit"
        asset={asset}
        clients={clients}
        assetTypes={assetTypes}
        assetStatuses={assetStatuses}
        assetSubtypes={assetSubtypes}
        cancelHref={`/assets/${asset.id}`}
      />
    </Stack>
  );
}
