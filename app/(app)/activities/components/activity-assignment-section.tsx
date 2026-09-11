"use client";

import { Avatar, Badge, Card, FormGrid, Inline, KeyValueList, type KeyValueListItem, Label, SectionHeader, Select, Stack, Text, Textarea } from "@yourorg/ui";
import { FileText } from "@yourorg/ui/icons";
import type { ActivityRecord } from "../actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { ActivitySubtypeRecord } from "../subtypes-actions";
import { memberDisplayName } from "@/lib/members/format";
import { formatDateTime } from "@/lib/format/date";
import type { ActivityDraft } from "./activity-draft";
import { SubtypeCascadePicker } from "./subtype-cascade-picker";

type AssignmentDraft = Pick<
  ActivityDraft,
  "description" | "actionHolderId" | "statusId" | "activitySubtypeId"
>;

export interface ActivityAssignmentSectionProps {
  mode: "create" | "edit";
  draft: AssignmentDraft;
  activity?: ActivityRecord;
  members: OrgMemberRecord[];
  /** Locks the Action holder select to the caller's own id — mirrors the old
   * panel's identically-named prop (owner/planner may assign any member,
   * an engineer only ever acts as themselves). */
  canAssignOthers: boolean;
  activityStatuses: ReferenceListItemRecord[];
  /** The org's whole flat Activity Subtype tree (issues #134/#138) — fed
   * straight into `SubtypeCascadePicker`, `rootFilter`-scoped to `typeId`
   * below. */
  activitySubtypes: ActivitySubtypeRecord[];
  /** The activity's currently-selected Activity Type (`draft.typeId`, picked
   * in the separate `ActivityTypeSection` above this one) — the Activity
   * subtype cascade's own level-1 options are restricted to roots whose
   * `type_id` matches this. */
  typeId: string;
  /** Gates Description/Solution between a plain read `Text` and an editable
   * `Textarea`. Action holder and Status below are NOT gated by this at
   * all — see this component's own doc comment. */
  editing: boolean;
  /** A caller with no update permission at all (`readOnly` on the whole
   * screen) — the one thing `editing` doesn't already cover, since Action
   * holder/Status stay live controls regardless of `editing`. */
  readOnly?: boolean;
  /** Writes straight into the shared `draft` (`activity-screen.tsx`'s
   * `updateDraft`) on every change — no network call from here anymore,
   * persistence is deferred to the page's own Save/"Create activity". */
  onFieldChange: (patch: Partial<AssignmentDraft>) => void;
}

/**
 * "Assignment" section (`.design-handoff/melding_detail/README.md`).
 *
 * Issue #133 ("Aanpassing Activity") rebuilt this section, in two passes:
 *
 * 1. Action holder is no longer a required field (schema/actions layer), so
 *    its old small edit-pencil + `ActivityActionHolderDialog` popup (hiding
 *    the ONE required field on a brand-new record behind a dialog was
 *    already the wrong weight — see this file's own history) is gone
 *    entirely. Action holder is a plain, ALWAYS-live inline `<Select>` — no
 *    pencil, no dialog, no `editing` gate at all: it can be (re)assigned
 *    directly on the screen, and doing so surfaces the page's one Save
 *    button on its own (`onFieldChange` flows through `activity-screen.tsx`'s
 *    `updateDraft`, which sets `isDirty`).
 * 2. A same-day follow-up moved Status here too, right under Action holder —
 *    it used to be a hero badge with its own edit-pencil opening
 *    `ActivityStatusDialog` (now deleted); the product owner wants no
 *    separate edit-mode toggle anywhere on this screen at all, so Status
 *    is now just another plain field, same "ALWAYS-live inline `<Select>`,
 *    no `editing` gate" treatment Action holder already has (writing into
 *    `draft.statusId` via the same `onFieldChange`). The hero still shows
 *    the status as a read-only badge for at-a-glance context (same role the
 *    Type badge already has) — this section is where it's actually edited.
 *
 * Both Action holder and Status: an engineer (`!canAssignOthers`) still sees
 * the pinned-to-self read-out for Action holder (nothing for them to
 * choose); a `readOnly` viewer (no update permission at all) sees a plain
 * read-out for both, for the same reason no edit affordance renders for them
 * anywhere on this screen.
 *
 * Description is gated by `editing` — a plain read `Text` when not editing (a
 * genuinely `readOnly` viewer only, per `activity-screen.tsx`'s own
 * `sectionEditing = !readOnly`: there is no separate edit-mode toggle for a
 * caller who CAN write, per the product owner's "standaard openen als Edit,
 * read-only scherm is niet meer nodig"), an editable `Textarea` bound
 * straight to the shared `draft` via `onFieldChange` otherwise — no local
 * echo state or blur-commit dance (that machinery only existed to dodge a
 * stale-draft-at-submit-time bug back when every keystroke saved immediately;
 * a controlled input bound directly to `draft` is never stale).
 *
 * Issue #152's follow-up laid Activity subtype and Description side by side
 * in a `FormGrid` (label above each field, same as before, just no longer
 * stacked as two full-width rows) and moved Solution + Solution subtype out
 * into their own sibling section — see `activity-solution-section.tsx` — so
 * the "what happened" half (Type/Assignment) and the "how it was resolved"
 * half read as two visually distinct groups instead of one long list.
 *
 * A second issue #152 follow-up wrapped every field below the header in a
 * plain `Card` (the header itself stays OUTSIDE it, same "`SectionHeader`,
 * then a `Card` beneath it" shape `EditableSection`/`ContractNotesSection`
 * already use elsewhere) and paired Action holder with Status in their own
 * `FormGrid` row, so the two live-select fields read as one group instead of
 * two stacked full-width rows.
 */
export function ActivityAssignmentSection({
  mode,
  draft,
  activity,
  members,
  canAssignOthers,
  activityStatuses,
  activitySubtypes,
  typeId,
  editing,
  readOnly,
  onFieldChange,
}: ActivityAssignmentSectionProps) {
  const memberById = new Map(members.map((member) => [member.id, member]));
  const actionHolder = draft.actionHolderId ? memberById.get(draft.actionHolderId) : undefined;
  const actionHolderName = actionHolder
    ? memberDisplayName(actionHolder)
    : activity?.action_holder
      ? memberDisplayName(activity.action_holder)
      : "Unassigned";

  const items: KeyValueListItem[] = [];
  if (mode === "edit" && activity) {
    items.push(
      { key: "reported-at", label: "Reported at", value: <Text>{formatDateTime(activity.reported_at)}</Text> },
      { key: "reported-by", label: "Reported by", value: <Text>{memberDisplayName(activity.reporter)}</Text> },
    );
  }

  return (
    <Stack gap="md">
      <SectionHeader icon={FileText} title="Assignment" />

      <Card>
        <Stack gap="md">
          {/* Activity subtype + Description side by side (issue #152 —
              "activity subtypen: links van invulveld"; previously stacked one
              above the other). Same `editing` gate on both: a genuinely
              `readOnly` viewer sees the resolved leaf's plain `name` (the
              shallow embed already on `ActivityRecord`, same "no stored
              breadcrumb path" shape every other resolved-reference read view
              here uses), not the interactive cascade. `rootFilter` restricts
              level 1 to roots whose `type_id` matches the currently-selected
              Activity Type — see `activity-screen.tsx`'s own
              Type-changed-clears-subtype effect for what keeps this in sync
              when `typeId` itself changes. */}
          <FormGrid columns={2}>
            <Stack gap="xs">
              <Label htmlFor="activity-subtype-level-1">Activity subtype</Label>
              {editing ? (
                <SubtypeCascadePicker
                  idBase="activity-subtype"
                  ariaLabel="Activity subtype"
                  nodes={activitySubtypes}
                  value={draft.activitySubtypeId}
                  onChange={(nextValue) => onFieldChange({ activitySubtypeId: nextValue })}
                  rootFilter={(node) => node.type_id === typeId}
                />
              ) : (
                <Text>{activity?.activity_subtype?.name ?? "No activity subtype selected."}</Text>
              )}
            </Stack>

            <Stack gap="xs">
              <Label htmlFor="activity-description">Description</Label>
              {editing ? (
                <Textarea
                  id="activity-description"
                  aria-label="Description"
                  rows={2}
                  value={draft.description}
                  onChange={(event) => onFieldChange({ description: event.target.value })}
                />
              ) : draft.description ? (
                <Text>{draft.description}</Text>
              ) : (
                <Text tone="muted">No description yet.</Text>
              )}
            </Stack>
          </FormGrid>

          {/* Action holder + Status side by side (issue #152's follow-up) —
              both always live controls, independent of `editing` (see this
              component's own doc comment). Status is `mode: "edit"` only (a
              brand-new activity has no status to edit yet; the DB fills in
              the org's default on insert), so `FormGrid` gets a single child
              in `mode: "create"` — Action holder simply sits in the first
              column with nothing beside it. */}
          <FormGrid columns={2}>
            <Stack gap="xs">
              <Label htmlFor="activity-action-holder">Action holder</Label>
              {canAssignOthers && !readOnly ? (
                <Select
                  id="activity-action-holder"
                  value={draft.actionHolderId}
                  onChange={(event) => onFieldChange({ actionHolderId: event.target.value })}
                >
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {memberDisplayName(member)}
                    </option>
                  ))}
                </Select>
              ) : (
                <Inline gap="sm" align="center">
                  <Avatar name={actionHolderName} size="sm" />
                  <Text className="ui-row-title">{actionHolderName}</Text>
                  {!canAssignOthers && !readOnly && <Text tone="muted">(Always assigned to you)</Text>}
                </Inline>
              )}
            </Stack>

            {mode === "edit" && (
              <Stack gap="xs">
                <Label htmlFor="activity-status">Status</Label>
                {!readOnly ? (
                  <Select
                    id="activity-status"
                    value={draft.statusId}
                    onChange={(event) => onFieldChange({ statusId: event.target.value })}
                  >
                    {activityStatuses.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge color={activityStatuses.find((item) => item.id === draft.statusId)?.color} variant="muted">
                    {activityStatuses.find((item) => item.id === draft.statusId)?.label ?? "—"}
                  </Badge>
                )}
              </Stack>
            )}
          </FormGrid>

          {items.length > 0 && <KeyValueList items={items} />}
        </Stack>
      </Card>
    </Stack>
  );
}
