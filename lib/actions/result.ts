import "server-only";

/**
 * Shared Server Action result shape + helpers, used by every module's
 * `actions.ts` (`app/(app)/clients/actions.ts`, `app/(app)/assets/actions.ts`,
 * and future modules). Not itself a `"use server"` file — it's a plain
 * helper module imported by them, same pattern as `lib/rbac/features.ts`.
 *
 * Kept deliberately small and DB-agnostic: this is the "did it work, and if
 * not why" envelope every action returns, so `frontend-ui-engineer` has one
 * consistent shape to branch on instead of a different ad-hoc return type
 * per action.
 */
export interface ActionResult<T = undefined> {
  /** Present on success. Absent (undefined) on failure. */
  data?: T;
  /** Human-readable, safe-to-display error message. Present on failure. */
  error?: string;
  /** Zod `flatten().fieldErrors`-shaped validation errors, keyed by input
   * field name — present only when `error` is a validation failure, so a
   * form can highlight the specific field(s). */
  fieldErrors?: Record<string, string[] | undefined>;
}

export function ok<T>(data: T): ActionResult<T> {
  return { data };
}

export function fail<T = never>(
  error: string,
  fieldErrors?: Record<string, string[] | undefined>,
): ActionResult<T> {
  return { error, fieldErrors };
}

/**
 * Turns a Postgres/PostgREST error (as returned by supabase-js) into a
 * clean, user-safe message instead of leaking raw constraint/policy text.
 *
 * `42501` (insufficient_privilege) is the code an RLS `WITH CHECK`/column
 * grant rejection surfaces as — this is deliberately how the
 * Planner-cannot-update-assets RLS gap (see `app/(app)/assets/actions.ts`)
 * is surfaced to the caller: `can()` allows a Planner to attempt the
 * update (matrix says Planner has Assets Read/Update), the DB rejects it
 * because RLS is still owner-only for writes in v1, and this maps that
 * rejection to a clean message rather than a raw Postgres error string.
 *
 * `23514` (check_violation) is also what the reference-list-backed columns
 * introduced by `supabase/migrations/20260822200000_reference_lists.sql`
 * raise for two distinct, unrelated-looking cases that share the same
 * Postgres error code: (a) the cross-organization re-parent guards
 * (`derive_site_organization_id` / `derive_asset_org_and_client` /
 * `derive_reference_list_item_org`), and (b) `validate_asset_reference_items`
 * rejecting a `type_id`/`status_id` that points at an item from the wrong
 * `list_key` (e.g. an `asset_status` item passed as `type_id`) or from a
 * different organization's reference list. Kept as one shared, generic
 * message here (rather than two separate codes) since Postgres itself only
 * gives us one error code for both — any future module that gains its own
 * `reference_list_items`-backed column (e.g. Phase 2 `contracts.type_id`)
 * will hit the same class of error and should reuse this mapping rather
 * than growing a local one-off.
 */
export function mapDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case "42501":
      return "You do not have permission to perform this action.";
    case "23503":
      // foreign_key_violation is raised both when a caller points a new/
      // updated row at something that doesn't exist (e.g. a bad site_id),
      // and — in the opposite direction — when a caller tries to delete a
      // row that something else still depends on (e.g. deleting a
      // `reference_list_items` row still referenced by `assets.type_id`;
      // the FK has no `on delete cascade`/`set null`, so Postgres blocks
      // it). Same code either way, so one general message covers both.
      return "That action isn't allowed — it either references something that no longer exists, or something else still depends on it.";
    case "23514":
      return "That change isn't allowed — it may reference a value that doesn't belong here (e.g. the wrong picklist), or would move this record to a different organization.";
    default:
      return error.message;
  }
}

/** Clamps a requested page size into a sane range so a caller can't request
 * an unbounded/huge `limit`. */
export function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  const value = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : fallback;
  return Math.min(Math.max(value, 1), max);
}

export function clampOffset(offset: number | undefined): number {
  const value = typeof offset === "number" && Number.isFinite(offset) ? Math.floor(offset) : 0;
  return Math.max(value, 0);
}
