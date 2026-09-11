import "server-only";

import { unstable_cache, revalidateTag } from "next/cache";

/**
 * Shared read-through cache for tenant-configurable, near-static reference
 * data (issue #147) — first cache primitive introduced anywhere in this
 * codebase, so this file (and its doc comment) sets the precedent every
 * future cached read follows.
 *
 * Covers the four "Settings-configured tenant taxonomy" reads that fan out
 * across the app on nearly every page (picklist badges/selects, cascading
 * pickers) but change on the order of "a tenant admin edits a picklist once
 * a month":
 *  - `reference_list_items` (`lib/reference-lists/actions.ts`'s
 *    `listReferenceItems` — one list per `list_key` per org)
 *  - `article_groups` (`app/(app)/articles/groups-actions.ts`'s
 *    `listArticleGroups` — one whole tree per org)
 *  - `activity_subtypes` (`app/(app)/activities/subtypes-actions.ts`'s
 *    `listActivitySubtypes` — one whole tree per org)
 *  - `solution_subtypes` (`app/(app)/activities/solution-subtype-actions.ts`'s
 *    `listSolutionSubtypes` — one whole tree per org)
 *
 * Chosen primitive: `unstable_cache` + `revalidateTag` (tag-based, no
 * time-based `revalidate` window) — not the newer `use cache`
 * directive/Cache Components model, since this app enables neither
 * `dynamicIO` nor `cacheLife` anywhere today, and `unstable_cache` is the
 * smallest primitive that does exactly what this needs: cache a value under
 * an explicit tag, invalidate that exact tag on mutation, nothing else. No
 * `revalidate` option is set below, so an entry is cached indefinitely —
 * correctness relies entirely on every create/update/delete path for a given
 * org+kind(+listKey) calling `invalidateReferenceDataCache` for that same
 * tag on success, not on a caching window ever expiring naturally (an edit
 * must be visible immediately, not "eventually within N seconds").
 *
 * SECURITY (non-negotiable, see CLAUDE.md + this repo's RLS rule): every tag
 * below is a function of BOTH `organizationId` AND `kind` (and `listKey` for
 * `reference_list_items`, which holds many distinct lists per org) — never
 * just `kind`/`listKey` alone. Two different orgs' "Work Order Status" list
 * must never collide in this cache; `organizationId` is a required
 * (non-optional) argument to every function below for exactly that reason.
 *
 * The `fetcher` every caller passes in is a closure over that caller's own
 * RLS-scoped Supabase client (`createClient()` from `lib/supabase/server.ts`,
 * built from the request's session cookies) — never a service-role client.
 * That client is always constructed by the caller BEFORE calling
 * `readThroughReferenceDataCache` (see every call site), so the `cookies()`
 * read Supabase needs for the caller's session happens outside
 * `unstable_cache`'s scope, where Next.js allows it (`cookies()`/`headers()`
 * themselves may not be called from inside a `unstable_cache`-wrapped
 * function — see Next.js's `unstable_cache` docs — but a client object built
 * from an already-resolved cookie store, then merely queried from inside the
 * cached closure, never re-invokes that dynamic API). This cache is a pure
 * memoization layer sitting in front of that RLS-scoped read, exactly like
 * the story's framing: RLS remains the real tenant boundary; a bug in this
 * file's key/tag logic can at worst mis-tag a cache entry, never grant a
 * caller rows their own RLS-scoped client couldn't have read in the first
 * place (since that RLS-scoped client is what actually populates the cache
 * on every miss).
 *
 * `fetcher` should throw (not return an error value) on a DB error — an
 * `unstable_cache`-wrapped function that throws is never cached (matches
 * `fetch`'s own cache semantics: only fulfilled values are cached), so a
 * transient DB error is never "cached" as a false-negative until the next
 * invalidation. Every caller below catches that throw and maps it back to
 * this codebase's `ActionResult` shape.
 */
export type ReferenceDataCacheKind =
  | "reference_list_items"
  | "article_groups"
  | "activity_subtypes"
  | "solution_subtypes";

function referenceDataCacheTag(
  organizationId: string,
  kind: ReferenceDataCacheKind,
  listKey?: string,
): string {
  return listKey
    ? `refdata:${organizationId}:${kind}:${listKey}`
    : `refdata:${organizationId}:${kind}`;
}

/**
 * Reads `fetcher()` through a cache tagged by `organizationId` + `kind` (+
 * `listKey`, for the multi-list `reference_list_items` case — omit for the
 * single-tree-per-org tables). A fresh `unstable_cache` wrapper is created
 * per call (cheap — it's just a closure) so `fetcher` can close over the
 * caller's per-request Supabase client without that client ever being
 * serialized into the cache key; the cache key/dedup identity comes entirely
 * from the explicit `keyParts` below (org + kind + listKey), not from
 * `fetcher`'s closure.
 */
export async function readThroughReferenceDataCache<T>(
  organizationId: string,
  kind: ReferenceDataCacheKind,
  fetcher: () => Promise<T>,
  listKey?: string,
): Promise<T> {
  const tag = referenceDataCacheTag(organizationId, kind, listKey);
  const cached = unstable_cache(fetcher, ["refdata", organizationId, kind, listKey ?? "_"], {
    tags: [tag],
  });
  return cached();
}

/**
 * Call from every reference-data mutation path (create/update/delete, for
 * `reference_list_items` and all three tree tables) once the write succeeds
 * — invalidates exactly that org+kind(+listKey)'s cache entry so the next
 * read is fresh instead of stale for a caching window.
 */
export function invalidateReferenceDataCache(
  organizationId: string,
  kind: ReferenceDataCacheKind,
  listKey?: string,
): void {
  revalidateTag(referenceDataCacheTag(organizationId, kind, listKey));
}
