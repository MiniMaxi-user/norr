import type { AssetRecord } from "../actions";

/**
 * The asset's own editable fields, as one flat draft object — the single
 * source of truth `AssetScreen` owns for the unified create/view/edit screen
 * (asset new/edit design handoff v3, mirroring `work-order-draft.ts`). Every
 * section of the page (hero header pencil, relation cards + their edit
 * popups, Equipment/Status & warranty/Notes inline-edit sections) reads from
 * this and writes back through `AssetScreen`'s own `commitPatch`.
 *
 * `clientId` is carried here purely for the UI's own cascade/relation-card
 * needs (picking a client scopes the Site select, drives the Contract card's
 * "this client's contracts" list) — it is NOT one of `assetCreateSchema`/
 * `assetUpdateSchema`'s fields and is never sent to `createAsset`/
 * `updateAsset` (see `draftToInput` below): the DB derives an asset's
 * `client_id` from its `site_id` at the trigger layer, same as the old
 * `asset-form-screen.tsx`'s hidden-`siteId`-only submission this replaces.
 */
export interface AssetDraft {
  clientId: string;
  siteId: string;
  name: string;
  typeId: string;
  subtypeId: string;
  brandItemId: string;
  modelId: string;
  serialNumber: string;
  statusId: string;
  externalReference: string;
  installedAt: string;
  warrantyUntil: string;
  notes: string;
}

export function draftFromAsset(asset: AssetRecord): AssetDraft {
  return {
    clientId: asset.client_id,
    siteId: asset.site_id,
    name: asset.name,
    typeId: asset.type_id,
    subtypeId: asset.subtype_id ?? "",
    brandItemId: asset.brand_item_id ?? "",
    modelId: asset.model_id ?? "",
    serialNumber: asset.serial_number ?? "",
    statusId: asset.status_id,
    externalReference: asset.external_reference ?? "",
    installedAt: asset.installed_at ?? "",
    warrantyUntil: asset.warranty_until ?? "",
    notes: asset.notes ?? "",
  };
}

export function emptyDraft(options: {
  /** Pre-scopes (and, per `AssetScreen`'s own `lockedClientId` handling,
   * hides the picker for) the client — the Clients detail page's Assets tab,
   * or `/assets/new?clientId=...`. */
  lockedClientId?: string;
  /** Pre-selects (but doesn't lock) the site — `/assets/new?siteId=...`. */
  initialSiteId?: string;
}): AssetDraft {
  return {
    clientId: options.lockedClientId ?? "",
    siteId: options.initialSiteId ?? "",
    name: "",
    typeId: "",
    subtypeId: "",
    brandItemId: "",
    modelId: "",
    serialNumber: "",
    statusId: "",
    externalReference: "",
    installedAt: "",
    warrantyUntil: "",
    notes: "",
  };
}

/** Converts a draft (or a partial patch of one) into the shape
 * `createAsset`/`updateAsset` (`../actions.ts`) expect — empty-string "unset"
 * values become `undefined` (not sent) rather than an empty string that
 * would fail the schema's `uuid()`/date shape checks. `clientId` is
 * deliberately never included — see the `AssetDraft.clientId` doc comment
 * above. */
export function draftToInput(patch: Partial<AssetDraft>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (patch.siteId !== undefined) input.siteId = patch.siteId || undefined;
  if (patch.name !== undefined) input.name = patch.name || undefined;
  if (patch.typeId !== undefined) input.typeId = patch.typeId || undefined;
  if (patch.subtypeId !== undefined) input.subtypeId = patch.subtypeId || undefined;
  if (patch.brandItemId !== undefined) input.brandItemId = patch.brandItemId || undefined;
  if (patch.modelId !== undefined) input.modelId = patch.modelId || undefined;
  if (patch.serialNumber !== undefined) input.serialNumber = patch.serialNumber || undefined;
  if (patch.statusId !== undefined) input.statusId = patch.statusId || undefined;
  if (patch.externalReference !== undefined) input.externalReference = patch.externalReference || undefined;
  if (patch.installedAt !== undefined) input.installedAt = patch.installedAt || undefined;
  if (patch.warrantyUntil !== undefined) input.warrantyUntil = patch.warrantyUntil || undefined;
  if (patch.notes !== undefined) input.notes = patch.notes || undefined;
  return input;
}
