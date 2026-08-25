import type { ClientRecord, SiteRecord } from "./actions";

/**
 * Kanban grouping heuristic for the Clients board view (issue #8,
 * docs/ARCHITECTURE.md "View switcher per module: list / kanban / calendar
 * / map").
 *
 * `clients` has no status/stage column in the schema (see
 * docs/ARCHITECTURE.md "Core schema (v1)") — there is no real lifecycle
 * concept to group by yet. Two options were considered:
 *
 *  1. Group by whether the client has any `sites` yet ("Not yet onboarded"
 *     vs "Active") — closer to the FSM domain.
 *  2. Group by data completeness, computed purely from the `ClientRecord`
 *     fields `listClients()` already returns.
 *
 * Went with option 1 as of issue #41 redo ("Sites as client addresses"):
 * `ClientRecord` no longer carries any flat address columns at all (the
 * `client.city` this heuristic originally read from was dropped, along with
 * every other flat address field), and `clients-board.tsx` now already
 * fetches each client's primary site for the list/kanban overviews anyway
 * (`fetchPrimarySiteByClientId`, needed regardless for "Primary adres is
 * zichtbaar in alle standaardoverzichten") — so grouping by "has a site yet"
 * is free (zero extra queries beyond what's already fetched) and a more
 * meaningful "onboarding progress" read than the old data-completeness
 * heuristic: a client's first site is exactly the moment address data (and
 * therefore that client's location) becomes real. Still a stopgap, NOT a
 * deliberate product decision — the moment a real `clients.stage` (or
 * similar) column exists, swap this function's body for a `.reduce` over
 * that instead. Everything downstream (`ClientsKanban`) only depends on the
 * `ClientKanbanColumn[]` shape, not how it's computed, so the swap is
 * isolated to this one file.
 */
export type ClientStage = "new" | "contacted" | "onboarded";

export interface ClientKanbanColumn {
  stage: ClientStage;
  label: string;
  description: string;
  clients: ClientRecord[];
}

export function groupClientsForKanban(
  clients: ClientRecord[],
  primarySiteByClientId: Record<string, SiteRecord | null>,
): ClientKanbanColumn[] {
  const buckets: Record<ClientStage, ClientRecord[]> = { new: [], contacted: [], onboarded: [] };

  for (const client of clients) {
    const hasContact = Boolean(client.email || client.phone);
    const hasSite = Boolean(primarySiteByClientId[client.id]);
    if (!hasContact) {
      buckets.new.push(client);
    } else if (!hasSite) {
      buckets.contacted.push(client);
    } else {
      buckets.onboarded.push(client);
    }
  }

  return [
    { stage: "new", label: "New", description: "No email or phone on file yet", clients: buckets.new },
    {
      stage: "contacted",
      label: "Contacted",
      description: "Has an email or phone, no site/address yet",
      clients: buckets.contacted,
    },
    {
      stage: "onboarded",
      label: "Onboarded",
      description: "Contact info and at least one site on file",
      clients: buckets.onboarded,
    },
  ];
}
