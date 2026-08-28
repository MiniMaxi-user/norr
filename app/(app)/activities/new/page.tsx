import { notFound } from "next/navigation";
import { Breadcrumbs, Heading, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, canAny, type PermissionActor } from "@/lib/rbac/permissions";
import { getAsset } from "@/app/(app)/assets/actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { ActivityForm } from "../components/activity-form";

export const metadata = { title: "New activity" };

interface NewActivityPageProps {
  searchParams: Promise<{ clientId?: string; assetId?: string }>;
}

/**
 * Full-page activity create form (docs/ARCHITECTURE.md "Popup vs. full
 * page" — Activities is a top-level module's own primary record, not one of
 * the Clients/Assets carve-outs). Two in-context entry points, per the
 * acceptance criteria:
 *  - `?clientId=...` — from a client (`ClientDetail`'s Activiteiten tab):
 *    locks the client picker.
 *  - `?assetId=...` — from an asset (`AssetDetailActions`): locks BOTH the
 *    client and the asset; the client is resolved here from the asset's own
 *    `client_id`, never a query param, mirroring `resolveActivityClientId`
 *    in `../actions.ts` (an asset's client is always the source of truth).
 * Arriving at `/activities/new` directly (the module's own "Add new")
 * shows a plain, unlocked client picker.
 */
export default async function NewActivityPage({ searchParams }: NewActivityPageProps) {
  const { clientId, assetId } = await searchParams;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "activities"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "activities")) notFound();
  if (!canAny(actor, "activities", ["create", "create_own"])) notFound();

  const [clientsResult, lockedClientByIdResult, assetResult, typesResult, statusesResult, membersResult] =
    await Promise.all([
      clientId || assetId ? Promise.resolve(null) : listClients({ limit: 200 }),
      clientId ? getClient(clientId) : Promise.resolve(null),
      assetId ? getAsset(assetId) : Promise.resolve(null),
      listReferenceItems("activity_type"),
      listReferenceItems("activity_status"),
      listOrgMembers(),
    ]);

  if (clientId && !lockedClientByIdResult?.data) notFound();
  if (assetId && !assetResult?.data) notFound();

  const lockedAsset = assetResult?.data?.asset ?? null;

  // When arriving from an asset, resolve ITS client (never a separately
  // supplied `clientId` — there isn't one on this path anyway, but this also
  // matches the server action's own trust boundary).
  const assetClientResult = lockedAsset ? await getClient(lockedAsset.client_id) : null;

  const lockedClient = lockedAsset ? (assetClientResult?.data?.client ?? null) : (lockedClientByIdResult?.data?.client ?? null);
  const lockedAssetSite = lockedAsset
    ? (assetClientResult?.data?.sites.find((site) => site.id === lockedAsset.site_id) ?? null)
    : null;

  const clients = clientsResult?.data?.clients ?? [];
  const activityTypes = typesResult.data?.items ?? [];
  const activityStatuses = statusesResult.data?.items ?? [];
  const members = membersResult.data?.members ?? [];

  const canAssignOthers = can(actor, "activities", "create");

  const breadcrumbItems = lockedAsset
    ? [
        { label: "Assets", href: "/assets" },
        { label: lockedAsset.name, href: `/assets/${lockedAsset.id}` },
        { label: "New activity" },
      ]
    : lockedClient
      ? [
          { label: "Clients", href: "/clients" },
          { label: lockedClient.name, href: `/clients/${lockedClient.id}` },
          { label: "New activity" },
        ]
      : [{ label: "Meldingen", href: "/activities" }, { label: "New activity" }];

  const redirectHref = lockedAsset
    ? `/assets/${lockedAsset.id}`
    : lockedClient
      ? `/clients/${lockedClient.id}`
      : "/activities";

  return (
    <Stack gap="lg">
      <Breadcrumbs items={breadcrumbItems} />
      <Heading level={1}>New activity</Heading>
      <ActivityForm
        mode="create"
        clients={clients}
        lockedClientId={lockedClient?.id}
        lockedClient={lockedClient}
        lockedAsset={lockedAsset}
        lockedAssetAddress={formatSiteAddressShort(lockedAssetSite)}
        activityTypes={activityTypes}
        activityStatuses={activityStatuses}
        members={members}
        currentUserId={session.userId}
        canAssignOthers={canAssignOthers}
        redirectHref={redirectHref}
      />
    </Stack>
  );
}
