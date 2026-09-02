"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { canAny } from "@/lib/rbac/permissions";
import type { ShallowUserRecord } from "./actions";

/**
 * Server Actions for the Activity ("Melding") detail page's Notes section
 * (`.design-handoff/melding_detail/README.md`, "Notes" — a feed of
 * `Callout`s under a `+ Note` action). Split into its own sibling file
 * rather than folded into `./actions.ts`, mirroring how
 * `app/(app)/work-orders/time-entries-actions.ts` sits next to
 * `app/(app)/work-orders/actions.ts` for the same "own sub-entity, own file"
 * reasoning — see `supabase/migrations/20260902090000_activity_notes_and_events.sql`
 * for the full schema/trigger/RLS design this file consumes but does not
 * modify.
 *
 * Same four-step preamble as every other module action (`requireModuleContext`
 * -> `canAny()` -> Zod -> query under the caller's own session, RLS is the
 * real backstop) — see the block comment at the top of `./actions.ts`.
 *
 * `activity_notes` denormalizes `organization_id` AND `action_holder_id` from
 * its parent `activities` row (derived server-side by the
 * `derive_activity_note_fields` trigger, kept in sync thereafter by
 * `activities_sync_dependents_action_holder`) — this is what lets
 * `activity_notes_select_scoped`/`activity_notes_insert_scoped` do all of the
 * real per-row engineer-vs-everyone-else scoping without either action here
 * adding an app-layer filter, same "RLS already does the row-scoping" note
 * `./actions.ts`'s module comment makes for `activities` itself.
 */

const uuidSchema = z.string().uuid("Invalid id.");

/** Same 5000-char ceiling as `activities.description`'s own Zod max in
 * `./schema.ts` (mirrors `activity_notes_body_max_length`'s DB check). A
 * single-field action, so validated inline here rather than added to
 * `./schema.ts` — same precedent `app/(app)/work-orders/time-entries-actions.ts`'s
 * `clockIn`/`clockOut` set for their own single/few-field inputs, not routed
 * through a shared `schema.ts` object schema. */
const activityNoteBodySchema = z
  .string()
  .trim()
  .min(1, "Note text is required.")
  .max(5000, "Note text is too long.");

export interface ActivityNoteRecord {
  id: string;
  organization_id: string;
  activity_id: string;
  action_holder_id: string;
  body: string;
  created_by: string | null;
  created_at: string;
  /** Embedded via `users!activity_notes_created_by_fkey(...)` — the note's
   * author, for the feed's byline. `null` only if the authoring user's own
   * row was hard-deleted out from under this note (`on delete set null`,
   * same shape as `activities.reporter`). */
  created_by_user: ShallowUserRecord | null;
}

const ACTIVITY_NOTE_SELECT =
  "*, created_by_user:users!activity_notes_created_by_fkey(id,email,full_name)";

/**
 * Lists an activity's notes, newest first (the design's Notes section reads
 * as a feed, most recent `Callout` on top). Org/row scoping is entirely
 * `activity_notes_select_scoped`'s job (engineer callers already only see
 * rows where the denormalized `action_holder_id` is their own) — no app-layer
 * filter added here, same reasoning `listActivities`/`getActivity` document
 * in `./actions.ts`.
 */
export async function listActivityNotes(
  activityId: string,
): Promise<ActionResult<{ notes: ActivityNoteRecord[] }>> {
  const idResult = uuidSchema.safeParse(activityId);
  if (!idResult.success) return fail("Invalid activity id.");

  const ctx = await requireModuleContext("activities");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "activities", ["read", "read_own"])) {
    return fail("You do not have permission to view this activity's notes.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("activity_notes")
    .select(ACTIVITY_NOTE_SELECT)
    .eq("activity_id", idResult.data)
    .order("created_at", { ascending: false });

  if (error) return fail(mapDbError(error));
  return ok({ notes: (data ?? []) as ActivityNoteRecord[] });
}

/**
 * Adds a note to an activity. Gated on `canAny(actor, "activities", ["update",
 * "update_own"])` — the same permission pair the rest of the detail page's
 * edit affordances use (per the design handoff, the `+ Note` button itself is
 * only rendered when the page isn't `readOnly`, which is computed from this
 * same pair), NOT a separate notes-specific permission. Only `activity_id`
 * and `body` are ever sent — `organization_id`/`action_holder_id` are
 * trigger-derived (`derive_activity_note_fields`) and excluded from the
 * table's own INSERT grant, `created_by` is stamped by `set_created_by()`; an
 * engineer whose `action_holder_id` doesn't match `auth.uid()` on the parent
 * activity is rejected by `activity_notes_insert_scoped`'s `WITH CHECK`
 * (surfaced as a clean `mapDbError` `42501` message), same "RLS is still the
 * real backstop" trust boundary the rest of this module uses.
 */
export async function createActivityNote(
  activityId: string,
  body: string,
): Promise<ActionResult<{ note: ActivityNoteRecord }>> {
  const idResult = uuidSchema.safeParse(activityId);
  if (!idResult.success) return fail("Invalid activity id.");

  const ctx = await requireModuleContext("activities");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "activities", ["update", "update_own"])) {
    return fail("You do not have permission to add notes to this activity.");
  }

  const parsed = activityNoteBodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid note text.", {
      body: [parsed.error.issues[0]?.message ?? "Invalid note text."],
    });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("activity_notes")
    .insert({ activity_id: idResult.data, body: parsed.data })
    .select(ACTIVITY_NOTE_SELECT)
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ note: data as ActivityNoteRecord });
}
