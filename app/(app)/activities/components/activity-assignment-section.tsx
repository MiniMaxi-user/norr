"use client";

import { Avatar, Inline, KeyValueList, type KeyValueListItem, Label, SectionHeader, Select, Stack, Text, Textarea } from "@yourorg/ui";
import { FileText } from "@yourorg/ui/icons";
import type { ActivityRecord } from "../actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { formatDateTime } from "@/lib/format/date";
import type { ActivityDraft } from "./activity-draft";

export interface ActivityAssignmentSectionProps {
  mode: "create" | "edit";
  draft: Pick<ActivityDraft, "description" | "solution" | "actionHolderId">;
  activity?: ActivityRecord;
  members: OrgMemberRecord[];
  /** Locks the Action holder select to the caller's own id — mirrors the old
   * panel's identically-named prop (owner/planner may assign any member,
   * an engineer only ever acts as themselves). */
  canAssignOthers: boolean;
  /** Gates Description/Solution between a plain read `Text` and an editable
   * `Textarea` — `mode: "create"`'s own screen always passes `true`;
   * `mode: "edit"` passes the page's single `pageEditing` boolean
   * (`activity-screen.tsx`). Action holder below is NOT gated by this at
   * all — see this component's own doc comment. */
  editing: boolean;
  /** A caller with no update permission at all (`readOnly` on the whole
   * screen) — the one thing `editing` doesn't already cover, since Action
   * holder stays a live control regardless of `editing`. */
  readOnly?: boolean;
  /** Writes straight into the shared `draft` (`activity-screen.tsx`'s
   * `updateDraft`) on every change — no network call from here anymore,
   * persistence is deferred to the page's own Save/"Create activity". */
  onFieldChange: (patch: Partial<Pick<ActivityDraft, "description" | "solution" | "actionHolderId">>) => void;
}

/**
 * "Assignment" section (`.design-handoff/melding_detail/README.md`).
 *
 * Issue #133 ("Aanpassing Activity") rebuilt this section around three
 * changes: Action holder is no longer a required field (schema/actions
 * layer), so its old small edit-pencil + `ActivityActionHolderDialog` popup
 * (hiding the ONE required field on a brand-new record behind a dialog was
 * already the wrong weight — see this file's own history) is gone entirely.
 * Action holder is now a plain, ALWAYS-live inline `<Select>` — no pencil, no
 * dialog, no `editing`/`pageEditing` gate at all, in EITHER mode: it can be
 * (re)assigned directly on the screen without ever clicking the page's own
 * Edit pencil first (issue #133, point 6), and doing so surfaces the page's
 * one Save button on its own (`onFieldChange` flows through
 * `activity-screen.tsx`'s `updateDraft`, which sets `isDirty`). An engineer
 * (`!canAssignOthers`) still sees the same pinned-to-self read-out, no
 * select needed since there's nothing for them to choose; a `readOnly`
 * viewer (no update permission at all) sees the same read-out regardless of
 * `canAssignOthers`, for the same reason no other edit affordance renders for
 * them anywhere on this screen.
 *
 * Description/Solution are the two fields still gated by `editing`: a plain
 * read `Text` when not editing, an editable `Textarea` bound straight to the
 * shared `draft` via `onFieldChange` when editing — no more local echo state
 * or blur-commit dance (that machinery only existed to dodge a stale-draft-
 * at-submit-time bug back when every keystroke saved immediately; a
 * controlled input bound directly to `draft` is never stale). Solution stays
 * `mode: "edit"` only (issue #121) — a solution is written up once the
 * melding has been worked, never at the moment it's first reported.
 */
export function ActivityAssignmentSection({
  mode,
  draft,
  activity,
  members,
  canAssignOthers,
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

      {items.length > 0 && <KeyValueList items={items} />}
    </Stack>
  );
}
