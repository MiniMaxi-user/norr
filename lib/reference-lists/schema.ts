import { z } from "zod";

/**
 * Zod schemas for tenant-configurable reference lists ("picklists") — see
 * `supabase/migrations/20260822200000_reference_lists.sql` and
 * `lib/reference-lists/actions.ts`. Plain module (not `"use server"`),
 * mirroring the split every other module's `schema.ts`/`actions.ts` pair
 * uses (see `app/(app)/assets/schema.ts`).
 */

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

/** Matches `reference_lists.list_key`'s check constraint
 * (`^[a-z][a-z0-9_]*$`) — e.g. `asset_type`, `asset_status`, future
 * `contract_type`. Not a closed enum here on purpose: new list keys are a
 * data/seeding concern (`seed_default_reference_lists` in the migration),
 * not a schema-migration concern, so this Zod schema shouldn't hardcode the
 * known set either. */
export const listKeySchema = z
  .string()
  .trim()
  .min(1, "List key is required.")
  .max(100, "List key is too long.")
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "List key must be lowercase letters, numbers, and underscores, and start with a letter.",
  );

/** Matches `reference_list_items.value`'s check constraint
 * (`^[a-z0-9][a-z0-9_]*$`) — the stable machine slug for a picklist value. */
export const referenceItemValueSchema = z
  .string()
  .trim()
  .min(1, "Value is required.")
  .max(100, "Value is too long.")
  .regex(
    /^[a-z0-9][a-z0-9_]*$/,
    "Value must be lowercase letters, numbers, and underscores, and start with a letter or number.",
  );

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/** Small fixed palette offered as convenience swatches in the UI. Not the
 * only allowed values — `reference_list_items.color` has no DB-level check
 * constraint, and an owner may reasonably want a specific brand hex — so a
 * hex code is accepted too (validated by `HEX_COLOR_REGEX`). */
export const REFERENCE_ITEM_COLOR_PALETTE = [
  "gray",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;

export const referenceItemColorSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .max(20, "Color is too long.")
    .refine(
      (value) =>
        HEX_COLOR_REGEX.test(value) ||
        (REFERENCE_ITEM_COLOR_PALETTE as readonly string[]).includes(value),
      `Color must be a hex code (e.g. #22c55e) or one of: ${REFERENCE_ITEM_COLOR_PALETTE.join(", ")}.`,
    )
    .optional(),
);

export const referenceItemCreateSchema = z.object({
  value: referenceItemValueSchema,
  label: z.string().trim().min(1, "Label is required.").max(200, "Label is too long."),
  color: referenceItemColorSchema,
  sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
});

export type ReferenceItemCreateInput = z.infer<typeof referenceItemCreateSchema>;

/** All fields optional for update — same "partial of create" shape as every
 * other module's `*UpdateSchema` (see `app/(app)/assets/schema.ts`). */
export const referenceItemUpdateSchema = referenceItemCreateSchema.partial();

export type ReferenceItemUpdateInput = z.infer<typeof referenceItemUpdateSchema>;
