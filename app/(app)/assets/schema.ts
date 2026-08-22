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

/** Mirrors the Postgres `asset_status` enum (`'active' | 'decommissioned'`)
 * from supabase/migrations/20260822190000_clients_sites_assets.sql. */
export const assetStatusSchema = z.enum(["active", "decommissioned"]);
export type AssetStatus = z.infer<typeof assetStatusSchema>;

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
  type: z.string().trim().min(1, "Type is required.").max(100, "Type is too long."),
  manufacturer: optionalText(200),
  model: optionalText(200),
  serialNumber: optionalText(200),
  status: assetStatusSchema.optional(),
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
