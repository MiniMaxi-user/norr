import { Text } from "@yourorg/ui";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { listAccountManagers } from "@/lib/account-managers/actions";
import { listClients, listSites, type ClientRecord, type SiteRecord } from "./actions";
import { ClientsExplorer, type ClientsView } from "./clients-explorer";

export const CLIENTS_PAGE_SIZE = 25;

/**
 * "Adressen zijn zichtbaar op de klantenkaart" / "Primary adres is zichtbaar
 * in alle standaardoverzichten" (issue #41 redo): every standard client
 * overview (table, kanban) needs each client's primary site's address. There
 * is no bulk "clients with their primary site" query exposed by
 * `actions.ts` (deliberately not touched by this pass — flagged, not
 * guessed at), so this composes the existing per-client `listSites` action
 * across whichever clients were just fetched (`CLIENTS_PAGE_SIZE` for List,
 * up to 200 for Kanban — see `ClientsBoard` below, issue #58), same shape as
 * the `Promise.all` fan-outs already used elsewhere, e.g.
 * `app/(app)/clients/[id]/page.tsx`'s six-way `Promise.all`) rather than
 * adding a new bulk backend query.
 */
async function fetchPrimarySiteByClientId(
  clients: ClientRecord[],
): Promise<Record<string, SiteRecord | null>> {
  const results = await Promise.all(clients.map((client) => listSites(client.id)));
  const map: Record<string, SiteRecord | null> = {};
  clients.forEach((client, index) => {
    const sites = results[index]?.data?.sites ?? [];
    map[client.id] = sites.find((site) => site.is_primary) ?? null;
  });
  return map;
}

/**
 * Async Server Component doing the actual data fetch — rendered inside a
 * `Suspense` boundary from `page.tsx` so the page shell (heading, "Add
 * client" affordance) streams in immediately while this resolves behind
 * `ClientsSkeleton` (docs/ARCHITECTURE.md: "route-level streaming/Suspense").
 */
export async function ClientsBoard({
  page,
  userId,
  actor,
}: {
  page: number;
  userId: string;
  actor: PermissionActor;
}) {
  const offset = (page - 1) * CLIENTS_PAGE_SIZE;

  // The view is resolved from the user's last-used-view preference BEFORE
  // deciding how to fetch (issue #58): kanban needs the (near-)whole org
  // client list to group into its 4 status columns, not one paginated page
  // — see `listClients`'s call below. If the user then flips the in-page
  // `ViewToggle` to the other view without a full navigation, this fetch
  // strategy doesn't retroactively change; same already-documented
  // simplification `ClientsExplorer`'s own "NOTE on scope" doc comment
  // covers for the list/kanban split in general.
  const lastUsedView = await preferencesStore.getLastUsedView(userId, "clients");
  const defaultView: ClientsView = lastUsedView === "kanban" ? "kanban" : "list";

  const [result, accountManagersResult] = await Promise.all([
    defaultView === "kanban"
      ? listClients({ limit: 200 })
      : listClients({ limit: CLIENTS_PAGE_SIZE, offset }),
    // Fetched once here (any view), threaded down to `ClientsExplorer` and
    // on into both client forms (the "Account manager" picker, issue #58)
    // and `ClientsKanban` (each card's Account Manager row) — same
    // "fetch once server-side, pass down" convention `contactRoles` already
    // uses into `SiteFormDialog`.
    listAccountManagers(),
  ]);

  if (result.error || !result.data) {
    return <Text tone="danger">{result.error ?? "Could not load clients."}</Text>;
  }

  const canWrite = can(actor, "clients", "create");
  const primarySiteByClientId = await fetchPrimarySiteByClientId(result.data.clients);
  const accountManagers = accountManagersResult.data?.accountManagers ?? [];

  return (
    <ClientsExplorer
      clients={result.data.clients}
      count={result.data.count}
      page={page}
      pageSize={CLIENTS_PAGE_SIZE}
      canWrite={canWrite}
      defaultView={defaultView}
      primarySiteByClientId={primarySiteByClientId}
      accountManagers={accountManagers}
      // Server-computed "today" (`YYYY-MM-DD`) for `NewClientPanel`'s
      // "Client since" default (issue #58) — a deliberate choice to use the
      // server's own date rather than the visitor's local browser date (see
      // that panel's own doc comment).
      todayIso={new Date().toISOString().slice(0, 10)}
    />
  );
}
