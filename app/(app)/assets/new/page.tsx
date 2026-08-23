import { notFound } from "next/navigation";
import { Breadcrumbs, Heading, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { AssetForm } from "../components/asset-form";

export const metadata = { title: "Add asset" };

interface NewAssetPageProps {
  searchParams: Promise<{ clientId?: string; siteId?: string }>;
}

/**
 * Full-page asset create form (docs/ARCHITECTURE.md "Popup vs. full page —
 * pick by weight, not habit") — replaces the old `AssetFormDialog` opened
 * from the Assets list toolbar/empty state and the Clients detail page's
 * Assets tab.
 *
 * In-context pre-scoping: arriving with `?clientId=...` (the Clients detail
 * page's "Add asset" button, see `create-asset-button.tsx`) locks the
 * client picker exactly like the old dialog's `lockedClientId` did; an
 * additional `?siteId=...` pre-selects (without locking) the site. Both are
 * read server-side here and passed straight into `AssetForm`.
 */
export default async function NewAssetPage({ searchParams }: NewAssetPageProps) {
  const { clientId, siteId } = await searchParams;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "assets"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "assets")) notFound();
  if (!can(actor, "assets", "create")) notFound();

  const [clientsResult, lockedClientResult, assetTypesResult, assetStatusesResult, assetSubtypesResult] =
    await Promise.all([
      clientId ? Promise.resolve(null) : listClients({ limit: 200 }),
      clientId ? getClient(clientId) : Promise.resolve(null),
      listReferenceItems("asset_type"),
      listReferenceItems("asset_status"),
      listReferenceItems("asset_subtype"),
    ]);

  if (clientId && !lockedClientResult?.data) notFound();

  const clients = clientsResult?.data?.clients ?? [];
  const lockedClient = lockedClientResult?.data?.client ?? null;
  const assetTypes = assetTypesResult.data?.items ?? [];
  const assetStatuses = assetStatusesResult.data?.items ?? [];
  const assetSubtypes = assetSubtypesResult.data?.items ?? [];

  const breadcrumbItems = lockedClient
    ? [
        { label: "Clients", href: "/clients" },
        { label: lockedClient.name, href: `/clients/${lockedClient.id}` },
        { label: "Add asset" },
      ]
    : [{ label: "Assets", href: "/assets" }, { label: "Add asset" }];

  const cancelHref = lockedClient ? `/clients/${lockedClient.id}` : "/assets";

  return (
    <Stack gap="lg">
      <Breadcrumbs items={breadcrumbItems} />
      <Heading level={1}>Add asset</Heading>
      <AssetForm
        mode="create"
        clients={clients}
        lockedClientId={lockedClient?.id}
        initialSiteId={siteId}
        assetTypes={assetTypes}
        assetStatuses={assetStatuses}
        assetSubtypes={assetSubtypes}
        cancelHref={cancelHref}
      />
    </Stack>
  );
}
