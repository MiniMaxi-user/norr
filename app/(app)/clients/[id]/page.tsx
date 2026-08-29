import { Suspense } from "react";
import { BackLink, Heading, Stack, Text } from "@yourorg/ui";
import { requireSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, canAny, type PermissionActor } from "@/lib/rbac/permissions";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listAccountManagers } from "@/lib/account-managers/actions";
import { getClient } from "../actions";
import { listContacts } from "../contacts-actions";
import { getTenantAccessStatus } from "../platform-access-actions";
import { listActivities } from "@/app/(app)/activities/actions";
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

/** Same reasoning as `ALL_CLIENT_ASSETS_LIMIT` above, for the Activiteiten
 * tab (issue #59). */
const ALL_CLIENT_ACTIVITIES_LIMIT = 500;

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
  // (`represents_organization_id` set).
  //
  // Issue #47: on top of that, the tenant must currently be ACTIVE
  // (`organization_is_active === true`), not merely activated-and-then-
  // deactivated — once a tenant is deactivated its users can no longer log
  // in at all, so managing their login access/modules is meaningless until
  // it's reactivated. Hidden outright rather than shown disabled, which also
  // means the `getTenantAccessStatus` lookup below is skipped for a
  // deactivated org's contacts (nothing meaningful for it to return). Same
  // condition `ClientDetail` itself re-derives for the tab triggers/panels
  // (`tenantAccessVisible` there) — keep both in sync.
  const tenantAccessVisible = session.isPlatformAdmin && result.data.client.organization_is_active === true;

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

  // The Activiteiten tab is likewise a view onto a separately-entitled
  // module (issue #59) — gated server-side the same way as Assets/Work
  // Orders/Contracts/Quotes above, before any activity data is fetched, so a
  // tenant/role without Activities access never sees the tab render at all
  // (not just disabled).
  const activitiesModuleVisible =
    Boolean(session.organization) &&
    (await hasFeature(session.organization, "activities")) &&
    canAccessModule(actor, "activities");

  // "Create work order" action on the Activiteiten tab's quick-view dialog
  // (issue #87) — a Planning affordance, gated independently of
  // `activitiesModuleVisible` above (an org could have Activities without
  // Planning, or vice versa; both must hold for this action to make sense).
  const canCreateWorkOrder =
    workOrdersModuleVisible && can(actor, "planning", "create");

  // Contacts (issue #26) aren't a separately-entitled module — they're a
  // sub-entity of Clients (see `contacts-actions.ts`'s module comment) — so
  // unlike Assets/Work Orders/Contracts/Quotes, this data is always fetched
  // here rather than gated behind its own `hasFeature`/`canAccessModule`
  // check.
  const [
    assetsResult,
    contactsResult,
    contactRolesResult,
    workOrdersResult,
    contractsResult,
    quotesResult,
    activitiesResult,
    lastUsedTab,
    accountManagersResult,
  ] = await Promise.all([
    assetsModuleVisible ? listAssets({ clientId: id, limit: ALL_CLIENT_ASSETS_LIMIT }) : Promise.resolve(null),
    listContacts(id),
    listReferenceItems("contact_role"),
    workOrdersModuleVisible
      ? listWorkOrders({ clientId: id, limit: ALL_CLIENT_WORK_ORDERS_LIMIT })
      : Promise.resolve(null),
    contractsModuleVisible
      ? listContracts({ clientId: id, limit: ALL_CLIENT_CONTRACTS_LIMIT })
      : Promise.resolve(null),
    quotesModuleVisible ? listQuotes({ clientId: id, limit: ALL_CLIENT_QUOTES_LIMIT }) : Promise.resolve(null),
    activitiesModuleVisible
      ? listActivities({ clientId: id, limit: ALL_CLIENT_ACTIVITIES_LIMIT })
      : Promise.resolve(null),
    preferencesStore.getLastUsedView(session.userId, CLIENT_DETAIL_VIEW_KEY),
    // Issue #58: `EditClientPanel`'s "Account manager" picker, same
    // "fetch once, pass down" convention `contactRoles` above already uses.
    listAccountManagers(),
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
              : requestedTab === "activities" && activitiesModuleVisible
                ? "activities"
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
      activities={activitiesResult?.data?.activities ?? []}
      activitiesEnabled={activitiesModuleVisible}
      canCreateActivities={activitiesModuleVisible && canAny(actor, "activities", ["create", "create_own"])}
      canEditActivities={activitiesModuleVisible && canAny(actor, "activities", ["update", "update_own"])}
      canDeleteActivities={activitiesModuleVisible && can(actor, "activities", "delete")}
      canCreateWorkOrder={canCreateWorkOrder}
      isPlatformAdmin={session.isPlatformAdmin}
      accessStatusByEmail={accessStatusResult?.data?.statusByEmail ?? null}
      defaultTab={defaultTab}
      accountManagers={accountManagersResult.data?.accountManagers ?? []}
    />
  );
}
