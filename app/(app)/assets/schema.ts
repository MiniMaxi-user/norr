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
  /** Displayed as "Asset ID" in the UI. Optional (issue #105) — when omitted
   * or left blank, the `assets_set_default_name` DB trigger
   * (`supabase/migrations/20260831090000_assets_auto_generate_asset_id.sql`)
   * assigns the next sequential `AST-00042`-style id for the org. `undefined`
   * here (via `emptyToUndefined`) is what makes that trigger fire — an
   * explicit empty string sent to the DB would violate `not null` instead. */
  name: z.preprocess(emptyToUndefined, z.string().trim().max(200, "Name is too long.").optional()),
  /** FK into this org's `asset_type` reference list
   * (`reference_list_items.id`) — see
   * supabase/migrations/20260822200000_reference_lists.sql. Required, no
   * default, same as the old free-text `type` column. Validated
   * server-side by the `validate_asset_reference_items` DB trigger (must
   * belong to the `asset_type` list, same organization). */
  typeId: z.string().uuid("Invalid asset type."),
  /** Free-text external/legacy reference (e.g. an ERP or previous system's
   * asset id) — see `assets.external_reference`'s column comment in
   * `supabase/migrations/20260826170000_assets_external_reference_brand_model.sql`.
   * No FK, no validation, same shape as `notes`. */
  externalReference: optionalText(200),
  /** FK into this org's `asset_brand` reference list
   * (`reference_list_items.id`). Replaces the old free-text `manufacturer`
   * field. Optional/nullable — Brand is not required at the asset level.
   * Validated server-side by the `validate_asset_reference_items` DB
   * trigger (must belong to the `asset_brand` list, same organization); a
   * defense-in-depth shape check also runs in `actions.ts` before insert/
   * update, mirroring `validateAssetSubtype`. */
  brandItemId: z.string().uuid("Invalid brand.").optional(),
  /** FK into `asset_models` (see
   * `supabase/migrations/20260826160000_asset_brand_and_models.sql`).
   * Replaces the old free-text `model` field. Optional/nullable. Validated
   * server-side to belong to the asset's own organization — deliberately
   * NOT cross-checked against this asset's own `typeId`/`subtypeId`/
   * `brandItemId` (see design note 3 in the `20260826170000` migration);
   * auto-filling those fields from a selected model is a UI convenience,
   * not a DB invariant. */
  modelId: z.string().uuid("Invalid model.").optional(),
  serialNumber: optionalText(200),
  /** FK into this org's `asset_status` reference list. Optional on create —
   * the `derive_asset_org_and_client` DB trigger fills in the org's default
   * `asset_status` item when omitted (replacing the old `default 'active'`
   * enum default). */
  statusId: z.string().uuid("Invalid asset status.").optional(),
  /** FK into this org's `asset_subtype` reference list
   * (`reference_list_items.id`) — see
   * `supabase/migrations/20260823090000_contacts_dependent_reference_lists.sql`.
   * Optional/nullable, unlike `typeId`: not every asset needs a sub-type.
   * `asset_subtype` is a *dependent* list (`parent_list_key = 'asset_type'`):
   * whatever is selected here must be a sub-type of this asset's own
   * `typeId`. Shape (uuid, belongs to the `asset_subtype` list) is validated
   * in `actions.ts` before the insert/update is attempted; the actual
   * cross-field "must be a sub-type of typeId" check is left to the
   * `validate_asset_reference_items` DB trigger, which raises a `23514`
   * mapped to a clean message by `mapDbError` when it's inconsistent. */
  subtypeId: z.string().uuid("Invalid asset sub-type.").optional(),
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
