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
 *
 * Site-first, THEN phone-completeness (as of migration
 * `20260826130000_sites_phone.sql`, moving `phone` off `clients` onto
 * `sites`): the three stages used to be "no phone" / "phone but no site" /
 * "phone and site", using `client.phone` directly. Once phone only ever
 * exists attached to a site, "has a phone but no site" became structurally
 * impossible (a phone can't exist without a site to carry it) — that middle
 * bucket would always be empty. The heuristic is now: no site at all yet ->
 * has a site but that site has no phone on file -> has a site with a phone
 * on file. This reads as "onboarding progress" in the same spirit as before,
 * just re-ordered around what can actually happen now that phone is a
 * site-level field.
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
    // `client.email` was dropped from the DB (issue #43) — a client's
    // contact email now only ever lives on its `Contact` rows, which aren't
    // plumbed into this list/kanban fetch (see `clients-board.tsx`; adding
    // that here would be a bigger detour than this heuristic warrants).
    // `phone` now lives on the site, not the client (migration
    // `20260826130000_sites_phone.sql`) — so "has a site" is the first gate,
    // and that site's own `phone` is the completeness signal within it.
    const primarySite = primarySiteByClientId[client.id];
    const hasSite = Boolean(primarySite);
    const hasPhone = Boolean(primarySite?.phone);
    if (!hasSite) {
      buckets.new.push(client);
    } else if (!hasPhone) {
      buckets.contacted.push(client);
    } else {
      buckets.onboarded.push(client);
    }
  }

  return [
    { stage: "new", label: "New", description: "No site on file yet", clients: buckets.new },
    {
      stage: "contacted",
      label: "Contacted",
      description: "Has a site, no phone on file yet",
      clients: buckets.contacted,
    },
    {
      stage: "onboarded",
      label: "Onboarded",
      description: "Site and phone number on file",
      clients: buckets.onboarded,
    },
  ];
}
