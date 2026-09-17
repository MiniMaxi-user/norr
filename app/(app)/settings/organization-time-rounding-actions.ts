"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import type { TimeRoundingRule } from "@yourorg/time-rounding";

/**
 * Org-level travel/work time minimum + rounding settings (issue #198,
 * "Afronding reistijd werktijd"): `organizations.travel_time_minimum_minutes`
 * / `travel_time_rounding_minutes` / `travel_time_rounding_direction`, and
 * the identically-shaped `work_time_*` triple — see
 * `supabase/migrations/20260920090000_travel_work_time_rounding_settings.sql`
 * for the full schema design note and `compute_rounded_minutes` (its
 * TypeScript twin is `computeRoundedMinutes`, `@yourorg/time-rounding`).
 *
 * Exact same pattern as `getOrganizationDefaultRateSettings`/
 * `updateOrganizationDefaultRateSettings`
 * (`app/(app)/settings/organization-rate-actions.ts`, read in full before
 * writing this file): `requireModuleContext("settings")`, read gated on
 * `can(actor, "settings", "read")` (any org member), update gated on
 * `can(actor, "settings", "update")` (owner-only — matches `organizations`'
 * own `organizations_update_owner` RLS policy, which is `is_org_owner` only,
 * same "don't let the app layer allow a write RLS would just bounce"
 * reasoning that file's own comment documents). No new RBAC module/feature
 * flag — this is core tenant configuration under the existing `"settings"`
 * module, not a separately-sellable module.
 */

const roundingDirectionSchema = z.enum(["up", "down"]);

/** Partial — only fields actually present in a given `travel`/`work` object
 * get written, same partial-update shape
 * `organizationDefaultRateSchema`/`toQuoteLineItemUpdateRow` already use
 * elsewhere in this codebase. `minimumMinutes`/`roundingMinutes` accept
 * explicit `null` to clear that field back to "not configured" (no
 * minimum/no rounding — today's default behavior). */
const timeRoundingRulePatchSchema = z.object({
  minimumMinutes: z
    .number()
    .int("Minimum duration must be a whole number of minutes.")
    .nonnegative("Minimum duration cannot be negative.")
    .nullable()
    .optional(),
  roundingMinutes: z
    .number()
    .int("Rounding interval must be a whole number of minutes.")
    .positive("Rounding interval must be greater than zero.")
    .nullable()
    .optional(),
  direction: roundingDirectionSchema.optional(),
});

const organizationTimeRoundingSchema = z.object({
  travel: timeRoundingRulePatchSchema.optional(),
  work: timeRoundingRulePatchSchema.optional(),
});

export interface OrganizationTimeRoundingSettings {
  travel: TimeRoundingRule;
  work: TimeRoundingRule;
}

interface OrganizationTimeRoundingRow {
  travel_time_minimum_minutes: number | null;
  travel_time_rounding_minutes: number | null;
  travel_time_rounding_direction: "up" | "down";
  work_time_minimum_minutes: number | null;
  work_time_rounding_minutes: number | null;
  work_time_rounding_direction: "up" | "down";
}

const ORGANIZATION_TIME_ROUNDING_SELECT =
  "travel_time_minimum_minutes, travel_time_rounding_minutes, travel_time_rounding_direction, work_time_minimum_minutes, work_time_rounding_minutes, work_time_rounding_direction";

function toSettings(row: OrganizationTimeRoundingRow): OrganizationTimeRoundingSettings {
  return {
    travel: {
      minimumMinutes: row.travel_time_minimum_minutes,
      roundingMinutes: row.travel_time_rounding_minutes,
      direction: row.travel_time_rounding_direction,
    },
    work: {
      minimumMinutes: row.work_time_minimum_minutes,
      roundingMinutes: row.work_time_rounding_minutes,
      direction: row.work_time_rounding_direction,
    },
  };
}

/** Any org member (any tenant role has at least `read` on `settings`). */
export async function getOrganizationTimeRoundingSettings(): Promise<
  ActionResult<{ settings: OrganizationTimeRoundingSettings }>
> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;

  if (!can(actor, "settings", "read")) {
    return fail("You do not have permission to view organization time rounding settings.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .select(ORGANIZATION_TIME_ROUNDING_SELECT)
    .eq("id", organizationId)
    .maybeSingle<OrganizationTimeRoundingRow>();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Organization not found.");

  return ok({ settings: toSettings(data) });
}

/**
 * Owner-only. `input` is `{ travel?: Partial<TimeRoundingRule>, work?:
 * Partial<TimeRoundingRule> }` — each of `travel`/`work` is independently
 * optional, and within each, each of `minimumMinutes`/`roundingMinutes`/
 * `direction` is independently optional; only the fields actually present
 * get written to the `organizations` row (same partial-update shape
 * `updateOrganizationDefaultRateSettings` already uses). Passing an explicit
 * `null` for `minimumMinutes`/`roundingMinutes` clears that field back to
 * "not configured" (no minimum/no rounding for that duration type).
 */
export async function updateOrganizationTimeRoundingSettings(
  input: unknown,
): Promise<ActionResult<{ settings: OrganizationTimeRoundingSettings }>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;

  if (!can(actor, "settings", "update")) {
    return fail("Only the organization owner can update the organization's time rounding settings.");
  }

  const parsed = organizationTimeRoundingSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row: Record<string, unknown> = {};
  const { travel, work } = parsed.data;

  if (travel?.minimumMinutes !== undefined) row.travel_time_minimum_minutes = travel.minimumMinutes;
  if (travel?.roundingMinutes !== undefined) row.travel_time_rounding_minutes = travel.roundingMinutes;
  if (travel?.direction !== undefined) row.travel_time_rounding_direction = travel.direction;
  if (work?.minimumMinutes !== undefined) row.work_time_minimum_minutes = work.minimumMinutes;
  if (work?.roundingMinutes !== undefined) row.work_time_rounding_minutes = work.roundingMinutes;
  if (work?.direction !== undefined) row.work_time_rounding_direction = work.direction;

  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .update(row)
    .eq("id", organizationId)
    .select(ORGANIZATION_TIME_ROUNDING_SELECT)
    .maybeSingle<OrganizationTimeRoundingRow>();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Organization not found, or you do not have permission to update it.");

  return ok({ settings: toSettings(data) });
}
