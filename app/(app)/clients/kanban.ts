import type { ClientRecord } from "./actions";

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
 *     vs "Active") — closer to the FSM domain, but `listClients()`
 *     deliberately does NOT return a per-client site count (that's only
 *     available one-at-a-time via `getClient`/`getClientDependencyCounts`),
 *     so this would mean an extra query *per visible card* (an N+1 the
 *     backend has no bulk endpoint for). Not worth the extra round trips for
 *     a v1 grouping that isn't even a real product decision yet.
 *  2. Group by data completeness, computed purely from the `ClientRecord`
 *     fields `listClients()` already returns — zero extra queries, still a
 *     meaningful "onboarding progress" read on the data.
 *
 * Went with option 2. This is a stopgap, NOT a deliberate product decision —
 * the moment a real `clients.stage` (or similar) column exists, or a bulk
 * "clients with site counts" query exists, swap this function's body for a
 * `.reduce` over that instead. Everything downstream (`ClientsKanban`) only
 * depends on the `ClientKanbanColumn[]` shape, not how it's computed, so the
 * swap is isolated to this one file.
 */
export type ClientStage = "new" | "contacted" | "onboarded";

export interface ClientKanbanColumn {
  stage: ClientStage;
  label: string;
  description: string;
  clients: ClientRecord[];
}

export function groupClientsForKanban(clients: ClientRecord[]): ClientKanbanColumn[] {
  const buckets: Record<ClientStage, ClientRecord[]> = { new: [], contacted: [], onboarded: [] };

  for (const client of clients) {
    const hasContact = Boolean(client.email || client.phone);
    const hasAddress = Boolean(client.city);
    if (!hasContact) {
      buckets.new.push(client);
    } else if (!hasAddress) {
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
      description: "Has an email or phone, no address yet",
      clients: buckets.contacted,
    },
    {
      stage: "onboarded",
      label: "Onboarded",
      description: "Contact info and address on file",
      clients: buckets.onboarded,
    },
  ];
}
