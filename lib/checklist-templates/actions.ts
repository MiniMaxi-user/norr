"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import {
  checklistTemplateCreateSchema,
  checklistTemplateItemCreateSchema,
  checklistTemplateItemUpdateSchema,
  checklistTemplateUpdateSchema,
} from "./schema";

/**
 * Server Actions for tenant-configurable Checklist Templates (issue #14,
 * second stage) — see `supabase/migrations/20260823210000_checklists_core.sql`
 * and `docs/ARCHITECTURE.md`'s "Checklists" entry.
 *
 * Deliberately placed under `lib/checklist-templates/` (not
 * `app/(app)/settings/checklist-templates/actions.ts`), mirroring
 * `lib/reference-lists/actions.ts`'s own choice: the Settings UI surfaces
 * this configuration (same as reference lists), but the mutation logic
 * itself isn't tied to any one route — `app/(app)/work-orders/
 * checklist-actions.ts` also reads template ids (`attachChecklistTemplate`)
 * without needing to import anything from here (the DB trigger does the
 * template-to-instance copy), but keeping template CRUD alongside the
 * reference-lists precedent keeps every "owner-managed org configuration"
 * mechanism in one predictable place.
 *
 * RBAC: per the schema agent's brief, this is configuration data at the same
 * tier as `reference_lists` — gated on the EXISTING `"settings"` module in
 * `lib/rbac/permissions.ts` (owner: CRUD, every other tenant role: `read`),
 * NOT the new `"checklists"` module (that one gates the work-order-instance
 * actions in `app/(app)/work-orders/checklist-actions.ts`). This mirrors the
 * DB RLS boundary exactly (`checklist_templates`/`checklist_template_items`:
 * SELECT any member, INSERT/UPDATE/DELETE owner only) — same "no gap to
 * document" note `lib/reference-lists/actions.ts`'s module comment makes.
 *
 * Same four-step preamble as every other module's actions: resolve module
 * context (`hasFeature` + RBAC actor) -> `can()` -> Zod validation -> query
 * under the caller's own session (RLS is always the real backstop).
 */

export interface ChecklistTemplateRecord {
  id: string;
  organization_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistTemplateItemRecord {
  id: string;
  checklist_template_id: string;
  organization_id: string;
  label: string;
  is_required: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const uuidSchema = z.string().uuid("Invalid id.");

/** Any org member can call this (needed to populate a "choose a checklist
 * template to attach" dropdown on a work order, in addition to the Settings
 * management screen). Ordered by name — templates have no `sort_order` of
 * their own (only their items do). */
export async function listChecklistTemplates(): Promise<
  ActionResult<{ templates: ChecklistTemplateRecord[] }>
> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "read")) {
    return fail("You do not have permission to view checklist templates.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("checklist_templates")
    .select("*")
    .order("name", { ascending: true });

  if (error) return fail(mapDbError(error));
  return ok({ templates: (data ?? []) as ChecklistTemplateRecord[] });
}

/** Returns a single template plus its items (ordered by `sort_order`), or a
 * clean not-found message if it doesn't exist or belongs to another
 * organization (RLS makes those two cases indistinguishable, same as every
 * other module's `get*` action in this codebase). */
export async function getChecklistTemplate(
  id: string,
): Promise<ActionResult<{ template: ChecklistTemplateRecord; items: ChecklistTemplateItemRecord[] }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid checklist template id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "read")) {
    return fail("You do not have permission to view this checklist template.");
  }

  const supabase = await createSupabaseServerClient();
  const { data: template, error } = await supabase
    .from("checklist_templates")
    .select("*")
    .eq("id", idResult.data)
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!template) return fail("Checklist template not found, or you do not have permission to view it.");

  const { data: items, error: itemsError } = await supabase
    .from("checklist_template_items")
    .select("*")
    .eq("checklist_template_id", idResult.data)
    .order("sort_order", { ascending: true });

  if (itemsError) return fail(mapDbError(itemsError));

  return ok({
    template: template as ChecklistTemplateRecord,
    items: (items ?? []) as ChecklistTemplateItemRecord[],
  });
}

/** Owner only (per the `settings` RBAC entry + RLS, both agree). */
export async function createChecklistTemplate(
  input: unknown,
): Promise<ActionResult<{ template: ChecklistTemplateRecord }>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "create")) {
    return fail("Only the organization owner can create checklist templates.");
  }

  const parsed = checklistTemplateCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("checklist_templates")
    .insert({ name: parsed.data.name })
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ template: data as ChecklistTemplateRecord });
}

/** Owner only (per the `settings` RBAC entry + RLS, both agree). */
export async function updateChecklistTemplate(
  id: string,
  input: unknown,
): Promise<ActionResult<{ template: ChecklistTemplateRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid checklist template id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "update")) {
    return fail("Only the organization owner can edit checklist templates.");
  }

  const parsed = checklistTemplateUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) row.name = parsed.data.name;

  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("checklist_templates")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Checklist template not found, or you do not have permission to edit it.");
  return ok({ template: data as ChecklistTemplateRecord });
}

/**
 * Owner only. Hard delete (cascades to `checklist_template_items` via `on
 * delete cascade`). Any `work_order_checklists` row that already instantiated
 * this template is unaffected — `checklist_template_id` there is `on delete
 * set null`, so an in-progress/completed instance keeps its own already-
 * snapshotted items regardless (see the migration's design notes).
 */
export async function deleteChecklistTemplate(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid checklist template id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "delete")) {
    return fail("Only the organization owner can delete checklist templates.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("checklist_templates")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Checklist template not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}

/** Owner only (per the `settings` RBAC entry + RLS, both agree). */
export async function createChecklistTemplateItem(
  templateId: string,
  input: unknown,
): Promise<ActionResult<{ item: ChecklistTemplateItemRecord }>> {
  const idResult = uuidSchema.safeParse(templateId);
  if (!idResult.success) return fail("Invalid checklist template id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "create")) {
    return fail("Only the organization owner can add checklist template items.");
  }

  const parsed = checklistTemplateItemCreateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row: Record<string, unknown> = {
    checklist_template_id: idResult.data,
    label: parsed.data.label,
    is_required: parsed.data.isRequired ?? false,
  };
  if (parsed.data.sortOrder !== undefined) row.sort_order = parsed.data.sortOrder;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("checklist_template_items")
    .insert(row)
    .select("*")
    .single();

  if (error) return fail(mapDbError(error));
  return ok({ item: data as ChecklistTemplateItemRecord });
}

/** Owner only (per the `settings` RBAC entry + RLS, both agree).
 * `checklist_template_id` is intentionally not updatable here — moving an
 * item between templates is meaningless (same reasoning
 * `updateReferenceItem` gives for `reference_list_id`) and is excluded from
 * the DB's UPDATE column grant regardless. */
export async function updateChecklistTemplateItem(
  id: string,
  input: unknown,
): Promise<ActionResult<{ item: ChecklistTemplateItemRecord }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid checklist template item id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "update")) {
    return fail("Only the organization owner can edit checklist template items.");
  }

  const parsed = checklistTemplateItemUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const row: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) row.label = parsed.data.label;
  if (parsed.data.isRequired !== undefined) row.is_required = parsed.data.isRequired;
  if (parsed.data.sortOrder !== undefined) row.sort_order = parsed.data.sortOrder;

  if (Object.keys(row).length === 0) {
    return fail("No changes provided.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("checklist_template_items")
    .update(row)
    .eq("id", idResult.data)
    .select("*")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Checklist template item not found, or you do not have permission to edit it.");
  return ok({ item: data as ChecklistTemplateItemRecord });
}

/** Owner only. Hard delete. */
export async function deleteChecklistTemplateItem(id: string): Promise<ActionResult<{ deletedId: string }>> {
  const idResult = uuidSchema.safeParse(id);
  if (!idResult.success) return fail("Invalid checklist template item id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  if (!can(ctx.context.actor, "settings", "delete")) {
    return fail("Only the organization owner can delete checklist template items.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("checklist_template_items")
    .delete()
    .eq("id", idResult.data)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Checklist template item not found, or you do not have permission to delete it.");
  return ok({ deletedId: data.id as string });
}
