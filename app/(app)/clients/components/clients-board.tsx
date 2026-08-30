import { Text } from "@yourorg/ui";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { listAccountManagers } from "@/lib/account-managers/actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { listClients, listPrimarySitesForClients, type ClientRecord, type SiteRecord } from "../actions";
import { ClientsExplorer, type ClientsView } from "./clients-explorer";

export const CLIENTS_PAGE_SIZE = 25;

/**
 * "Adressen zijn zichtbaar op de klantenkaart" / "Primary adres is zichtbaar
 * in alle standaardoverzichten" (issue #41 redo): every standard client
 * overview (table, kanban) needs each client's primary site's address. One
 * bulk `listPrimarySitesForClients` call (issue #75) instead of a
 * `listSites` call per client — the Kanban view's `listClients({ limit:
 * 200 })` used to mean up to 200 separate round-trips here.
 */
async function fetchPrimarySiteByClientId(
  clients: ClientRecord[],
): Promise<Record<string, SiteRecord | null>> {
  const result = await listPrimarySitesForClients(clients.map((client) => client.id));
  const sitesByClientId = result.data?.sitesByClientId ?? {};
  const map: Record<string, SiteRecord | null> = {};
  for (const client of clients) {
    map[client.id] = sitesByClientId[client.id] ?? null;
  }
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

  const [result, accountManagersResult, articlesResult] = await Promise.all([
    defaultView === "kanban"
      ? listClients({ limit: 200 })
      : listClients({ limit: CLIENTS_PAGE_SIZE, offset }),
    // Fetched once here (any view), threaded down to `ClientsExplorer` and
    // on into both client forms (the "Account manager" picker, issue #58)
    // and `ClientsKanban` (each card's Account Manager row) — same
    // "fetch once server-side, pass down" convention `contactRoles` already
    // uses into `SiteFormDialog`.
    listAccountManagers(),
    // Issue #93: same "fetch once, pass down" convention as
    // `listAccountManagers` above — populates both client forms' "Rate"
    // section article pickers.
    listArticlesForSelect(),
  ]);

  if (result.error || !result.data) {
    return <Text tone="danger">{result.error ?? "Could not load clients."}</Text>;
  }

  const canWrite = can(actor, "clients", "create");
  const primarySiteByClientId = await fetchPrimarySiteByClientId(result.data.clients);
  const accountManagers = accountManagersResult.data?.accountManagers ?? [];
  const articles = articlesResult.data?.articles ?? [];

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
      articles={articles}
      // Server-computed "today" (`YYYY-MM-DD`) for `NewClientPanel`'s
      // "Client since" default (issue #58) — a deliberate choice to use the
      // server's own date rather than the visitor's local browser date (see
      // that panel's own doc comment).
      todayIso={new Date().toISOString().slice(0, 10)}
    />
  );
}
