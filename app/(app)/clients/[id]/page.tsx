import { Suspense } from "react";
import { BackLink, Heading, Stack, Text } from "@yourorg/ui";
import { requireSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { getClient } from "../actions";
import { listContacts } from "../contacts-actions";
import { listAssets } from "@/app/(app)/assets/actions";
import { ClientDetail, type ClientDetailTab } from "./client-detail";
import { ClientDetailSkeleton } from "./client-detail-skeleton";
import { CLIENT_DETAIL_VIEW_KEY } from "./constants";

/** High enough for "every asset across this client's sites" to render in one
 * request without pagination — a client detail page is a bounded, per-record
 * view, not the org-wide Assets list (which does paginate). Matches the
 * existing map-view fetch limit convention in `assets-screen.tsx`. */
const ALL_CLIENT_ASSETS_LIMIT = 500;

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense fallback={<ClientDetailSkeleton />}>
      <ClientDetailContent id={id} />
    </Suspense>
  );
}

async function ClientDetailContent({ id }: { id: string }) {
  const session = await requireSession();
  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };

  const result = await getClient(id);

  if (result.error || !result.data) {
    return (
      <Stack gap="sm">
        <Heading level={1}>Client not found</Heading>
        <Text tone="danger">{result.error ?? "Could not load this client."}</Text>
        <BackLink href="/clients">Back to clients</BackLink>
      </Stack>
    );
  }

  const canWrite = can(actor, "clients", "update");

  // The Assets tab is itself a view onto the (separately-entitled) Assets
  // module — per docs/ARCHITECTURE.md, a module that isn't entitled/
  // accessible to this actor must not render, not just be shown disabled, so
  // this is resolved server-side, before any asset data is fetched, exactly
  // like `app/(app)/assets/page.tsx` does for the standalone module route.
  const assetsModuleVisible =
    Boolean(session.organization) &&
    (await hasFeature(session.organization, "assets")) &&
    canAccessModule(actor, "assets");

  // Contacts (issue #26) aren't a separately-entitled module — they're a
  // sub-entity of Clients (see `contacts-actions.ts`'s module comment) — so
  // unlike Assets, this data is always fetched here rather than gated behind
  // its own `hasFeature`/`canAccessModule` check.
  const [
    assetsResult,
    assetTypesResult,
    assetStatusesResult,
    assetSubtypesResult,
    contactsResult,
    contactRolesResult,
    lastUsedTab,
  ] = await Promise.all([
    assetsModuleVisible
      ? listAssets({ clientId: id, limit: ALL_CLIENT_ASSETS_LIMIT })
      : Promise.resolve(null),
    assetsModuleVisible ? listReferenceItems("asset_type") : Promise.resolve(null),
    assetsModuleVisible ? listReferenceItems("asset_status") : Promise.resolve(null),
    assetsModuleVisible ? listReferenceItems("asset_subtype") : Promise.resolve(null),
    listContacts(id),
    listReferenceItems("contact_role"),
    preferencesStore.getLastUsedView(session.userId, CLIENT_DETAIL_VIEW_KEY),
  ]);

  const requestedTab = lastUsedTab as ClientDetailTab | null;
  const defaultTab: ClientDetailTab =
    requestedTab === "assets" && assetsModuleVisible
      ? "assets"
      : requestedTab === "contacts"
        ? "contacts"
        : "sites";

  return (
    <ClientDetail
      client={result.data.client}
      sites={result.data.sites}
      canWrite={canWrite}
      assets={assetsResult?.data?.assets ?? []}
      assetsEnabled={assetsModuleVisible}
      assetTypes={assetTypesResult?.data?.items ?? []}
      assetStatuses={assetStatusesResult?.data?.items ?? []}
      assetSubtypes={assetSubtypesResult?.data?.items ?? []}
      canCreateAssets={assetsModuleVisible && can(actor, "assets", "create")}
      canEditAssets={
        assetsModuleVisible && (can(actor, "assets", "update") || can(actor, "assets", "update_own"))
      }
      canDeleteAssets={assetsModuleVisible && can(actor, "assets", "delete")}
      contacts={contactsResult.data?.contacts ?? []}
      contactRoles={contactRolesResult.data?.items ?? []}
      defaultTab={defaultTab}
    />
  );
}
