import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, canAny, can, type PermissionActor } from "@/lib/rbac/permissions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { getAsset } from "@/app/(app)/assets/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { ActivityScreen } from "../components/activity-screen";

export const metadata = { title: "New activity" };

interface NewActivityPageProps {
  searchParams: Promise<{ clientId?: string; assetId?: string }>;
}

/**
 * Full-page activity create form (docs/ARCHITECTURE.md "Popup vs. full
 * page" — issue #118 moved Activities from the slide-in-panel carve-out
 * back to a top-level module's own real page, same tier as Work Orders).
 * Replaces the old `ActivityFormPanel` `mode: "create"` (deleted) and, one
 * level further back, the pre-panel `/activities/new?clientId=...`/
 * `?assetId=...` query-param shape this route restores (see the deleted
 * panel's own doc comment for that history).
 *
 * `?clientId=...` (the Client detail page's Activiteiten tab "+ Activity")
 * locks the client picker. `?assetId=...` (the Asset detail page's "New
 * activity") locks BOTH the client and the asset — the client is always
 * resolved from the asset's own `client_id`, never trusted as a separately
 * supplied query param, matching `resolveActivityClientId`'s server-side
 * source of truth in `../actions.ts`.
 *
 * Gated on `canAny(actor, "activities", ["create", "create_own"])` —
 * owner/planner (unscoped `create`) or an engineer (`create_own`, always
 * pinned to their own id as the action holder — see `initialActionHolderId`
 * below, mirroring `createActivity`'s own server-side pin).
 */
export default async function NewActivityPage({ searchParams }: NewActivityPageProps) {
  const { clientId, assetId } = await searchParams;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "activities"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "activities")) notFound();
  if (!canAny(actor, "activities", ["create", "create_own"])) notFound();

  const [lockedAssetResult, typesResult, statusesResult, membersResult] = await Promise.all([
    assetId ? getAsset(assetId) : Promise.resolve(null),
    listReferenceItems("activity_type"),
    listReferenceItems("activity_status"),
    listOrgMembers(),
  ]);

  if (assetId && !lockedAssetResult?.data) notFound();
  const lockedAsset = lockedAssetResult?.data?.asset ?? null;

  // An asset's own client is always the source of truth (see this page's own
  // doc comment) — a `?clientId=...` alongside `?assetId=...` is ignored in
  // favor of the resolved asset's `client_id`.
  const resolvedClientId = lockedAsset?.client_id ?? clientId;

  const [clientsResult, lockedClientResult] = await Promise.all([
    resolvedClientId ? Promise.resolve(null) : listClients({ limit: 200 }),
    resolvedClientId ? getClient(resolvedClientId) : Promise.resolve(null),
  ]);

  if (resolvedClientId && !lockedClientResult?.data) notFound();

  const clients = clientsResult?.data?.clients ?? [];
  const lockedClient = lockedClientResult?.data?.client ?? null;
  const activityTypes = typesResult.data?.items ?? [];
  const activityStatuses = statusesResult.data?.items ?? [];
  const members = membersResult.data?.members ?? [];

  const canAssignOthers = can(actor, "activities", "create");

  const breadcrumbItems = lockedClient
    ? [
        { label: "Clients", href: "/clients" },
        { label: lockedClient.name, href: `/clients/${lockedClient.id}` },
        { label: "New activity" },
      ]
    : [{ label: "Meldingen", href: "/activities" }, { label: "New activity" }];

  const cancelHref = lockedClient ? `/clients/${lockedClient.id}` : "/activities";

  return (
    <ActivityScreen
      mode="create"
      breadcrumbItems={breadcrumbItems}
      client={lockedClient}
      asset={lockedAsset}
      clients={clients}
      activityTypes={activityTypes}
      activityStatuses={activityStatuses}
      members={members}
      canAssignOthers={canAssignOthers}
      lockedClientId={lockedClient?.id}
      lockedAssetId={lockedAsset?.id}
      cancelHref={cancelHref}
      // Pins "Action holder" from the very first render for a caller who
      // can't assign others (an engineer, `create_own` only) — mirrors the
      // old panel's identical pin, resolved server-side here (`session.userId`)
      // since there's no self-fetched form-context round trip left to run it
      // in.
      initialActionHolderId={canAssignOthers ? undefined : session.userId}
    />
  );
}
