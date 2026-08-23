"use server";

import { createWorkOrder, updateWorkOrder, type WorkOrderRecord } from "./actions";

/**
 * Thin `useActionState`-shaped adapters over the real `createWorkOrder`/
 * `updateWorkOrder` Server Actions in `./actions.ts` (which take a parsed
 * object, not `FormData`) — same pattern as `app/(app)/assets/asset-form-actions.ts`.
 * Kept in this separate file for the same reason: `./actions.ts` is the
 * co-located backend half of issue #13 and out of this pass's scope to
 * modify.
 */
export interface WorkOrderFormState {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  workOrder?: WorkOrderRecord;
}

function readField(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

/** Same as `readField`, but an empty string (a placeholder option left
 * selected, or a hidden ISO-datetime field left blank) is also treated as
 * absent — needed for every optional field below whose `<Select>`/`<input>`
 * has a blank/placeholder state. */
function readOptionalField(formData: FormData, key: string): string | undefined {
  const value = readField(formData, key);
  return value && value.length > 0 ? value : undefined;
}

function formDataToWorkOrderInput(formData: FormData) {
  return {
    clientId: readField(formData, "clientId"),
    siteId: readOptionalField(formData, "siteId"),
    assetId: readOptionalField(formData, "assetId"),
    contractId: readOptionalField(formData, "contractId"),
    assignedTo: readOptionalField(formData, "assignedTo"),
    title: readField(formData, "title"),
    description: readField(formData, "description"),
    notes: readField(formData, "notes"),
    // Optional — the `derive_work_order_organization_id` DB trigger fills in
    // the organization's default `work_order_status` item ("New") when
    // omitted, same UX as `assets.statusId`.
    statusId: readOptionalField(formData, "statusId"),
    priorityId: readOptionalField(formData, "priorityId"),
    // Converted client-side (in `work-order-form.tsx`) from the visible
    // `datetime-local` input's local value into a real ISO 8601 datetime via
    // a hidden field of the same name — see that component for why.
    scheduledAt: readOptionalField(formData, "scheduledAt"),
  };
}

/** `useActionState` action for the "create work order" page. */
export async function createWorkOrderFormAction(
  _prevState: WorkOrderFormState,
  formData: FormData,
): Promise<WorkOrderFormState> {
  const result = await createWorkOrder(formDataToWorkOrderInput(formData));
  if (!result.data) {
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }
  return { ok: true, workOrder: result.data.workOrder };
}

/**
 * `useActionState` action for the "edit work order" page. Bind the work
 * order id first (`updateWorkOrderFormAction.bind(null, workOrder.id)`)
 * before passing it to `useActionState`, same idiom as
 * `updateAssetFormAction`.
 *
 * Note: per `./actions.ts`'s module comment, an engineer editing their own
 * assigned work order who tries to reassign it away from themselves gets a
 * clean `mapDbError` `42501` message back here (`state.error`) rather than a
 * silent no-op — don't swallow it.
 */
export async function updateWorkOrderFormAction(
  id: string,
  _prevState: WorkOrderFormState,
  formData: FormData,
): Promise<WorkOrderFormState> {
  const result = await updateWorkOrder(id, formDataToWorkOrderInput(formData));
  if (!result.data) {
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }
  return { ok: true, workOrder: result.data.workOrder };
}
