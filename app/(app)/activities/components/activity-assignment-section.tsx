"use client";

import { Avatar, Badge, Inline, KeyValueList, type KeyValueListItem, Label, SectionHeader, Select, Stack, Text, Textarea } from "@yourorg/ui";
import { FileText } from "@yourorg/ui/icons";
import type { ActivityRecord } from "../actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { memberDisplayName } from "@/lib/members/format";
import { formatDateTime } from "@/lib/format/date";
import type { ActivityDraft } from "./activity-draft";

export interface ActivityAssignmentSectionProps {
  mode: "create" | "edit";
  draft: Pick<ActivityDraft, "description" | "solution" | "actionHolderId" | "statusId">;
  activity?: ActivityRecord;
  members: OrgMemberRecord[];
  /** Locks the Action holder select to the caller's own id — mirrors the old
   * panel's identically-named prop (owner/planner may assign any member,
   * an engineer only ever acts as themselves). */
  canAssignOthers: boolean;
  activityStatuses: ReferenceListItemRecord[];
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
  onFieldChange: (patch: Partial<Pick<ActivityDraft, "description" | "solution" | "actionHolderId" | "statusId">>) => void;
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
 * Description/Solution are the two fields still gated by `editing` — a plain
 * read `Text` when not editing (a genuinely `readOnly` viewer only, per
 * `activity-screen.tsx`'s own `sectionEditing = !readOnly`: there is no
 * separate edit-mode toggle for a caller who CAN write, per the product
 * owner's "standaard openen als Edit, read-only scherm is niet meer nodig"),
 * an editable `Textarea` bound straight to the shared `draft` via
 * `onFieldChange` otherwise — no local echo state or blur-commit dance (that
 * machinery only existed to dodge a stale-draft-at-submit-time bug back when
 * every keystroke saved immediately; a controlled input bound directly to
 * `draft` is never stale). Solution stays `mode: "edit"` only (issue #121) —
 * a solution is written up once the melding has been worked, never at the
 * moment it's first reported.
 */
export function ActivityAssignmentSection({
  mode,
  draft,
  activity,
  members,
  canAssignOthers,
  activityStatuses,
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

      {/* Solution (issue #121) — `mode: "edit"` only, same "nothing to show
          before the record exists" gating `ActivityScreen`'s Notes/Linked
          work orders/Historie sections already use: a solution is written up
          once the melding has been worked, never at the moment it's first
          reported. */}
      {mode === "edit" && (
        <Stack gap="xs">
          <Label htmlFor="activity-solution">Solution</Label>
          {editing ? (
            <Textarea
              id="activity-solution"
              aria-label="Solution"
              rows={2}
              value={draft.solution}
              onChange={(event) => onFieldChange({ solution: event.target.value })}
            />
          ) : draft.solution ? (
            <Text>{draft.solution}</Text>
          ) : (
            <Text tone="muted">No solution yet.</Text>
          )}
        </Stack>
      )}

      {/* Action holder — always a live control, independent of `editing`
          (see this component's own doc comment). */}
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

      {/* Status — `mode: "edit"` only (a brand-new activity has no status
          to edit yet; the DB fills in the org's default on insert, same
          "nothing to show before the record exists" gating Solution above
          uses). Always a live control, independent of `editing`, same
          treatment as Action holder just above (see this component's own
          doc comment) — moved here from the hero's own status-badge pencil
          (now deleted). */}
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

      {items.length > 0 && <KeyValueList items={items} />}
    </Stack>
  );
}
