import { z } from "zod";

/**
 * Zod schemas for the Assets module, issue #9. See the comment at the top
 * of `app/(app)/clients/schema.ts` for why this is a plain module (not
 * `"use server"`) — `app/(app)/assets/actions.ts` imports these.
 */

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

function optionalText(max: number) {
  return z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());
}

const isoDateSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date in YYYY-MM-DD format.")
    .optional(),
);

export const assetCreateSchema = z.object({
  siteId: z.string().uuid("Invalid site id."),
  name: z.string().trim().min(1, "Name is required.").max(200, "Name is too long."),
  /** FK into this org's `asset_type` reference list
   * (`reference_list_items.id`) — see
   * supabase/migrations/20260822200000_reference_lists.sql. Required, no
   * default, same as the old free-text `type` column. Validated
   * server-side by the `validate_asset_reference_items` DB trigger (must
   * belong to the `asset_type` list, same organization). */
  typeId: z.string().uuid("Invalid asset type."),
  manufacturer: optionalText(200),
  model: optionalText(200),
  serialNumber: optionalText(200),
  /** FK into this org's `asset_status` reference list. Optional on create —
   * the `derive_asset_org_and_client` DB trigger fills in the org's default
   * `asset_status` item when omitted (replacing the old `default 'active'`
   * enum default). */
  statusId: z.string().uuid("Invalid asset status.").optional(),
  installedAt: isoDateSchema,
  warrantyUntil: isoDateSchema,
  notes: optionalText(5000),
});

export type AssetCreateInput = z.infer<typeof assetCreateSchema>;

/** `siteId` stays updatable (re-assigning an asset to a different site of
 * the same client/org); cross-organization re-parenting is still blocked at
 * the DB trigger layer (`derive_asset_org_and_client`) regardless. */
export const assetUpdateSchema = assetCreateSchema.partial();

export type AssetUpdateInput = z.infer<typeof assetUpdateSchema>;
