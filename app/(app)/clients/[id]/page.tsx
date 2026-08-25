import { Suspense } from "react";
import { BackLink, Heading, Stack, Text } from "@yourorg/ui";
import { requireSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { getClient } from "../actions";
import { listContacts } from "../contacts-actions";
import { getTenantAccessStatus } from "../platform-access-actions";
import { listAssets } from "@/app/(app)/assets/actions";
import { listWorkOrders } from "@/app/(app)/work-orders/actions";
import { listContracts } from "@/app/(app)/contracts/actions";
import { listQuotes } from "@/app/(app)/quotes/actions";
import { ClientDetail, type ClientDetailTab } from "./client-detail";
import { ClientDetailSkeleton } from "./client-detail-skeleton";
import { CLIENT_DETAIL_VIEW_KEY } from "./constants";

/** High enough for "every asset across this client's sites" to render in one
 * request without pagination — a client detail page is a bounded, per-record
 * view, not the org-wide Assets list (which does paginate). Matches the
 * existing map-view fetch limit convention in `assets-screen.tsx`. */
const ALL_CLIENT_ASSETS_LIMIT = 500;

/** Same reasoning as `ALL_CLIENT_ASSETS_LIMIT` above, for the read-only Work
 * Orders tab. */
const ALL_CLIENT_WORK_ORDERS_LIMIT = 500;

/** Same reasoning as `ALL_CLIENT_ASSETS_LIMIT` above, for the read-only
 * Contracts tab (issue #33). */
const ALL_CLIENT_CONTRACTS_LIMIT = 500;

/** Same reasoning as `ALL_CLIENT_ASSETS_LIMIT` above, for the read-only
 * Quotes tab (issue #16). */
const ALL_CLIENT_QUOTES_LIMIT = 500;

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

  // Issue #45: the "Access"/"Modules" tabs are platform-admin-only, and only
  // once this client has actually been activated as a tenant
  // (`represents_organization_id` set) — same visibility rule `ClientDetail`
  // itself re-derives for the tab triggers/panels, computed here too since it
  // gates whether `getTenantAccessStatus` below is worth calling at all.
  const tenantAccessVisible = session.isPlatformAdmin && Boolean(result.data.client.represents_organization_id);

  // The Assets tab is itself a view onto the (separately-entitled) Assets
  // module — per docs/ARCHITECTURE.md, a module that isn't entitled/
  // accessible to this actor must not render, not just be shown disabled, so
  // this is resolved server-side, before any asset data is fetched, exactly
  // like `app/(app)/assets/page.tsx` does for the standalone module route.
  const assetsModuleVisible =
    Boolean(session.organization) &&
    (await hasFeature(session.organization, "assets")) &&
    canAccessModule(actor, "assets");

  // The Work Orders tab is likewise a view onto a separately-entitled module
  // (issue #13) — gated server-side the same way as Assets above, before any
  // work order data is fetched, so a tenant/role without Planning access
  // never sees the tab render at all (not just disabled).
  const workOrdersModuleVisible =
    Boolean(session.organization) &&
    (await hasFeature(session.organization, "planning")) &&
    canAccessModule(actor, "planning");

  // The Contracts tab is likewise a view onto a separately-entitled module
  // (issue #33) — gated server-side the same way as Assets/Work Orders
  // above, before any contract data is fetched, so a tenant/role without
  // Contracts access never sees the tab render at all (not just disabled).
  const contractsModuleVisible =
    Boolean(session.organization) &&
    (await hasFeature(session.organization, "contracts")) &&
    canAccessModule(actor, "contracts");

  // The Quotes tab is likewise a view onto a separately-entitled module
  // (issue #16) — gated server-side the same way as Assets/Work Orders/
  // Contracts above, before any quote data is fetched, so a tenant/role
  // without Quotes access never sees the tab render at all (not just
  // disabled).
  const quotesModuleVisible =
    Boolean(session.organization) &&
    (await hasFeature(session.organization, "quotes")) &&
    canAccessModule(actor, "quotes");

  // Contacts (issue #26) aren't a separately-entitled module — they're a
  // sub-entity of Clients (see `contacts-actions.ts`'s module comment) — so
  // unlike Assets/Work Orders/Contracts/Quotes, this data is always fetched
  // here rather than gated behind its own `hasFeature`/`canAccessModule`
  // check.
  const [assetsResult, contactsResult, contactRolesResult, workOrdersResult, contractsResult, quotesResult, lastUsedTab] =
    await Promise.all([
      assetsModuleVisible
        ? listAssets({ clientId: id, limit: ALL_CLIENT_ASSETS_LIMIT })
        : Promise.resolve(null),
      listContacts(id),
      listReferenceItems("contact_role"),
      workOrdersModuleVisible
        ? listWorkOrders({ clientId: id, limit: ALL_CLIENT_WORK_ORDERS_LIMIT })
        : Promise.resolve(null),
      contractsModuleVisible
        ? listContracts({ clientId: id, limit: ALL_CLIENT_CONTRACTS_LIMIT })
        : Promise.resolve(null),
      quotesModuleVisible
        ? listQuotes({ clientId: id, limit: ALL_CLIENT_QUOTES_LIMIT })
        : Promise.resolve(null),
      preferencesStore.getLastUsedView(session.userId, CLIENT_DETAIL_VIEW_KEY),
    ]);

  // Access-status lookup (issue #45): only run once the "Access" tab could
  // actually be visible (see `tenantAccessVisible` above) — same
  // conditional-fetch discipline every other entitlement-gated tab on this
  // page already follows. Runs after the `Promise.all` above (rather than
  // inside it) since it needs `contactsResult`'s emails as input. Fetched
  // server-side, not via a client `useEffect`, because `Tabs.Panel`
  // unmounts/remounts on every tab switch (`packages/ui/src/tabs.tsx`) — a
  // `useEffect` fetch in the panel would re-run (and flicker) every time an
  // admin reselects this tab, and a Server Action can't run at render time
  // anyway. This keeps the same "everything this page needs is fetched once,
  // up front, and handed down as props" convention every other tab already
  // uses.
  const accessStatusResult = tenantAccessVisible
    ? await getTenantAccessStatus(
        id,
        (contactsResult.data?.contacts ?? [])
          .map((contact) => contact.email)
          .filter((email): email is string => Boolean(email)),
      )
    : null;

  const requestedTab = lastUsedTab as ClientDetailTab | null;
  const defaultTab: ClientDetailTab =
    requestedTab === "assets" && assetsModuleVisible
      ? "assets"
      : requestedTab === "contacts"
        ? "contacts"
        : requestedTab === "workOrders" && workOrdersModuleVisible
          ? "workOrders"
          : requestedTab === "contracts" && contractsModuleVisible
            ? "contracts"
            : requestedTab === "quotes" && quotesModuleVisible
              ? "quotes"
              : requestedTab === "access" && tenantAccessVisible
                ? "access"
                : requestedTab === "modules" && tenantAccessVisible
                  ? "modules"
                  : "sites";

  return (
    <ClientDetail
      client={result.data.client}
      sites={result.data.sites}
      canWrite={canWrite}
      assets={assetsResult?.data?.assets ?? []}
      assetsEnabled={assetsModuleVisible}
      canCreateAssets={assetsModuleVisible && can(actor, "assets", "create")}
      canEditAssets={
        assetsModuleVisible && (can(actor, "assets", "update") || can(actor, "assets", "update_own"))
      }
      canDeleteAssets={assetsModuleVisible && can(actor, "assets", "delete")}
      contacts={contactsResult.data?.contacts ?? []}
      contactRoles={contactRolesResult.data?.items ?? []}
      workOrders={workOrdersResult?.data?.workOrders ?? []}
      workOrdersEnabled={workOrdersModuleVisible}
      contracts={contractsResult?.data?.contracts ?? []}
      contractsEnabled={contractsModuleVisible}
      quotes={quotesResult?.data?.quotes ?? []}
      quotesEnabled={quotesModuleVisible}
      isPlatformAdmin={session.isPlatformAdmin}
      accessStatusByEmail={accessStatusResult?.data?.statusByEmail ?? null}
      defaultTab={defaultTab}
    />
  );
}
