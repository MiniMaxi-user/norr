import { z } from "zod";

/**
 * Zod schemas for a Work Order's checklist INSTANCE (issue #14, second
 * stage) — see `app/(app)/work-orders/checklist-actions.ts` and
 * `supabase/migrations/20260823210000_checklists_core.sql`. Sibling to
 * `schema.ts`'s Time Entries section: kept in its own file (not folded into
 * `schema.ts`) since this is a large enough sub-resource (two tables, six
 * actions) to warrant it, same reasoning `time-entries-actions.ts` gives for
 * being its own action file rather than living in `actions.ts`.
 *
 * There is deliberately no `workOrderId`/`workOrderChecklistId`/`itemId`
 * field on any schema below — same convention `contactCreateSchema` and the
 * Time Entries schemas above establish: those are passed as each action's
 * own function argument (validated with the shared `uuidSchema` in
 * `checklist-actions.ts`), not a schema field, since every one of these
 * actions is always scoped to one specific work order / checklist / item
 * already.
 */

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

/**
 * `attachChecklistTemplate(workOrderId, templateId)`'s second argument shape:
 * a valid uuid, or `null`/absent for an ad-hoc (empty) checklist with no
 * template. Not wrapped in an object — mirrors how `clockOut(id)` etc. take
 * bare scalar arguments rather than an `{ id }` object for a single-value
 * input.
 */
export const attachChecklistTemplateSchema = z.preprocess(
  emptyToUndefined,
  z.string().uuid("Invalid checklist template.").nullable(),
);

/** `toggleChecklistItem(itemId, isChecked)`'s second argument shape. */
export const toggleChecklistItemSchema = z.boolean({
  invalid_type_error: "Expected a true/false checked value.",
});

/** `updateChecklistItemNotes(itemId, notes)`'s second argument shape. An
 * empty string is treated the same as `null` (clearing the notes), same
 * "empty means absent/cleared" convention `optionalText()` in `schema.ts`
 * uses for other free-text fields. */
export const checklistItemNotesSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().max(5000, "Notes are too long.").nullable(),
);

/**
 * `addAdhocChecklistItem(workOrderChecklistId, input)`'s input shape — an
 * owner/planner adding a bespoke item beyond whatever the template
 * snapshotted (or building an instance up from scratch on a
 * `checklist_template_id: null` checklist). `sortOrder` is optional (not
 * mentioned in the original brief but present on the underlying column,
 * same "optional, DB defaults to 0 when omitted" UX as
 * `checklistTemplateItemCreateSchema.sortOrder` in
 * `lib/checklist-templates/schema.ts`) — lets a caller place a new ad-hoc
 * item anywhere in the list instead of every ad-hoc addition tying at `0`.
 */
export const addAdhocChecklistItemSchema = z.object({
  label: z.string().trim().min(1, "Label is required.").max(500, "Label is too long."),
  isRequired: z.boolean().optional(),
  sortOrder: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(100000).optional()),
});

export type AddAdhocChecklistItemInput = z.infer<typeof addAdhocChecklistItemSchema>;
