/**
 * Resolves which record a relation card should display for a given foreign
 * key: the freshly-fetched/just-picked candidate from `candidates` when one
 * matches `id`, falling back to an already-resolved `fallback` record (a
 * server-fetched prop, typically fixed at initial render) when IT ALSO
 * matches `id`, or `null` otherwise — including when `id` itself is falsy
 * (e.g. an empty-string draft field, meaning "nothing selected").
 *
 * Shared by every relation-cards row that resolves "the record just picked
 * via this page's relations dialog vs. the one already persisted on a
 * server-fetched prop" (issue #130) — previously duplicated, with the same
 * two-source-preference shape, across `work-order-relation-cards.tsx`,
 * `asset-relation-cards.tsx`, `activity-hero.tsx`, and `contract-screen.tsx`.
 * See `use-relation-dialog-save.ts` (same folder) for the save-side half of
 * that same duplication.
 *
 * Candidates are always checked first, then the fallback — the two source
 * orders the original call sites used (fallback-first for Client cards,
 * candidates-first for Site/Asset/Contract cards) are behaviorally
 * equivalent in every real call site here: the "candidates" list is always
 * the full/current set for the record's own tenant scope, so whenever the
 * fallback prop's id matches, an identical-shaped record is also present in
 * `candidates` (both come from the same `select("*")`-shaped queries).
 *
 * `getId` is a selector rather than a fixed `"id"` key so this stays usable
 * for the (uncommon) case where the id being matched isn't literally the
 * candidate's own `id` field.
 *
 * Not used for every relation card in the app — a few resolutions are
 * keyed off a DIFFERENT record's sibling field (e.g. `AssetRelationCards`'
 * Model/Brand/Type/Subtype cards, which key off `asset.model_id`/
 * `asset.brand_item_id`/etc. while returning `asset.asset_model`/a plain
 * label rather than the matched record itself) or don't have a "just
 * picked vs. persisted" duplication to remove at all (`quote-relation-
 * cards.tsx` renders its `client`/`site` props directly, with no local
 * candidate-list merge) — those are left as their own explicit code rather
 * than bent to fit this helper.
 */
export function resolveRelation<T>(
  id: string | null | undefined,
  candidates: readonly T[],
  fallback: T | null | undefined,
  getId: (item: T) => string,
): T | null {
  if (!id) return null;
  return candidates.find((candidate) => getId(candidate) === id) ?? (fallback && getId(fallback) === id ? fallback : null);
}
