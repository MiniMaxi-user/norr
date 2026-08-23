import { z } from "zod";

/**
 * Zod schemas for tenant-configurable Checklist Templates (issue #14, second
 * stage) — see `supabase/migrations/20260823210000_checklists_core.sql` and
 * `lib/checklist-templates/actions.ts`. Plain module (not `"use server"`),
 * mirroring the split every other module's `schema.ts`/`actions.ts` pair uses
 * (see `lib/reference-lists/schema.ts`).
 */

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

export const checklistTemplateCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
});

export type ChecklistTemplateCreateInput = z.infer<typeof checklistTemplateCreateSchema>;

/** Every field optional for update (partial edit) — same "partial of create"
 * shape as every other module's `*UpdateSchema` (see
 * `lib/reference-lists/schema.ts`). `name` is in practice the only editable
 * column today (see the migration's column-grant lockdown). */
export const checklistTemplateUpdateSchema = checklistTemplateCreateSchema.partial();

export type ChecklistTemplateUpdateInput = z.infer<typeof checklistTemplateUpdateSchema>;

export const checklistTemplateItemCreateSchema = z.object({
  label: z.string().trim().min(1, "Label is required.").max(500, "Label is too long."),
  isRequired: z.boolean().optional(),
  /** Ordering within the template. Optional — the DB column defaults to `0`
   * when omitted, same UX as `referenceItemCreateSchema.sortOrder`. */
  sortOrder: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(100000).optional()),
});

export type ChecklistTemplateItemCreateInput = z.infer<typeof checklistTemplateItemCreateSchema>;

/** Every field optional for update; `checklist_template_id` is intentionally
 * not a field here at all — it's immutable after creation (excluded from the
 * DB's UPDATE column grant, see the migration's design note 3-adjacent
 * comment on `checklist_template_items`), and is passed as
 * `createChecklistTemplateItem`'s own function argument on create rather than
 * a schema field, same convention `contactCreateSchema` established for
 * omitting `clientId`. */
export const checklistTemplateItemUpdateSchema = checklistTemplateItemCreateSchema.partial();

export type ChecklistTemplateItemUpdateInput = z.infer<typeof checklistTemplateItemUpdateSchema>;
