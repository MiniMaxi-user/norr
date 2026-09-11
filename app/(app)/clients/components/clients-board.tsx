import { Text } from "@yourorg/ui";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { listAccountManagers } from "@/lib/account-managers/actions";
import { listClients } from "../actions";
import type { ClientsView } from "./clients-hero-context";
import { ClientsExplorer } from "./clients-explorer";

export const CLIENTS_PAGE_SIZE = 25;

/**
 * Async Server Component doing the actual data fetch — rendered inside a
 * `Suspense` boundary from `page.tsx` so the page shell (`OverviewHeroBand`,
 * issue #142) streams in immediately while this resolves behind
 * `ClientsSkeleton` (docs/ARCHITECTURE.md: "route-level streaming/Suspense").
 */
export async function ClientsBoard({
  page,
  actor,
  defaultView,
}: {
  page: number;
  actor: PermissionActor;
  /** Resolved once in `page.tsx` from the user's last-used-view preference
   * (issue #142 — it's also needed there, synchronously, to seed
   * `ClientsHeroProvider`) and threaded down here rather than re-read.
   * Kanban needs the (near-)whole org client list to group into its 4
   * status columns, not one paginated page — see `listClients`'s call
   * below. If the user then flips the in-page `ViewToggle` to the other
   * view without a full navigation, this fetch strategy doesn't
   * retroactively change; same already-documented simplification
   * `ClientsExplorer`'s own "NOTE on scope" doc comment covers for the
   * list/kanban split in general. */
  defaultView: ClientsView;
}) {
  const offset = (page - 1) * CLIENTS_PAGE_SIZE;

  // "Adressen zijn zichtbaar op de klantenkaart" / "Primary adres is
  // zichtbaar in alle standaardoverzichten" (issue #41 redo): every standard
  // client overview (table, kanban) needs each client's primary site's
  // address. As of issue #148, that's folded into this same `listClients`
  // call via `includePrimarySite` (a single PostgREST embed over the
  // genuine `sites.client_id` FK) rather than a follow-up
  // `listPrimarySitesForClients` round-trip once `clients` resolves — see
  // that option's doc comment in `../actions.ts`. `listAccountManagers()`
  // has no dependency on either the view or the client list, so it starts
  // in the same `Promise.all` rather than after.
  const [result, accountManagersResult] = await Promise.all([
    defaultView === "kanban"
      ? listClients({ limit: 200, includePrimarySite: true })
      : listClients({ limit: CLIENTS_PAGE_SIZE, offset, includePrimarySite: true }),
    // Fetched once here (any view), threaded down to `ClientsExplorer` and
    // on into `ClientsKanban` (each card's Account Manager row) — same
    // "fetch once server-side, pass down" convention `contactRoles` already
    // uses into `SiteFormDialog`.
    listAccountManagers(),
  ]);

  if (result.error || !result.data) {
    return <Text tone="danger">{result.error ?? "Could not load clients."}</Text>;
  }

  const canWrite = can(actor, "clients", "create");
  const primarySiteByClientId = result.data.primarySiteByClientId ?? {};
  const accountManagers = accountManagersResult.data?.accountManagers ?? [];

  return (
    <ClientsExplorer
      clients={result.data.clients}
      count={result.data.count}
      page={page}
      pageSize={CLIENTS_PAGE_SIZE}
      canWrite={canWrite}
      primarySiteByClientId={primarySiteByClientId}
      accountManagers={accountManagers}
    />
  );
}
