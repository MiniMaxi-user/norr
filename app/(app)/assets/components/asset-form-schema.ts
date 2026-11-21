import type { DirtyField, EditSchema, SaveResult } from "@yourorg/ui/web-client";
import { createAsset, updateAsset } from "../actions";
import type { AssetErrorInfo } from "../asset-errors";
import { draftToInput, type AssetDraft } from "./asset-draft";

/**
 * Edit-mode schema for the Asset page (design system, issue #222): label,
 * required marker and validation per field. Mirrors `../schema.ts`
 * (`assetCreateSchema`) — the server stays the authority — with messages that
 * say what is wrong and how to fix it.
 */

function tooLong(label: string, value: string, max: number) {
  const length = value.trim().length;
  return length > max ? `${label} is ${length} characters, the maximum is ${max}. Remove ${length - max}` : null;
}

export function buildAssetSchema(options: {
  labelFor: (
    key: "modelId" | "typeId" | "statusId" | "siteId" | "clientId" | "brandItemId" | "subtypeId" | "previousAssetId",
    id: string,
  ) => string;
  /** New mode: the Asset ID is assigned by the database (numbering), so it is
   * not an input and not validated. */
  isNew?: boolean;
}): EditSchema<AssetDraft> {
  const { labelFor, isNew } = options;
  return {
    clientId: {
      label: "Client",
      required: true,
      format: (value) => (value ? labelFor("clientId", value) : ""),
      validate: (value) => (value ? null : "Choose a client"),
    },
    siteId: {
      label: "Site",
      required: true,
      format: (value) => (value ? labelFor("siteId", value) : ""),
      validate: (value) => (value ? null : "Choose a site of this client"),
    },
    name: {
      label: "Asset ID",
      required: !isNew,
      validate: (value) => (isNew ? null : value.trim() ? tooLong("Asset ID", value, 200) : "Enter an asset ID"),
    },
    typeId: {
      label: "Type",
      required: true,
      format: (value) => (value ? labelFor("typeId", value) : ""),
      validate: (value) => (value ? null : "Choose a type"),
    },
    subtypeId: { label: "Sub-type", format: (value) => (value ? labelFor("subtypeId", value) : "") },
    brandItemId: { label: "Brand", format: (value) => (value ? labelFor("brandItemId", value) : "") },
    modelId: {
      label: "Model",
      required: true,
      format: (value) => (value ? labelFor("modelId", value) : ""),
      validate: (value) => (value ? null : "Choose a model"),
    },
    serialNumber: {
      label: "Serial number",
      required: true,
      validate: (value) => (value.trim() ? tooLong("Serial number", value, 200) : "Enter a serial number"),
    },
    statusId: {
      label: "Status",
      required: true,
      format: (value) => (value ? labelFor("statusId", value) : ""),
      validate: (value) => (value ? null : "Choose a status"),
    },
    previousAssetId: {
      label: "Previous asset",
      format: (value) => (value ? labelFor("previousAssetId", value) : ""),
    },
    externalReference: {
      label: "External reference",
      validate: (value) => tooLong("External reference", value, 200),
    },
    installedAt: {
      label: "Installed on",
      required: true,
      validate: (value) => {
        if (!value) return "Enter the installation date";
        return /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "Enter a date as dd-mm-yyyy, for example 17-11-2026";
      },
    },
    warrantyUntil: {
      label: "Warranty until",
      validate: (value, draft) => {
        if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Enter a date as dd-mm-yyyy, for example 17-11-2026";
        if (value && draft.installedAt && value < draft.installedAt) {
          return "Warranty ends before the installation date. Choose a later date";
        }
        return null;
      },
    },
    notes: { label: "Notes", validate: (value) => tooLong("Notes", value, 5000) },
  };
}

type DraftKey = keyof AssetDraft & string;

function firstFieldErrors(fieldErrors: Record<string, string[] | undefined> | undefined) {
  const mapped: Partial<Record<DraftKey, string>> = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    if (messages?.[0]) mapped[key as DraftKey] = messages[0];
  }
  return mapped;
}

/** Persists an edited asset through the existing `updateAsset` action (RBAC,
 * zod validation and RLS unchanged) — only the changed fields are sent. */
export async function saveAssetEdits(
  assetId: string,
  draft: AssetDraft,
  dirty: DirtyField<AssetDraft>[],
  /** Receives the structured error of a refused save (contracts to remove the asset from, serial in use...). */
  onErrorInfo?: (info: AssetErrorInfo | undefined) => void,
): Promise<SaveResult<AssetDraft>> {
  const patch: Partial<AssetDraft> = {};
  for (const entry of dirty) (patch as Record<string, unknown>)[entry.key] = draft[entry.key];
  const input = draftToInput(patch);
  if (Object.keys(input).length === 0) return { ok: true };
  const result = await updateAsset(assetId, input);
  onErrorInfo?.(result.errorInfo);
  if (!result.data) return { ok: false, error: result.error, fieldErrors: firstFieldErrors(result.fieldErrors) };
  return { ok: true };
}

/** Creates an asset (new mode) through `createAsset`; resolves with the new
 * id so the page can open its read page. */
export async function createAssetFromDraft(
  draft: AssetDraft,
  onErrorInfo?: (info: AssetErrorInfo | undefined) => void,
): Promise<{ result: SaveResult<AssetDraft>; assetId?: string }> {
  const input = draftToInput(draft);
  if (input.previousAssetId === null) delete input.previousAssetId;
  const created = await createAsset(input);
  onErrorInfo?.(created.errorInfo);
  if (!created.data) {
    return { result: { ok: false, error: created.error, fieldErrors: firstFieldErrors(created.fieldErrors) } };
  }
  return { result: { ok: true }, assetId: created.data.asset.id };
}
