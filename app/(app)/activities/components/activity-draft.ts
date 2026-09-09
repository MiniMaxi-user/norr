import type { ActivityRecord } from "../actions";

/**
 * An activity's own editable fields, as one flat draft object — same
 * single-source-of-truth shape `WorkOrderDraft` (`app/(app)/work-orders/components/work-order-draft.ts`)
 * established for the "one screen, inline-editable, no separate edit route"
 * pattern (issue #89, applied to Activities by issue #118). `ActivityScreen`
 * owns this; `ActivityHero`/`ActivityRelationsDialog`/`ActivityStatusDialog`/
 * `ActivityAssignmentSection` all read from it and write back through
 * `ActivityScreen`'s own `commitPatch`.
 */
export interface ActivityDraft {
  clientId: string;
  assetId: string;
  typeId: string;
  statusId: string;
  contactPersonId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  description: string;
  /** How this melding was resolved (issue #121) — `mode: "edit"` only, see
   * `ActivityAssignmentSection`'s own doc comment. Always `""` (never
   * populated) in `mode: "create"`, mirroring every other field with no
   * create-time entry point. */
  solution: string;
  /** `""` means "unassigned" — same optional-uuid convention every other
   * optional-uuid draft field here already uses (`contactPersonId`, etc.).
   * Owner/planner may leave this unset (issue #133 — Action holder is no
   * longer required); an engineer's own create/update always pins it
   * server-side regardless of what's sent (`createActivity`/`updateActivity`
   * in `../actions.ts`). */
  actionHolderId: string;
}

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
  };
}

export function emptyDraft(options: {
  /** Pre-scopes (and hides the picker for) a single client — mirrors
   * `WorkOrderDraft`'s `emptyDraft`'s `lockedClientId`. When `lockedAssetId`
   * is also set, `new/page.tsx` has already resolved this to that asset's own
   * `client_id` (an asset's own client is always the source of truth — see
   * that page's own doc comment) before it ever reaches here, so it's used
   * as-is either way — the Client relation card would otherwise render empty
   * even though the client is already known and locked. */
  lockedClientId?: string;
  lockedAssetId?: string;
  /** Pins "Action holder" for a caller who can't assign others (mirrors the
   * old panel's `canAssignOthers` pinning) — never combined with a real
   * pre-fill from another record, since Activities (unlike Work Orders) are
   * never themselves created "from" another entity. */
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
  };
}

/** Converts a draft (or a partial patch of one) into the shape
 * `createActivity`/`updateActivity` (`../actions.ts`) expect — empty-string
 * "unset" values become `undefined` (not sent) rather than an empty string
 * that would fail the schema's `uuid()` shape check. `description` is the one
 * exception (always sent as-is, even `""`, since it's a plain required string
 * field, not an optional uuid).
 *
 * `actionHolderId` is a SECOND exception (issue #133 bugfix): `""` there
 * means the caller explicitly picked the Action holder `<Select>`'s
 * "Unassigned" option, not merely "this field wasn't touched" — collapsing
 * it to `undefined` like every other optional-uuid field made a real
 * unassign silently no-op, since `undefined` is exactly what a field being
 * absent from a partial patch already looks like. Converts to `null` instead,
 * which `activityBaseSchema`'s own `actionHolderId` schema now accepts as a
 * distinct value ("clear it") from `undefined` ("don't touch it") — see that
 * field's own doc comment in `../schema.ts`. */
export function draftToInput(patch: Partial<ActivityDraft>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (patch.clientId !== undefined) input.clientId = patch.clientId || undefined;
  if (patch.assetId !== undefined) input.assetId = patch.assetId || undefined;
  if (patch.typeId !== undefined) input.typeId = patch.typeId || undefined;
  if (patch.statusId !== undefined) input.statusId = patch.statusId || undefined;
  if (patch.contactPersonId !== undefined) input.contactPersonId = patch.contactPersonId || undefined;
  if (patch.contactName !== undefined) input.contactName = patch.contactName || undefined;
  if (patch.contactPhone !== undefined) input.contactPhone = patch.contactPhone || undefined;
  if (patch.contactEmail !== undefined) input.contactEmail = patch.contactEmail || undefined;
  if (patch.description !== undefined) input.description = patch.description;
  if (patch.solution !== undefined) input.solution = patch.solution;
  if (patch.actionHolderId !== undefined) input.actionHolderId = patch.actionHolderId === "" ? null : patch.actionHolderId;
  return input;
}
