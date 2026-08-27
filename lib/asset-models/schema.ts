import { z } from "zod";

/**
 * Zod schemas for `public.asset_models` (issue #54 — see
 * `supabase/migrations/20260826160000_asset_brand_and_models.sql`). Plain
 * module (not `"use server"`), mirroring the split every other module's
 * `schema.ts`/`actions.ts` pair uses (see `lib/reference-lists/schema.ts`).
 *
 * Unlike most of this codebase's `*UpdateSchema`s (a true `.partial()` of
 * their create schema, where an omitted field means "leave unchanged" — see
 * `lib/reference-lists/schema.ts`), `assetModelUpdateSchema` below is NOT a
 * partial: `AssetModelFormDialog` always submits the full record on every
 * save (create or edit), the same way `ReferenceItemFormDialog` always
 * submits `label`+`value` together. A true partial would make "leave
 * `subtypeItemId` unchanged" and "explicitly clear `subtypeItemId` back to
 * no sub-type" both serialize to the same `undefined`, with no way for
 * `updateAssetModel` to tell them apart — exactly the ambiguity this
 * feature's own "changing Type clears a previously-selected Sub-type"
 * requirement needs to NOT have. Full-replace-on-every-save sidesteps it
 * entirely: `updateAssetModel` always writes `subtype_item_id` from
 * whatever the form sent (`null` when cleared), never conditionally skips
 * it.
 */

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const uuidSchema = z.string().uuid("Invalid id.");

export const assetModelNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(200, "Name is too long.");

/** Matches `asset_models.default_warranty_months`'s check constraint
 * (`> 0`). */
export const assetModelWarrantyMonthsSchema = z.coerce
  .number({ invalid_type_error: "Warranty must be a number." })
  .int("Warranty must be a whole number of months.")
  .min(1, "Warranty must be at least 1 month.")
  .max(600, "Warranty is too long.");

const subtypeItemIdField = z.preprocess(emptyToUndefined, uuidSchema.optional());

/** `defaultWarrantyMonths` optional here (and only here) — `createAssetModel`
 * defaults it to 24 when omitted, per issue #54's acceptance criteria. */
export const assetModelCreateSchema = z.object({
  brandItemId: uuidSchema,
  typeItemId: uuidSchema,
  subtypeItemId: subtypeItemIdField,
  name: assetModelNameSchema,
  defaultWarrantyMonths: z.preprocess(emptyToUndefined, assetModelWarrantyMonthsSchema.optional()),
});

export type AssetModelCreateInput = z.infer<typeof assetModelCreateSchema>;

/** Full-replace shape — see the module doc comment above for why this is
 * NOT `assetModelCreateSchema.partial()`. `defaultWarrantyMonths` is
 * required here (the edit form always has a real current value to submit,
 * unlike create's "default to 24 if the field is blank" affordance). */
export const assetModelUpdateSchema = z.object({
  brandItemId: uuidSchema,
  typeItemId: uuidSchema,
  subtypeItemId: subtypeItemIdField,
  name: assetModelNameSchema,
  defaultWarrantyMonths: assetModelWarrantyMonthsSchema,
});

export type AssetModelUpdateInput = z.infer<typeof assetModelUpdateSchema>;
