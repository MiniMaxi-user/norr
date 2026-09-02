"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { canAny } from "@/lib/rbac/permissions";
import type { ShallowUserRecord } from "./actions";

/**
 * Server Actions for the Activity ("Melding") detail page's Historie section
 * (`.design-handoff/melding_detail/README.md` — a `KeyValueList` reading
 * top-to-bottom, oldest first: "Melding aangemaakt" -> "Action holder gezet"
 * -> "Werkorder aangemaakt"). New sibling file, not folded into `./actions.ts`,
 * mirroring `./notes-actions.ts`'s own "own sub-entity, own file" split (both
 * follow `app/(app)/work-orders/time-entries-actions.ts` sitting next to
 * `app/(app)/work-orders/actions.ts`) — see
 * `supabase/migrations/20260902090000_activity_notes_and_events.sql` for the
 * full schema/trigger/RLS design this file consumes but does not modify.
 *
 * `activity_events` is entirely read-only from the app: no INSERT/UPDATE/
 * DELETE grant exists at all (three `SECURITY DEFINER` triggers on
 * `activities`/`work_orders` are the only writers — see the migration's
 * design note 3). `listActivityEvents` below is therefore the only export
 * this file has.
 *
 * Translation of `event_type` into the exact Dutch display strings the
 * mockup uses ("Melding aangemaakt" etc.) is deliberately NOT done here —
 * this action returns the raw `event_type` plus resolved `actor`/
 * `related_work_order` so a client component can switch on the type and
 * build its own display string (and, for `work_order_linked`, its own
 * `WO-…`-style link) at render time.
 */

const uuidSchema = z.string().uuid("Invalid id.");

/** One of the three kinds `activity_events_event_type_valid` allows — kept as
 * a union type here (not just `string`) so a frontend switch over it is
 * exhaustively checked. */
export type ActivityEventType = "created" | "action_holder_changed" | "work_order_linked";

/** Shallow embed shape for the `related_work_order_id` FK — just enough for a
 * "WO-…" style link (`id` for the `/work-orders/[id]` href, `title` for the
 * label). `work_orders` has no separate human-readable code/number column
 * (see `WorkOrderRecord` in `app/(app)/work-orders/actions.ts`) — `title` is
 * the only displayable field beyond `id`, so that's what this mirrors
 * `ShallowNamedRecord`'s `{ id, name }` shape with, renamed to the column
 * that actually exists on `work_orders`. */
export interface ShallowWorkOrderRecord {
  id: string;
  title: string;
}

export interface ActivityEventRecord {
  id: string;
  organization_id: string;
  activity_id: string;
  action_holder_id: string;
  event_type: ActivityEventType;
  actor_id: string | null;
  related_work_order_id: string | null;
  occurred_at: string;
  /** Embedded via `users!activity_events_actor_id_fkey(...)` — the user who
   * caused this event (`null` only if that user's own row was hard-deleted,
   * `on delete set null`, same shape as `activities.reporter`). */
  actor: ShallowUserRecord | null;
  /** Embedded via `work_orders!activity_events_related_work_order_id_fkey(...)`
   * — set only for a `work_order_linked` event, per
   * `activity_events_related_work_order_matches_type`. */
  related_work_order: ShallowWorkOrderRecord | null;
}

const ACTIVITY_EVENT_SELECT =
  "*, actor:users!activity_events_actor_id_fkey(id,email,full_name), related_work_order:work_orders!activity_events_related_work_order_id_fkey(id,title)";

/**
 * Lists an activity's history/audit events, **ascending** `occurred_at` (the
 * design's Historie list reads top-to-bottom oldest-first, per the file
 * comment above) — the opposite order of `listActivityNotes`'s newest-first
 * feed. Same "no app-layer row filter, `activity_events_select_scoped`
 * already does the engineer-vs-everyone-else scoping via the denormalized
 * `action_holder_id`" reasoning as every other read in this module.
 */
export async function listActivityEvents(
  activityId: string,
): Promise<ActionResult<{ events: ActivityEventRecord[] }>> {
  const idResult = uuidSchema.safeParse(activityId);
  if (!idResult.success) return fail("Invalid activity id.");

  const ctx = await requireModuleContext("activities");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "activities", ["read", "read_own"])) {
    return fail("You do not have permission to view this activity's history.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("activity_events")
    .select(ACTIVITY_EVENT_SELECT)
    .eq("activity_id", idResult.data)
    .order("occurred_at", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ events: (data ?? []) as ActivityEventRecord[] });
}
