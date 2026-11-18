import type { DirtyField, EditSchema, SaveResult } from "@yourorg/ui/web-client";
import { createActivity, updateActivity } from "../actions";
import { draftToInput, type ActivityDraft } from "./activity-draft";

/**
 * Edit-mode schema of the Activity page (design system, issue #222): label,
 * required marker and validation per field. Mirrors `../schema.ts`
 * (`activityCreateSchema`) and the type-dependent rules `createActivity` /
 * `validate_activity_relations` enforce — the server stays the authority —
 * with messages that say what is wrong and how to fix it.
 */

function tooLong(label: string, value: string, max: number) {
  const length = value.trim().length;
  return length > max ? `${label} is ${length} characters, the maximum is ${max}. Remove ${length - max}` : null;
}

type LabelKey =
  | "clientId"
  | "assetId"
  | "typeId"
  | "statusId"
  | "contactPersonId"
  | "actionHolderId"
  | "activitySubtypeId"
  | "solutionSubtypeId";

/** Types whose reference-list `value` demands an asset / a contact. */
export const ASSET_REQUIRED_TYPE_VALUES = ["storing", "onderhoud"];
export const CONTACT_REQUIRED_TYPE_VALUE = "bel_activiteit";

export function buildActivitySchema(options: {
  labelFor: (key: LabelKey, id: string) => string;
  /** The stable `value` slug of an activity type id (`""` when unknown). */
  typeValueFor: (typeId: string) => string;
}): EditSchema<ActivityDraft> {
  const { labelFor, typeValueFor } = options;
  const format = (key: LabelKey) => (value: string) => (value ? labelFor(key, value) : "");

  const contactMissing = (draft: ActivityDraft) =>
    typeValueFor(draft.typeId) === CONTACT_REQUIRED_TYPE_VALUE &&
    !draft.contactPersonId &&
    !(draft.contactName.trim() && draft.contactPhone.trim());
  const contactMessage = "A contact person, or both a name and phone number, is required for a call. Choose a contact person or fill in both";

  return {
    clientId: {
      label: "Client",
      required: true,
      format: format("clientId"),
      validate: (value) => (value ? null : "Choose a client"),
    },
    assetId: {
      label: "Asset",
      format: format("assetId"),
      validate: (value, draft) =>
        !value && ASSET_REQUIRED_TYPE_VALUES.includes(typeValueFor(draft.typeId))
          ? "An asset is required for Breakdown or Maintenance. Choose an asset"
          : null,
    },
    typeId: {
      label: "Type",
      required: true,
      format: format("typeId"),
      validate: (value) => (value ? null : "Choose a type"),
    },
    statusId: { label: "Status", format: format("statusId") },
    contactPersonId: { label: "Contact person", format: format("contactPersonId") },
    contactName: {
      label: "Contact name",
      validate: (value, draft) => tooLong("Contact name", value, 200) ?? (contactMissing(draft) ? contactMessage : null),
    },
    contactPhone: {
      label: "Contact phone",
      validate: (value, draft) => tooLong("Contact phone", value, 50) ?? (contactMissing(draft) ? contactMessage : null),
    },
    contactEmail: {
      label: "Contact email",
      validate: (value) => {
        const email = value.trim();
        if (!email) return null;
        if (email.length > 320) return tooLong("Contact email", value, 320);
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : "Enter a valid email address, for example name@company.com";
      },
    },
    description: {
      label: "Description",
      required: true,
      validate: (value) => (value.trim() ? tooLong("Description", value, 5000) : "Enter a description"),
    },
    solution: { label: "Solution", validate: (value) => tooLong("Solution", value, 5000) },
    actionHolderId: { label: "Action holder", format: format("actionHolderId") },
    activitySubtypeId: { label: "Activity subtype", format: format("activitySubtypeId") },
    solutionSubtypeId: { label: "Solution subtype", format: format("solutionSubtypeId") },
  };
}

type DraftKey = keyof ActivityDraft & string;

function firstFieldErrors(fieldErrors: Record<string, string[] | undefined> | undefined) {
  const mapped: Partial<Record<DraftKey, string>> = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    if (messages?.[0]) mapped[key as DraftKey] = messages[0];
  }
  return mapped;
}

/** Persists an edited activity through the existing `updateActivity` action
 * (RBAC, zod validation, DB triggers and RLS unchanged) — only the changed
 * fields are sent. */
export async function saveActivityEdits(
  activityId: string,
  draft: ActivityDraft,
  dirty: DirtyField<ActivityDraft>[],
): Promise<SaveResult<ActivityDraft>> {
  const patch: Partial<ActivityDraft> = {};
  for (const entry of dirty) (patch as Record<string, unknown>)[entry.key] = draft[entry.key];
  const input = draftToInput(patch);
  if (Object.keys(input).length === 0) return { ok: true };
  const result = await updateActivity(activityId, input);
  if (!result.data) return { ok: false, error: result.error, fieldErrors: firstFieldErrors(result.fieldErrors) };
  return { ok: true };
}

/** Creates an activity (new mode) through `createActivity`; resolves with the
 * new id so the page can open its read page. */
export async function createActivityFromDraft(
  draft: ActivityDraft,
): Promise<{ result: SaveResult<ActivityDraft>; activityId?: string }> {
  const created = await createActivity(draftToInput(draft));
  if (!created.data) {
    return { result: { ok: false, error: created.error, fieldErrors: firstFieldErrors(created.fieldErrors) } };
  }
  return { result: { ok: true }, activityId: created.data.activity.id };
}
