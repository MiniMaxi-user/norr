"use server";

import { createContract, updateContract, type ContractRecord } from "./actions";

/**
 * Thin `useActionState`-shaped adapters over the real `createContract`/
 * `updateContract` Server Actions in `./actions.ts` (which take a parsed
 * object, not `FormData`) — same pattern as `app/(app)/work-orders/
 * work-order-form-actions.ts`/`app/(app)/assets/asset-form-actions.ts`. Kept
 * in this separate file for the same reason: `./actions.ts` is the
 * co-located backend half of issue #33 and out of this pass's scope to
 * modify.
 */
export interface ContractFormState {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  contract?: ContractRecord;
}

function readField(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

/** Same as `readField`, but an empty string (a placeholder option left
 * selected, e.g. "Use default (Maintenance)"/"No SLA tier"/"No billing
 * terms") is also treated as absent — needed for every optional field below
 * whose `<Select>` has a blank/placeholder state. */
function readOptionalField(formData: FormData, key: string): string | undefined {
  const value = readField(formData, key);
  return value && value.length > 0 ? value : undefined;
}

/** A `<Checkbox>` only appears in `FormData` at all when checked (value
 * `"on"`) — same normalization `contact-form-dialog.tsx` does for
 * `isPrimary`. */
function readCheckbox(formData: FormData, key: string): boolean {
  return formData.get(key) === "on";
}

function formDataToContractInput(formData: FormData) {
  return {
    clientId: readField(formData, "clientId"),
    name: readField(formData, "name"),
    // Optional — the `derive_contract_organization_id` DB trigger fills in
    // the organization's default `contract_type` item ("Maintenance") when
    // omitted, same UX as `work_orders.statusId`.
    typeId: readOptionalField(formData, "typeId"),
    slaTierId: readOptionalField(formData, "slaTierId"),
    billingTermsId: readOptionalField(formData, "billingTermsId"),
    startDate: readField(formData, "startDate"),
    endDate: readOptionalField(formData, "endDate"),
    autoRenew: readCheckbox(formData, "autoRenew"),
    value: readOptionalField(formData, "value"),
    notes: readField(formData, "notes"),
  };
}

/** `useActionState` action for the "create contract" page. */
export async function createContractFormAction(
  _prevState: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const result = await createContract(formDataToContractInput(formData));
  if (!result.data) {
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }
  return { ok: true, contract: result.data.contract };
}

/**
 * `useActionState` action for the "edit contract" page. Bind the contract id
 * first (`updateContractFormAction.bind(null, contract.id)`) before passing
 * it to `useActionState`, same idiom as `updateWorkOrderFormAction`.
 */
export async function updateContractFormAction(
  id: string,
  _prevState: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  const result = await updateContract(id, formDataToContractInput(formData));
  if (!result.data) {
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }
  return { ok: true, contract: result.data.contract };
}
