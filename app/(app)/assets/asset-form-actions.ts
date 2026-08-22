"use server";

import { createAsset, updateAsset, type AssetRecord } from "./actions";

/**
 * Thin `useActionState`-shaped adapters over the real `createAsset`/
 * `updateAsset` Server Actions in `./actions.ts` (which take a parsed
 * object, not `FormData`). Kept in this separate file (rather than added to
 * `actions.ts`) since that file is the co-located backend half of issue #9
 * and out of this pass's scope to modify.
 *
 * Mirrors the `AuthActionState` / `useActionState` pattern from
 * `app/(auth)/login/login-form.tsx`: the client form calls `useActionState`
 * with one of these, which internally calls the real action and re-shapes
 * `ActionResult<T>` into a small `ok`/`error`/`fieldErrors` state the form
 * can render directly.
 */
export interface AssetFormState {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  asset?: AssetRecord;
}

// NOTE: no `initialAssetFormState` export here — a `"use server"` file may
// only export async functions (plus type-only exports, which are erased at
// compile time and don't count). Client components define their own
// `const initialState: AssetFormState = { ok: false }`, same as
// `app/(auth)/login/login-form.tsx` does with `AuthActionState`.

function readField(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

/** Same as `readField`, but an empty string (e.g. a "Use default…"
 * placeholder option left selected) is also treated as absent — needed for
 * `statusId`, which is optional (the DB fills in the org's default
 * `asset_status` item when omitted) and whose `<Select>` therefore has a
 * blank/placeholder option rather than being `required` like `typeId`'s. */
function readOptionalField(formData: FormData, key: string): string | undefined {
  const value = readField(formData, key);
  return value && value.length > 0 ? value : undefined;
}

function formDataToAssetInput(formData: FormData) {
  return {
    siteId: readField(formData, "siteId"),
    name: readField(formData, "name"),
    typeId: readField(formData, "typeId"),
    manufacturer: readField(formData, "manufacturer"),
    model: readField(formData, "model"),
    serialNumber: readField(formData, "serialNumber"),
    statusId: readOptionalField(formData, "statusId"),
    installedAt: readField(formData, "installedAt"),
    warrantyUntil: readField(formData, "warrantyUntil"),
    notes: readField(formData, "notes"),
  };
}

/** `useActionState` action for the "create asset" dialog. */
export async function createAssetFormAction(
  _prevState: AssetFormState,
  formData: FormData,
): Promise<AssetFormState> {
  const result = await createAsset(formDataToAssetInput(formData));
  if (!result.data) {
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }
  return { ok: true, asset: result.data.asset };
}

/**
 * `useActionState` action for the "edit asset" dialog. Bind the asset id
 * first (`updateAssetFormAction.bind(null, asset.id)`) before passing it to
 * `useActionState`, same idiom as any other Server Action that needs an
 * extra fixed argument alongside `(state, formData)`.
 *
 * Note: per the "Known gap" comment in `./actions.ts`, a Planner's update
 * can come back here as `{ ok: false, error: "Asset not found, or you do
 * not have permission to update it." }` even though the UI shows the edit
 * affordance to them (RBAC `can()` allows it; RLS doesn't yet). Don't
 * swallow that error — the caller renders `state.error` as-is.
 */
export async function updateAssetFormAction(
  id: string,
  _prevState: AssetFormState,
  formData: FormData,
): Promise<AssetFormState> {
  const result = await updateAsset(id, formDataToAssetInput(formData));
  if (!result.data) {
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }
  return { ok: true, asset: result.data.asset };
}
