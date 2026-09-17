/**
 * Issue #198 ("Afronding reistijd werktijd") — the TypeScript twin of
 * `public.compute_rounded_minutes` in
 * `supabase/migrations/20260920090000_travel_work_time_rounding_settings.sql`.
 * Keep this function's semantics BYTE-IDENTICAL to that SQL function's — it
 * is called both from the always-on DB trigger
 * (`sync_time_entry_to_auto_draft_quote`, same migration) and from this
 * package's application-layer callers (`computeQuantityHours`,
 * `app/(app)/work-orders/create-quote-actions.ts`; the PWA's cached
 * `timeRoundingSettings` response field). Any future change to one side's
 * rounding math must be mirrored on the other.
 */

export type RoundingDirection = "up" | "down";

export interface TimeRoundingRule {
  /** Minimum BILLABLE duration in minutes, applied FIRST (a floor). `null` =
   * no minimum applied (today's exact pre-#198 behavior). */
  minimumMinutes: number | null;
  /** Rounding interval in minutes, applied SECOND, only when set and > 0.
   * `null` (or <= 0) = no rounding applied. An already-exact multiple of
   * this interval is left unchanged. */
  roundingMinutes: number | null;
  /** Which way `roundingMinutes` rounds a non-exact-multiple duration. */
  direction: RoundingDirection;
}

/**
 * Applies an optional minimum-duration floor (`rule.minimumMinutes`, applied
 * FIRST) then an optional rounding interval (`rule.roundingMinutes` /
 * `rule.direction`, applied SECOND) to `rawMinutes`. Either or both of
 * `rule.minimumMinutes`/`rule.roundingMinutes` may be `null`, meaning that
 * step is skipped. An already-exact multiple of `rule.roundingMinutes` is
 * left unchanged (never rounded away from itself).
 *
 * Port of `public.compute_rounded_minutes`
 * (`supabase/migrations/20260920090000_travel_work_time_rounding_settings.sql`)
 * — keep these two in sync; see that function's own SQL comment, which
 * documents this file as its intended JS twin.
 *
 * Worked examples (from issue #198 itself):
 *   - 25min raw, rounding 30min/"up", no minimum -> 30min (not an exact
 *     multiple of 30, rounds up).
 *   - 40min raw, minimum 60min (no rounding configured) -> 60min (floored to
 *     the minimum).
 *   - 20min raw, minimum 15min, rounding 30min/"up" -> 30min (floor to 20min,
 *     already >= the 15min minimum so no change there, then round up to the
 *     next 30min multiple).
 *   - 30min raw, rounding 30min/"up" or "down", no minimum -> 30min (already
 *     an exact multiple, left untouched regardless of direction).
 */
export function computeRoundedMinutes(rawMinutes: number, rule: TimeRoundingRule): number {
  let result = rawMinutes;

  // Minimum floor FIRST (order matters — see this function's own doc
  // comment / the SQL migration's header).
  if (rule.minimumMinutes !== null) {
    result = Math.max(result, rule.minimumMinutes);
  }

  // Rounding interval SECOND, only if configured and positive. Leaves an
  // already-exact multiple untouched (never rounds a value away from
  // itself).
  if (rule.roundingMinutes !== null && rule.roundingMinutes > 0) {
    if (result % rule.roundingMinutes !== 0) {
      result =
        rule.direction === "down"
          ? Math.floor(result / rule.roundingMinutes) * rule.roundingMinutes
          : Math.ceil(result / rule.roundingMinutes) * rule.roundingMinutes;
    }
  }

  return result;
}
