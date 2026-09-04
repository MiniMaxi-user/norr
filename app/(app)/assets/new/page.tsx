import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getClient } from "@/app/(app)/clients/actions";
import { AssetScreen } from "../components/asset-screen";

export const metadata = { title: "New Asset" };

interface NewAssetPageProps {
  searchParams: Promise<{ clientId?: string; siteId?: string }>;
}

/**
 * `mode: "create"` render of the shared `AssetScreen` (asset new/edit design
 * handoff v3) — replaces the old page-wide `<form>` variant. Gated on
 * `can(actor, "assets", "create")` — owner only, matching `createAsset`'s own
 * RBAC check (and the RLS INSERT policy) exactly.
 *
 * `?clientId=...` (the Clients detail page's Assets tab, via
 * `CreateAssetButton`) locks the Client relation card — same `lockedClientId`
 * semantics the previous passes used, now threaded through as a route param.
 * `?siteId=...` pre-selects (without locking) the site.
 */
export default async function NewAssetPage({ searchParams }: NewAssetPageProps) {
  const { clientId, siteId } = await searchParams;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "assets"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "assets")) notFound();
  if (!can(actor, "assets", "create")) notFound();

  const lockedClientResult = clientId ? await getClient(clientId) : null;
  if (clientId && !lockedClientResult?.data) notFound();
  const lockedClient = lockedClientResult?.data?.client ?? null;

  const breadcrumbItems = lockedClient
    ? [
        { label: "Clients", href: "/clients" },
        { label: lockedClient.name, href: `/clients/${lockedClient.id}` },
        { label: "New asset" },
      ]
    : [{ label: "Assets", href: "/assets" }, { label: "New asset" }];

  const cancelHref = lockedClient ? `/clients/${lockedClient.id}` : "/assets";

  return (
    <AssetScreen
      mode="create"
      breadcrumbItems={breadcrumbItems}
      client={lockedClient}
      lockedClientId={lockedClient?.id}
      initialSiteId={siteId}
      cancelHref={cancelHref}
    />
  );
}
