"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { canAny } from "@/lib/rbac/permissions";
import { updateWorkOrder, type WorkOrderRecord } from "./actions";

/** Duplicated from `WORK_ORDER_SELECT` in `./actions.ts` (kept in sync by
 * hand) rather than imported from there: `./actions.ts` is a `"use server"`
 * file, and Next.js's Server Actions convention only allows async function
 * exports from such a file — a `const` value export (even a plain string)
 * fails the build (confirmed by actually running it — see CLAUDE.md's
 * memory note on why `next build`, not just `tsc`, is required for
 * `"use server"` files). Same "each sub-concern file owns its own select
 * shape" precedent `TIME_ENTRY_SELECT` already sets in
 * `./time-entries-actions.ts`. */
const WORK_ORDER_SELECT =
  "*, work_order_status:reference_list_items!work_orders_status_id_fkey(value,label,color), work_order_priority:reference_list_items!work_orders_priority_id_fkey(value,label,color), work_order_type:reference_list_items!work_orders_type_id_fkey(value,label,color), contract:contracts(id, name)";

/**
 * Server Actions backing the Planning module's drag-and-drop scheduler board
 * (issue #164) — a thin layer ON TOP OF `./actions.ts`'s existing
 * `updateWorkOrder`, not a parallel write path. Kept in its own file, same
 * per-sub-concern convention as `./time-entries-actions.ts`.
 *
 * Both actions below reuse the `planning` RBAC module/gate exactly as every
 * other Work Order write does (`canAny(actor, "planning", ["update",
 * "update_own"])` — see the module comment at the top of `./actions.ts` for
 * the full recap): owner/planner may schedule/unschedule any work order; an
 * engineer may only touch their own assigned row, and RLS's `WITH CHECK` on
 * `work_orders` independently re-enforces that an engineer can never
 * reassign a work order away from themselves (or, by the same mechanism,
 * onto themselves from an unassigned backlog row — see this repo's plan
 * doc's RBAC confirmation note: RLS's engineer `UPDATE` policy has no
 * "own row" `USING` match for a `null` `assigned_to` row in the first
 * place, so an engineer's own-session query can't even select a backlog
 * item to begin with). `/planning` itself is owner/planner-only UI (a
 * separate frontend gate), but these actions don't assume that — they're
 * safe to call from anywhere in the app.
 *
 * `unscheduleWorkOrder` deliberately does NOT go through `updateWorkOrder`/
 * `workOrderUpdateSchema` — see that function's own comment below for why an
 * explicit `null` can't be pushed through that schema, and what this file
 * does instead.
 */

const uuidSchema = z.string().uuid("Invalid id.");

/** Shape-only validation for `scheduleWorkOrder`'s input — both fields are
 * REQUIRED here (unlike `workOrderUpdateSchema`'s optional `assignedTo`/
 * `scheduledAt`, which support a bare partial edit): scheduling a work order
 * is meaningless without picking both an engineer and a time. */
const scheduleWorkOrderInputSchema = z.object({
  assignedTo: z.string().uuid("Invalid assignee."),
  scheduledAt: z.string().datetime({ offset: true, message: "Expected a valid scheduled date/time." }),
});

interface ParsedScheduledAt {
  datePart: string;
  minutes: number;
  seconds: number;
  offsetSuffix: string;
}

/** Pulls the wall-clock minute/second and UTC-offset suffix straight out of
 * the ISO 8601 string itself (rather than going through `Date`, which would
 * normalize everything to UTC and lose the caller's intended local wall
 * time) — same reasoning `optionalIsoDateTime` in `./schema.ts` documents
 * for accepting either `Z` or a numeric offset: both are valid `timestamptz`
 * input, and the half-hour-boundary/same-day checks below care about the
 * wall-clock value as the caller (the browser's local timezone) wrote it,
 * not its UTC-normalized equivalent. */
function parseScheduledAt(iso: string): ParsedScheduledAt | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!match) return null;
  // Destructured (rather than indexed) so TypeScript's `noUncheckedIndexedAccess`
  // narrows each capture group from `string | undefined` to `string` via the
  // explicit check below, instead of reaching for a non-null assertion — all
  // five groups are non-optional in the pattern above, so a successful match
  // always populates them.
  const [, datePart, , minutePart, secondPart, offsetSuffix] = match;
  if (datePart === undefined || minutePart === undefined || secondPart === undefined || offsetSuffix === undefined) {
    return null;
  }
  return {
    datePart,
    minutes: Number(minutePart),
    seconds: Number(secondPart),
    offsetSuffix,
  };
}

/** AC: "workitems kunnen alleen gedropt worden op plekken waar de tijd exact
 * past" — a scheduled time must land exactly on `:00` or `:30`. */
function isHalfHourBoundary(iso: string): boolean {
  const parsed = parseScheduledAt(iso);
  if (!parsed) return false;
  return parsed.seconds === 0 && (parsed.minutes === 0 || parsed.minutes === 30);
}

/** A `[start, end)` window covering the same calendar day as `iso`, in the
 * SAME UTC offset `iso` itself was expressed in — "same calendar day" is
 * inherently timezone-relative, and re-using the caller's own offset (rather
 * than the server's, or a hardcoded org timezone this app doesn't model yet)
 * keeps the window aligned with the wall-clock day the scheduler board is
 * actually showing. Used only to keep the overlap-check query modest in
 * size (issue #164's own note: "there will only ever be a handful" of rows
 * for one engineer on one day) — the actual overlap arithmetic below is
 * exact, not bucketed by this window. */
function dayRangeFor(iso: string): { start: string; end: string } | null {
  const parsed = parseScheduledAt(iso);
  if (!parsed) return null;
  const nextDay = new Date(`${parsed.datePart}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDatePart = nextDay.toISOString().slice(0, 10);
  return {
    start: `${parsed.datePart}T00:00:00${parsed.offsetSuffix}`,
    end: `${nextDatePart}T00:00:00${parsed.offsetSuffix}`,
  };
}

interface ScheduleConflictCandidate {
  id: string;
  scheduled_at: string | null;
  duration_minutes: number | null;
}

/**
 * Schedules a work order onto the Planning board: assigns it to an engineer
 * and gives it a `scheduledAt` time. A thin wrapper around the EXISTING
 * `updateWorkOrder` (`./actions.ts`) — this function's own job is purely the
 * three Planning-specific guards below; the actual write (and its RLS
 * backstop) is entirely delegated, not reimplemented:
 *
 * 1. The target work order must have a `duration_minutes` set — there is no
 *    block length to render/reserve on the grid otherwise.
 * 2. `scheduledAt` must land on a `:00`/`:30` boundary (half-hour snap).
 * 3. **Authoritative server-side overlap check**: no other work order
 *    already scheduled for `assignedTo` may occupy any part of
 *    `[scheduledAt, scheduledAt + duration_minutes)`. The frontend's live
 *    drag feedback (green/red accent) is a preview of this same rule, not a
 *    substitute for it — this check runs regardless of what the client
 *    believed was a valid drop.
 */
export async function scheduleWorkOrder(
  id: string,
  input: unknown,
): Promise<ActionResult<{ workOrder: WorkOrderRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "planning", ["update", "update_own"])) {
    return fail("You do not have permission to schedule work orders.");
  }

  const parsed = scheduleWorkOrderInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  if (!isHalfHourBoundary(parsed.data.scheduledAt)) {
    return fail("Scheduled time must land exactly on the hour or half hour (e.g. 09:00 or 09:30).");
  }

  const supabase = await createSupabaseServerClient();

  // Re-fetch the target's own row — same "never trust a client-supplied
  // assumption about a resource's current state" convention as every other
  // module's cross-field checks (e.g. `updateTeamMemberRateSettings` in
  // `lib/team/actions.ts`). This SELECT is scoped by RLS exactly like every
  // other read in this module (see `./actions.ts`'s module comment): an
  // engineer's own session simply can't see a row that isn't their own, so
  // a mismatched `id` here comes back as "not found," not a permission leak.
  const { data: target, error: targetError } = await supabase
    .from("work_orders")
    .select("id, organization_id, assigned_to, scheduled_at, duration_minutes")
    .eq("id", idResult.data)
    .maybeSingle<{
      id: string;
      organization_id: string;
      assigned_to: string | null;
      scheduled_at: string | null;
      duration_minutes: number | null;
    }>();

  if (targetError) return fail(mapDbError(targetError));
  if (!target) return fail("Work order not found, or you do not have permission to schedule it.");

  if (target.duration_minutes == null) {
    return fail("This work order has no duration set — set one before scheduling.");
  }

  const dayRange = dayRangeFor(parsed.data.scheduledAt);
  if (!dayRange) return fail("Expected a valid scheduled date/time.");

  // Fetch this engineer's other scheduled rows for the same calendar day
  // (a modest row count, per this function's own doc comment) and compute
  // the actual interval overlap in application code — same "fetch modest
  // rows, compute precisely in app code" shape `quotes/actions.ts` already
  // uses for its own totals.
  const { data: sameDayRows, error: sameDayError } = await supabase
    .from("work_orders")
    .select("id, scheduled_at, duration_minutes")
    .eq("assigned_to", parsed.data.assignedTo)
    .not("scheduled_at", "is", null)
    .neq("id", idResult.data)
    .gte("scheduled_at", dayRange.start)
    .lt("scheduled_at", dayRange.end);

  if (sameDayError) return fail(mapDbError(sameDayError));

  const newStart = new Date(parsed.data.scheduledAt).getTime();
  const newEnd = newStart + target.duration_minutes * 60_000;

  const overlaps = ((sameDayRows ?? []) as ScheduleConflictCandidate[]).some((row) => {
    if (row.scheduled_at == null || row.duration_minutes == null) return false;
    const start = new Date(row.scheduled_at).getTime();
    const end = start + row.duration_minutes * 60_000;
    return newStart < end && start < newEnd;
  });

  if (overlaps) {
    return fail("This time slot overlaps with another scheduled item.");
  }

  return updateWorkOrder(idResult.data, {
    assignedTo: parsed.data.assignedTo,
    scheduledAt: parsed.data.scheduledAt,
  });
}

/**
 * Moves a work order back to the "Werkvoorraad"/backlog — clears both
 * `assignedTo` and `scheduledAt`. Used by both a drag-back-to-backlog and a
 * click-to-unschedule interaction on the Planning grid.
 *
 * Deliberately does NOT call `updateWorkOrder({ assignedTo: null,
 * scheduledAt: null })`: `workOrderUpdateSchema`'s `assignedTo`/`scheduledAt`
 * fields are built from `optionalUuid`/`optionalIsoDateTime`
 * (`z.preprocess(emptyToUndefined, ...optional())`, see `./schema.ts`) —
 * `.optional()` WITHOUT `.nullable()`. `emptyToUndefined` only maps `""` to
 * `undefined`, never `null`; an explicit `null` therefore fails Zod
 * validation there ("Expected string, received null" / "Invalid assignee.")
 * rather than clearing the column. Confirmed by reading `./schema.ts` before
 * writing this function. Widening those two helpers to `.nullable()` would
 * fix this call site but change behavior for every OTHER caller of
 * `updateWorkOrder` (which currently treats an absent `assignedTo`/
 * `scheduledAt` as "leave unchanged," not "clear") — out of scope for this
 * one Planning-specific need.
 *
 * Instead, this issues its OWN direct `work_orders` update, reusing exactly
 * the same permission gate `updateWorkOrder` itself uses
 * (`canAny(actor, "planning", ["update", "update_own"])`) and the same
 * "no row back = not found or not permitted" handling, but bypassing
 * `workOrderUpdateSchema` entirely — RLS (the real backstop either way,
 * see `./actions.ts`'s module comment) still applies identically to this
 * update as it would to one routed through `updateWorkOrder`.
 */
export async function unscheduleWorkOrder(id: string): Promise<ActionResult<{ workOrder: WorkOrderRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "planning", ["update", "update_own"])) {
    return fail("You do not have permission to update work orders.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_orders")
    .update({ assigned_to: null, scheduled_at: null })
    .eq("id", idResult.data)
    .select(WORK_ORDER_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Work order not found, or you do not have permission to update it.");
  return ok({ workOrder: data as WorkOrderRecord });
}
