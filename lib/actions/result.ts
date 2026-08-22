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
 */
export function mapDbError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case "42501":
      return "You do not have permission to perform this action.";
    case "23503":
      return "That record references something that no longer exists.";
    case "23514":
      return "That change isn't allowed (e.g. it would move this record to a different organization).";
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
