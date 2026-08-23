"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import { timeEntryClockInSchema, timeEntryUpdateSchema } from "./schema";
import type { ResolvedReferenceItem } from "./actions";

/**
 * Server Actions for a Work Order's Time Entries (issue #15, second stage) —
 * a sub-resource of Work Orders, same relationship `contacts` has to
 * `clients` (see `app/(app)/clients/contacts-actions.ts`). Kept in its own
 * file rather than folded into `actions.ts`, same reasoning that file's
 * sibling gives.
 *
 * Reuses the `planning` RBAC module (lib/rbac/permissions.ts) rather than a
 * new one — see `supabase/migrations/20260823180000_time_entries_core.sql`'s
 * header for why. The matrix row (updated for this issue):
 *   owner/planner:          CRUD, all rows
 *   engineer:                read_own / update_own / create_own, own rows
 *                            only (`user_id = auth.uid()`); NO delete
 *   finance/administratie:  read, all rows
 *
 * *** The trickiest part of this module: "engineer logs only their own time,
 * owner/planner can log on behalf of anyone." *** Implemented in two
 * cooperating layers, same "app-layer decides which actions exist, RLS is
 * the real backstop" split as `work_orders.assignedTo`:
 *  - App layer (`clockIn` below): if the caller only has `create_own` (i.e.
 *    lacks plain `create`), `user_id` is ALWAYS pinned to the caller's own
 *    session id — any `userId` the caller passed in is silently ignored, not
 *    surfaced as a validation error. This is a deliberate choice over
 *    letting the RLS INSERT policy reject a mismatched value as a 42501:
 *    an engineer has no legitimate reason to ever pass a foreign `userId`
 *    (the UI never offers it to them), so treating it as "not applicable to
 *    you" rather than "here's an error" avoids a wasted round trip for a
 *    case that isn't a real user mistake.
 *  - DB layer (RLS, `time_entries_insert_scoped`/`time_entries_update_scoped`
 *    in the migration): re-enforces the same rule independently — an
 *    engineer's INSERT/UPDATE is rejected outright if `user_id` isn't their
 *    own, regardless of what the app layer intended. This is what actually
 *    keeps the tenant boundary safe even if the app-layer logic above had a
 *    bug; `mapDbError`'s existing `42501` case turns that rejection into a
 *    clean message for any path that reaches it anyway (e.g. a future caller
 *    of `updateTimeEntry` who reassigns `userId` without going through
 *    `clockIn`'s override).
 * An owner/planner (plain `create`) may pass any `userId` (defaulting to
 * themselves when omitted) to log/clock someone else in.
 */

export interface TimeEntryRecord {
  id: string;
  organization_id: string;
  work_order_id: string;
  user_id: string;
  entry_type_id: string | null;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded via `reference_list_items!time_entries_entry_type_id_fkey(...)`
   * — see `TIME_ENTRY_SELECT` below. `null` whenever `entry_type_id` is
   * somehow `null` (in practice always set — the DB trigger fills in the
   * org's default `time_entry_type` item on insert when omitted). */
  time_entry_type: ResolvedReferenceItem | null;
}

/** Shared select shape for every query returning a `TimeEntryRecord`, so the
 * frontend gets the resolved entry-type value/label/color in one round trip
 * — same reasoning as `WORK_ORDER_SELECT` in `./actions.ts`. */
const TIME_ENTRY_SELECT =
  "*, time_entry_type:reference_list_items!time_entries_entry_type_id_fkey(value,label,color)";

const uuidSchema = z.string().uuid("Invalid id.");

function toTimeEntryUpdateRow(input: ReturnType<typeof timeEntryUpdateSchema.parse>) {
  const row: Record<string, unknown> = {};
  if (input.userId !== undefined) row.user_id = input.userId;
  if (input.entryTypeId !== undefined) row.entry_type_id = input.entryTypeId;
  if (input.startedAt !== undefined) row.started_at = input.startedAt;
  if (input.endedAt !== undefined) row.ended_at = input.endedAt;
  if (input.notes !== undefined) row.notes = input.notes ?? null;
  return row;
}

/**
 * Lists a work order's time entries, most-recently-started first. Gated on
 * `canAny(actor, "planning", ["read", "read_own"])`; for an engineer
 * (`read_own` only) this does NOT add an app-layer `user_id` filter — RLS
 * (`time_entries_select_scoped`) already scopes the result to their own
 * rows, same lesson `listWorkOrders` documents in `./actions.ts`.
 */
export async function listTimeEntries(
  workOrderId: string,
): Promise<ActionResult<{ timeEntries: TimeEntryRecord[] }>> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "planning", ["read", "read_own"])) {
    return fail("You do not have permission to view time entries.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("time_entries")
    .select(TIME_ENTRY_SELECT)
    .eq("work_order_id", idResult.data)
    .order("started_at", { ascending: false });

  if (error) return fail(mapDbError(error));
  return ok({ timeEntries: (data ?? []) as TimeEntryRecord[] });
}

/**
 * Starts a new running time entry (`started_at: now()`, `ended_at: null`)
 * against `workOrderId`. Gated on
 * `canAny(actor, "planning", ["create", "create_own"])`.
 *
 * See the module comment above for the full reasoning; in short: a caller
 * with only `create_own` (engineer) is always clocked in as themselves,
 * ignoring `input.userId` entirely; a caller with plain `create`
 * (owner/planner) may pass `input.userId` to clock someone else in, and
 * defaults to themselves when it's omitted.
 */
export async function clockIn(
  workOrderId: string,
  input: unknown = {},
): Promise<ActionResult<{ timeEntry: TimeEntryRecord }>> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "planning", ["create", "create_own"])) {
    return fail("You do not have permission to log time.");
  }

  const parsed = timeEntryClockInSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const canLogForOthers = can(ctx.context.actor, "planning", "create");
  const userId = canLogForOthers
    ? parsed.data.userId ?? ctx.context.session.userId
    : ctx.context.session.userId;

  const row: Record<string, unknown> = {
    work_order_id: idResult.data,
    user_id: userId,
    started_at: new Date().toISOString(),
    ended_at: null,
  };
  // entry_type_id is intentionally omitted (not even sent as null) when not
  // provided — the derive_time_entry_organization_id DB trigger fills in the
  // organization's default time_entry_type item ("Labor") on insert. Same
  // reasoning as toWorkOrderInsertRow's status_id omission in ./actions.ts.
  if (parsed.data.entryTypeId !== undefined) row.entry_type_id = parsed.data.entryTypeId;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("time_entries")
    .insert(row)
    .select(TIME_ENTRY_SELECT)
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ timeEntry: data as TimeEntryRecord });
}

/**
 * Sets `ended_at: now()` on an existing running entry. Gated on
 * `canAny(actor, "planning", ["update", "update_own"])`; an engineer can
 * only clock out their own row — RLS (`time_entries_update_scoped`) enforces
 * this independently of the app-layer gate, same split documented in the
 * module comment above.
 */
export async function clockOut(id: string): Promise<ActionResult<{ timeEntry: TimeEntryRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid time entry id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "planning", ["update", "update_own"])) {
    return fail("You do not have permission to clock out this time entry.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("time_entries")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", idResult.data)
    .select(TIME_ENTRY_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Time entry not found, or you do not have permission to clock out.");
  return ok({ timeEntry: data as TimeEntryRecord });
}

/**
 * General edit (correcting `startedAt`/`endedAt`/`entryTypeId`/`notes`, or —
 * for an owner/planner only, per RLS's `WITH CHECK` — reassigning `userId`).
 * Same gate as `clockOut`: `canAny(actor, "planning", ["update", "update_own"])`.
 * An engineer's attempt to reassign `userId` away from themselves is
 * rejected by RLS as a `42501`, which `mapDbError` turns into a clean
 * message — same precedent as `work_orders.assignedTo` in `./actions.ts`.
 */
export async function updateTimeEntry(
  id: string,
  input: unknown,
): Promise<ActionResult<{ timeEntry: TimeEntryRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid time entry id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "planning", ["update", "update_own"])) {
    return fail("You do not have permission to update time entries.");
  }

  const parsed = timeEntryUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row = toTimeEntryUpdateRow(parsed.data);
  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("time_entries")
    .update(row)
    .eq("id", idResult.data)
    .select(TIME_ENTRY_SELECT)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Time entry not found, or you do not have permission to update it.");
  return ok({ timeEntry: data as TimeEntryRecord });
}

/** Owner/planner only (per the RBAC matrix + RLS DELETE policy, both agree —
 * engineer has no `delete` action on `planning` at all, same "no gap to
 * document" shape as `deleteWorkOrder` in `./actions.ts`). */
export async function deleteTimeEntry(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid time entry id.");

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "planning", "delete")) {
    return fail("Only an owner or planner can delete time entries.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("time_entries")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Time entry not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
