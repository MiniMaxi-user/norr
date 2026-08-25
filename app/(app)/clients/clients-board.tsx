import { Text } from "@yourorg/ui";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
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
 * across the current page's clients (bounded to `CLIENTS_PAGE_SIZE`, same
 * shape as the `Promise.all` fan-outs already used elsewhere, e.g.
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

  const [result, lastUsedView] = await Promise.all([
    listClients({ limit: CLIENTS_PAGE_SIZE, offset }),
    preferencesStore.getLastUsedView(userId, "clients"),
  ]);

  if (result.error || !result.data) {
    return <Text tone="danger">{result.error ?? "Could not load clients."}</Text>;
  }

  const canWrite = can(actor, "clients", "create");
  const defaultView: ClientsView = lastUsedView === "kanban" ? "kanban" : "list";
  const primarySiteByClientId = await fetchPrimarySiteByClientId(result.data.clients);

  return (
    <ClientsExplorer
      clients={result.data.clients}
      count={result.data.count}
      page={page}
      pageSize={CLIENTS_PAGE_SIZE}
      canWrite={canWrite}
      defaultView={defaultView}
      primarySiteByClientId={primarySiteByClientId}
    />
  );
}
