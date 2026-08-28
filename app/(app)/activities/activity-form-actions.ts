"use server";

import { createActivity, updateActivity, type ActivityRecord } from "./actions";

/**
 * Thin `useActionState`-shaped adapters over the real `createActivity`/
 * `updateActivity` Server Actions in `./actions.ts` (which take a parsed
 * object, not `FormData`) — same pattern as
 * `app/(app)/work-orders/work-order-form-actions.ts`. Kept in a separate
 * file for the same reason that one is: `./actions.ts` is the co-located
 * backend half of issue #59 and out of this pass's scope to modify.
 */
export interface ActivityFormState {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  activity?: ActivityRecord;
}

function readField(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

/** Same as `readField`, but an empty string (a placeholder option left
 * selected, or a hidden field left blank) is also treated as absent — needed
 * for every optional field below. */
function readOptionalField(formData: FormData, key: string): string | undefined {
  const value = readField(formData, key);
  return value && value.length > 0 ? value : undefined;
}

function formDataToActivityInput(formData: FormData) {
  return {
    clientId: readOptionalField(formData, "clientId"),
    assetId: readOptionalField(formData, "assetId"),
    typeId: readField(formData, "typeId"),
    // Optional — the `derive_activity_organization_id` DB trigger fills in
    // the organization's default `activity_status` item ("Open") when
    // omitted on create, same UX as `work_orders.statusId`.
    statusId: readOptionalField(formData, "statusId"),
    contactPersonId: readOptionalField(formData, "contactPersonId"),
    contactName: readOptionalField(formData, "contactName"),
    contactPhone: readOptionalField(formData, "contactPhone"),
    contactEmail: readOptionalField(formData, "contactEmail"),
    description: readField(formData, "description"),
    actionHolderId: readField(formData, "actionHolderId"),
  };
}

/** `useActionState` action for the "create activity" page. */
export async function createActivityFormAction(
  _prevState: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const result = await createActivity(formDataToActivityInput(formData));
  if (!result.data) {
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }
  return { ok: true, activity: result.data.activity };
}

/**
 * `useActionState` action for the "edit activity" page. Bind the activity id
 * first (`updateActivityFormAction.bind(null, activity.id)`) before passing
 * it to `useActionState`, same idiom as `updateWorkOrderFormAction`.
 *
 * Note: per `./actions.ts`'s module comment, an engineer editing their own
 * assigned activity who tries to reassign it away from themselves gets a
 * clean `mapDbError` `42501` message back here (`state.error`) rather than a
 * silent no-op — don't swallow it.
 */
export async function updateActivityFormAction(
  id: string,
  _prevState: ActivityFormState,
  formData: FormData,
): Promise<ActivityFormState> {
  const result = await updateActivity(id, formDataToActivityInput(formData));
  if (!result.data) {
    return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  }
  return { ok: true, activity: result.data.activity };
}
