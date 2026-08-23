"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, canAny } from "@/lib/rbac/permissions";
import {
  addAdhocChecklistItemSchema,
  attachChecklistTemplateSchema,
  checklistItemNotesSchema,
  toggleChecklistItemSchema,
} from "./checklist-schema";

/**
 * Server Actions for a Work Order's checklist INSTANCE (issue #14, second
 * stage) — a sub-resource of Work Orders, same relationship `time_entries`
 * has to `work_orders` (see `./time-entries-actions.ts`). Kept in its own
 * file rather than folded into `actions.ts`, same reasoning that file's
 * sibling gives.
 *
 * Gated on the DEDICATED `"checklists"` RBAC module (lib/rbac/permissions.ts)
 * — NOT `"planning"` — per the schema agent's flag in
 * `supabase/migrations/20260823210000_checklists_core.sql` and
 * `docs/ARCHITECTURE.md`'s "Checklists" RBAC note: `planning`'s engineer row
 * was widened to `create_own` for Time Tracking, which would incorrectly
 * suggest an engineer can create a checklist instance too. The `checklists`
 * matrix row instead mirrors `work_orders`' OWN per-role shape exactly:
 *   owner/planner:          CRUD, all rows
 *   engineer:                read_own / update_own, own ASSIGNED work order's
 *                            checklist only (`assigned_to = auth.uid()`,
 *                            denormalized and actively kept in sync from the
 *                            parent work order); NO create, NO delete
 *   finance/administratie:  read, all rows
 *
 * There is exactly one `work_order_checklists` row per work order (DB
 * `unique (work_order_id)`) — `attachChecklistTemplate` creates it,
 * `detachChecklist` removes it entirely (delete + re-`attachChecklistTemplate`
 * is how you change which template a work order uses, per the migration's
 * design note 3: `work_order_id`/`checklist_template_id` are immutable after
 * creation).
 */

export interface WorkOrderChecklistRecord {
  id: string;
  work_order_id: string;
  checklist_template_id: string | null;
  organization_id: string;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
}

export interface WorkOrderChecklistItemRecord {
  id: string;
  work_order_checklist_id: string;
  template_item_id: string | null;
  organization_id: string;
  assigned_to: string | null;
  label: string;
  is_required: boolean;
  sort_order: number;
  is_checked: boolean;
  checked_by: string | null;
  checked_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const uuidSchema = z.string().uuid("Invalid id.");

/** Maps a DB error from a `work_order_checklists` write to a clean, user-safe
 * message. Adds the `23505` (unique_violation) case on top of the shared
 * `mapDbError` — the `unique (work_order_id)` constraint means attaching a
 * second checklist to a work order that already has one collides here, same
 * "local error mapping on top of the shared one" precedent
 * `contacts-actions.ts`'s `mapContactDbError` establishes for its own
 * `23505` case. */
function mapChecklistDbError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "This work order already has a checklist attached. Remove it first, or edit the existing one.";
  }
  return mapDbError(error);
}

/**
 * Returns the work order's checklist instance and its items, or
 * `checklist: null` (with an empty `items` array) if none has been attached
 * yet — this is NOT an error condition, same "empty is a valid state" UX
 * `listReferenceItems` gives for a not-yet-seeded list. Gated on
 * `canAny(actor, "checklists", ["read", "read_own"])`; for an engineer
 * (`read_own` only) this does NOT add an app-layer `assigned_to` filter — RLS
 * (`work_order_checklists_select_scoped` / `..._items_select_scoped`) already
 * scopes the result to their own assigned work order's checklist, same lesson
 * `listTimeEntries` documents in `./time-entries-actions.ts`.
 */
export async function getWorkOrderChecklist(
  workOrderId: string,
): Promise<ActionResult<{ checklist: WorkOrderChecklistRecord | null; items: WorkOrderChecklistItemRecord[] }>> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail("Invalid work order id.");

  const ctx = await requireModuleContext("checklists");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "checklists", ["read", "read_own"])) {
    return fail("You do not have permission to view this checklist.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: checklist, error } = await supabase
    .from("work_order_checklists")
    .select("*")
    .eq("work_order_id", idResult.data)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!checklist) return ok({ checklist: null, items: [] });

  const { data: items, error: itemsError } = await supabase
    .from("work_order_checklist_items")
    .select("*")
    .eq("work_order_checklist_id", (checklist as WorkOrderChecklistRecord).id)
    .order("sort_order", { ascending: true });

  if (itemsError) return fail(mapDbError(itemsError));

  return ok({
    checklist: checklist as WorkOrderChecklistRecord,
    items: (items ?? []) as WorkOrderChecklistItemRecord[],
  });
}

/**
 * Creates the `work_order_checklists` row for `workOrderId` — `templateId:
 * null` (or omitted) builds an ad-hoc, empty checklist; a real template id
 * fires the DB's `work_order_checklists_instantiate_items` trigger, which
 * snapshots that template's current items into `work_order_checklist_items`
 * in the same round trip (see the migration's design note 1) — this action
 * does not need to (and must not try to) copy items itself. Gated on
 * `can(actor, "checklists", "create")` (owner/planner only).
 */
export async function attachChecklistTemplate(
  workOrderId: string,
  templateId: string | null = null,
): Promise<ActionResult<{ checklist: WorkOrderChecklistRecord; items: WorkOrderChecklistItemRecord[] }>> {
  const idResult = uuidSchema.safeParse(workOrderId);
  if (!idResult.success) return fail("Invalid work order id.");

  const templateIdResult = attachChecklistTemplateSchema.safeParse(templateId ?? null);
  if (!templateIdResult.success) {
    return fail("Please fix the highlighted fields.", {
      templateId: templateIdResult.error.flatten().formErrors,
    });
  }

  const ctx = await requireModuleContext("checklists");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "checklists", "create")) {
    return fail("Only an owner or planner can attach a checklist to a work order.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: checklist, error } = await supabase
    .from("work_order_checklists")
    .insert({ work_order_id: idResult.data, checklist_template_id: templateIdResult.data })
    .select("*")
    .single();

  if (error) return fail(mapChecklistDbError(error));

  const { data: items, error: itemsError } = await supabase
    .from("work_order_checklist_items")
    .select("*")
    .eq("work_order_checklist_id", (checklist as WorkOrderChecklistRecord).id)
    .order("sort_order", { ascending: true });

  if (itemsError) return fail(mapDbError(itemsError));

  return ok({
    checklist: checklist as WorkOrderChecklistRecord,
    items: (items ?? []) as WorkOrderChecklistItemRecord[],
  });
}

/**
 * Checks/unchecks a single item. Gated on
 * `canAny(actor, "checklists", ["update", "update_own"])`; an engineer can
 * only touch items on their own assigned work order's checklist — RLS
 * (`work_order_checklist_items_update_scoped`) enforces this independently
 * of the app-layer gate, same split `time-entries-actions.ts`'s module
 * comment documents. `checked_by`/`checked_at` are stamped/cleared entirely
 * by the DB trigger (`set_checklist_item_checked_fields`) — never set here.
 */
export async function toggleChecklistItem(
  itemId: string,
  isChecked: unknown,
): Promise<ActionResult<{ item: WorkOrderChecklistItemRecord }>> {
  const idResult = uuidSchema.safeParse(itemId);
  if (!idResult.success) return fail("Invalid checklist item id.");

  const checkedResult = toggleChecklistItemSchema.safeParse(isChecked);
  if (!checkedResult.success) return fail("Invalid checked value.");

  const ctx = await requireModuleContext("checklists");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "checklists", ["update", "update_own"])) {
    return fail("You do not have permission to update this checklist item.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_order_checklist_items")
    .update({ is_checked: checkedResult.data })
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Checklist item not found, or you do not have permission to update it.");
  return ok({ item: data as WorkOrderChecklistItemRecord });
}

/** Same gate as `toggleChecklistItem`: `canAny(actor, "checklists", ["update",
 * "update_own"])`. `notes: null` (or an empty string) clears the note. */
export async function updateChecklistItemNotes(
  itemId: string,
  notes: unknown,
): Promise<ActionResult<{ item: WorkOrderChecklistItemRecord }>> {
  const idResult = uuidSchema.safeParse(itemId);
  if (!idResult.success) return fail("Invalid checklist item id.");

  const notesResult = checklistItemNotesSchema.safeParse(notes);
  if (!notesResult.success) {
    return fail("Please fix the highlighted fields.", { notes: notesResult.error.flatten().formErrors });
  }

  const ctx = await requireModuleContext("checklists");
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, "checklists", ["update", "update_own"])) {
    return fail("You do not have permission to update this checklist item.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_order_checklist_items")
    .update({ notes: notesResult.data })
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Checklist item not found, or you do not have permission to update it.");
  return ok({ item: data as WorkOrderChecklistItemRecord });
}

/**
 * Adds a bespoke item to an existing checklist instance, beyond whatever its
 * template snapshotted (or the first item(s) on a `checklist_template_id:
 * null` ad-hoc checklist). `template_item_id` is left `null` — a real column
 * default, and also excluded from the DB's INSERT column grant regardless
 * (see the migration's design note 4), so there's nothing to set here even
 * if we wanted to. Gated on `can(actor, "checklists", "create")` — adding
 * items beyond the template snapshot is an owner/planner action, same as
 * creating the checklist instance itself.
 */
export async function addAdhocChecklistItem(
  workOrderChecklistId: string,
  input: unknown,
): Promise<ActionResult<{ item: WorkOrderChecklistItemRecord }>> {
  const idResult = uuidSchema.safeParse(workOrderChecklistId);
  if (!idResult.success) return fail("Invalid checklist id.");

  const ctx = await requireModuleContext("checklists");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "checklists", "create")) {
    return fail("Only an owner or planner can add checklist items.");
  }

  const parsed = addAdhocChecklistItemSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row: Record<string, unknown> = {
    work_order_checklist_id: idResult.data,
    label: parsed.data.label,
    is_required: parsed.data.isRequired ?? false,
  };
  if (parsed.data.sortOrder !== undefined) row.sort_order = parsed.data.sortOrder;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_order_checklist_items")
    .insert(row)
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ item: data as WorkOrderChecklistItemRecord });
}

/** Owner/planner only (per the `checklists` RBAC row + RLS DELETE policy,
 * both agree — engineer has no `delete` action on `checklists` at all, same
 * "no gap to document" shape `deleteTimeEntry` documents for `planning`). */
export async function deleteChecklistItem(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid checklist item id.");

  const ctx = await requireModuleContext("checklists");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "checklists", "delete")) {
    return fail("Only an owner or planner can delete checklist items.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_order_checklist_items")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Checklist item not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}

/**
 * Deletes the ENTIRE checklist instance (its items cascade via `on delete
 * cascade` on `work_order_checklist_items.work_order_checklist_id`). This is
 * the "change which template this work order uses" path per the migration's
 * design note 3: `work_order_id`/`checklist_template_id` are immutable after
 * creation, so correcting a wrong choice is delete + `attachChecklistTemplate`
 * again, not an update. Owner/planner only.
 */
export async function detachChecklist(workOrderChecklistId: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(workOrderChecklistId);
  if (!idResult.success) return fail("Invalid checklist id.");

  const ctx = await requireModuleContext("checklists");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "checklists", "delete")) {
    return fail("Only an owner or planner can remove this checklist.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("work_order_checklists")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Checklist not found, or you do not have permission to remove it.");
  return ok({ deletedId: data.id as string });
}
