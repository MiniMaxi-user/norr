import type { ActivityRecord } from "../actions";

/**
 * An activity's editable fields as one flat draft of strings — the raw-input
 * shape `useEditMode` works with (design system, issue #222). `""` means
 * "unset" for every optional field. A `type` alias (not an interface) so it is
 * assignable to the edit-mode record.
 */
export type ActivityDraft = {
  clientId: string;
  assetId: string;
  typeId: string;
  statusId: string;
  contactPersonId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  description: string;
  /** How the activity was resolved — edit only (nothing to solve yet on a new one). */
  solution: string;
  /** `""` = unassigned. An engineer's own create/update is pinned server-side. */
  actionHolderId: string;
  /** The deepest `activity_subtypes` node picked (any level). */
  activitySubtypeId: string;
  /** The deepest `solution_subtypes` node picked (any level). */
  solutionSubtypeId: string;
};

export function draftFromActivity(activity: ActivityRecord): ActivityDraft {
  return {
    clientId: activity.client_id,
    assetId: activity.asset_id ?? "",
    typeId: activity.type_id,
    statusId: activity.status_id,
    contactPersonId: activity.contact_person_id ?? "",
    contactName: activity.contact_name ?? "",
    contactPhone: activity.contact_phone ?? "",
    contactEmail: activity.contact_email ?? "",
    description: activity.description,
    solution: activity.solution ?? "",
    actionHolderId: activity.action_holder_id ?? "",
    activitySubtypeId: activity.activity_subtype_id ?? "",
    solutionSubtypeId: activity.solution_subtype_id ?? "",
  };
}

export function emptyDraft(options: {
  /** Pre-scopes (and locks) the client — `?clientId=` / the asset's own client. */
  lockedClientId?: string;
  /** Pre-scopes (and locks) the asset — `?assetId=`. */
  lockedAssetId?: string;
  /** Pins "Action holder" for a caller who can't assign others (an engineer). */
  initialActionHolderId?: string;
}): ActivityDraft {
  return {
    clientId: options.lockedClientId ?? "",
    assetId: options.lockedAssetId ?? "",
    typeId: "",
    statusId: "",
    contactPersonId: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    description: "",
    solution: "",
    actionHolderId: options.initialActionHolderId ?? "",
    activitySubtypeId: "",
    solutionSubtypeId: "",
  };
}

/**
 * Converts a draft (or a partial patch of one) into the input
 * `createActivity`/`updateActivity` expect. Blank optional fields are sent as
 * `""`: the create schema drops them, the update schema turns them into
 * `null` (clear). The four nullable pickers (action holder, both subtypes)
 * send an explicit `null` for "cleared", never `undefined` ("don't touch").
 */
export function draftToInput(patch: Partial<ActivityDraft>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const copy = [
    "clientId",
    "assetId",
    "typeId",
    "statusId",
    "contactPersonId",
    "contactName",
    "contactPhone",
    "contactEmail",
    "description",
    "solution",
  ] as const;
  for (const key of copy) {
    if (patch[key] !== undefined) input[key] = patch[key];
  }
  if (patch.actionHolderId !== undefined) input.actionHolderId = patch.actionHolderId === "" ? null : patch.actionHolderId;
  if (patch.activitySubtypeId !== undefined) {
    input.activitySubtypeId = patch.activitySubtypeId === "" ? null : patch.activitySubtypeId;
  }
  if (patch.solutionSubtypeId !== undefined) {
    input.solutionSubtypeId = patch.solutionSubtypeId === "" ? null : patch.solutionSubtypeId;
  }
  return input;
}
