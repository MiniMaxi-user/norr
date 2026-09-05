"use client";

import { useEffect, useState } from "react";
import {
  Avatar,
  Button,
  Dialog,
  IconButton,
  Inline,
  KeyValueList,
  type KeyValueListItem,
  Label,
  SectionHeader,
  Select,
  Stack,
  Text,
  Textarea,
} from "@yourorg/ui";
import { FileText, Pencil } from "@yourorg/ui/icons";
import type { ActivityRecord } from "../actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { formatDateTime } from "@/lib/format/date";
import type { ActivityDraft } from "./activity-draft";

export interface ActivityAssignmentSectionProps {
  mode: "create" | "edit";
  draft: ActivityDraft;
  activity?: ActivityRecord;
  members: OrgMemberRecord[];
  /** Locks the Action holder select to the caller's own id — mirrors the old
   * panel's identically-named prop (owner/planner may assign any member,
   * an engineer only ever acts as themselves). */
  canAssignOthers: boolean;
  readOnly?: boolean;
  onSave: (
    patch: Pick<ActivityDraft, "description" | "actionHolderId" | "solution">,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Assignment" section (`.design-handoff/melding_detail/README.md`) —
 * description is now a directly inline-editable `Textarea` (saves `onBlur`,
 * no dialog), replacing the pre-#118 version's combined description+action-
 * holder popup. The mockup's own static markup shows NO header action at all
 * — but "reassign the action holder" was working functionality worth
 * preserving (same reasoning `ActivityHero`'s kept status-badge pencil
 * documents for its own deliberate deviation, both explicitly approved): a
 * small edit-pencil stays, now scoped to ONLY "Action holder" via
 * `ActivityActionHolderDialog` below (renamed from the old combined
 * `ActivityAssignmentDialog` now that description edits inline instead).
 *
 * `mode: "create"` does NOT use that dialog for Action holder, even though
 * it's a required field there (`schema.ts`'s `actionHolderId`,
 * `ActivityScreen.handleCreate`'s own check) — a required field on a brand
 * new record has no "already-set value" to occasionally reassign, so hiding
 * its only input behind a small popup is exactly the wrong weight
 * (`docs/ARCHITECTURE.md`'s "Popup vs. full page": a `Dialog` is for a small,
 * secondary edit, not the primary record's own required data). Users were
 * hitting "Create activity" → "Select an action holder." with no visible way
 * to fix it short of noticing the header's edit-pencil. `mode: "create"` with
 * `canAssignOthers` now renders the `<Select>` directly inline instead; an
 * engineer (`!canAssignOthers`) still sees the same pinned-to-self read-out,
 * no dialog needed since there's nothing for them to choose.
 */
export function ActivityAssignmentSection({
  mode,
  draft,
  activity,
  members,
  canAssignOthers,
  readOnly,
  onSave,
}: ActivityAssignmentSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [description, setDescription] = useState(draft.description);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [solution, setSolution] = useState(draft.solution);
  const [solutionError, setSolutionError] = useState<string | null>(null);
  const [actionHolderError, setActionHolderError] = useState<string | null>(null);

  useEffect(() => {
    setDescription(draft.description);
  }, [draft.description]);

  useEffect(() => {
    setSolution(draft.solution);
  }, [draft.solution]);

  const memberById = new Map(members.map((member) => [member.id, member]));
  const actionHolder = draft.actionHolderId ? memberById.get(draft.actionHolderId) : undefined;
  const actionHolderName = actionHolder
    ? memberDisplayName(actionHolder)
    : activity
      ? memberDisplayName(activity.action_holder)
      : "—";

  async function commitDescription(next: string) {
    setDescriptionError(null);
    const result = await onSave({ description: next, solution: draft.solution, actionHolderId: draft.actionHolderId });
    if (!result.ok) {
      setDescription(draft.description);
      setDescriptionError(result.error ?? "Could not save the description.");
    }
  }

  /** `mode: "edit"` only — the Solution field has no create-time entry point
   * (see `ActivityDraft.solution`'s own doc comment), so unlike
   * `commitDescription` this never needs a `mode: "create"` immediate-commit
   * path. */
  async function commitSolution(next: string) {
    setSolutionError(null);
    const result = await onSave({ description: draft.description, solution: next, actionHolderId: draft.actionHolderId });
    if (!result.ok) {
      setSolution(draft.solution);
      setSolutionError(result.error ?? "Could not save the solution.");
    }
  }

  function handleSolutionChange(next: string) {
    setSolution(next);
  }

  async function handleSolutionBlur() {
    if (readOnly || solution === draft.solution) return;
    await commitSolution(solution);
  }

  /** `mode: "create"` has no server round trip to defer to blur — `onSave`
   * only ever merges into the local draft (see `ActivityScreen.commitPatch`)
   * — so every keystroke commits immediately, the same "no separate Save
   * button" pattern `ActivityTypeSection`/the relation dialogs already use
   * for every other create-time field. Without this, a description typed and
   * then "Create activity" clicked without first blurring the textarea could
   * read the pre-edit (empty) draft and reject with "Description is
   * required." even though the field visibly has text in it. */
  function handleDescriptionChange(next: string) {
    setDescription(next);
    if (mode === "create") void commitDescription(next);
  }

  /** `mode: "edit"` only — `onSave` is a real `updateActivity` network call
   * there, so it stays deferred to blur (one write per edit, not one per
   * keystroke); `mode: "create"` already committed via `handleDescriptionChange`
   * above. */
  async function handleDescriptionBlur() {
    if (readOnly || mode === "create" || description === draft.description) return;
    await commitDescription(description);
  }

  /** `mode: "create"` only — the inline `<Select>` below commits on every
   * change, same immediate-commit reasoning as `handleDescriptionChange`
   * above (a local-only draft merge, no network round trip yet). */
  async function handleActionHolderChange(nextActionHolderId: string) {
    setActionHolderError(null);
    const result = await onSave({
      description: draft.description,
      solution: draft.solution,
      actionHolderId: nextActionHolderId,
    });
    if (!result.ok) {
      setActionHolderError(result.error ?? "Could not set the action holder.");
    }
  }

  const items: KeyValueListItem[] = [
    {
      key: "action-holder",
      label: "Action holder",
      value: (
        <Inline gap="sm" align="center">
          <Avatar name={actionHolderName} size="sm" />
          <Text className="ui-row-title">{actionHolderName}</Text>
        </Inline>
      ),
    },
  ];
  if (mode === "edit" && activity) {
    items.push(
      { key: "reported-at", label: "Reported at", value: <Text>{formatDateTime(activity.reported_at)}</Text> },
      { key: "reported-by", label: "Reported by", value: <Text>{memberDisplayName(activity.reporter)}</Text> },
    );
  }

  return (
    <Stack gap="md">
      <SectionHeader
        icon={FileText}
        title="Assignment"
        actions={
          !readOnly &&
          mode === "edit" && (
            <IconButton variant="ghost" aria-label="Edit action holder" onClick={() => setDialogOpen(true)}>
              <Pencil />
            </IconButton>
          )
        }
      />

      {readOnly ? (
        draft.description ? (
          <Text>{draft.description}</Text>
        ) : (
          <Text tone="muted">No description yet.</Text>
        )
      ) : (
        <Stack gap="xs">
          {descriptionError && <Text tone="danger">{descriptionError}</Text>}
          <Textarea
            aria-label="Description"
            rows={2}
            value={description}
            onChange={(event) => handleDescriptionChange(event.target.value)}
            onBlur={handleDescriptionBlur}
          />
        </Stack>
      )}

      {/* Solution (issue #121) — `mode: "edit"` only, same "nothing to show
          before the record exists" gating `ActivityScreen`'s Notes/Linked
          work orders/Historie sections already use: a solution is written up
          once the melding has been worked, never at the moment it's first
          reported. */}
      {mode === "edit" && (
        <Stack gap="xs">
          <Label htmlFor="activity-solution">Solution</Label>
          {readOnly ? (
            draft.solution ? (
              <Text>{draft.solution}</Text>
            ) : (
              <Text tone="muted">No solution yet.</Text>
            )
          ) : (
            <>
              {solutionError && <Text tone="danger">{solutionError}</Text>}
              <Textarea
                id="activity-solution"
                aria-label="Solution"
                rows={2}
                value={solution}
                onChange={(event) => handleSolutionChange(event.target.value)}
                onBlur={handleSolutionBlur}
              />
            </>
          )}
        </Stack>
      )}

      {mode === "create" ? (
        <Stack gap="xs">
          <Label htmlFor="activity-action-holder-inline">Action holder</Label>
          {canAssignOthers ? (
            <>
              {actionHolderError && <Text tone="danger">{actionHolderError}</Text>}
              <Select
                id="activity-action-holder-inline"
                value={draft.actionHolderId}
                disabled={readOnly}
                onChange={(event) => void handleActionHolderChange(event.target.value)}
              >
                <option value="" disabled>
                  Select a member…
                </option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {memberDisplayName(member)}
                  </option>
                ))}
              </Select>
            </>
          ) : (
            <Inline gap="sm" align="center">
              <Avatar name={actionHolderName} size="sm" />
              <Text className="ui-row-title">{actionHolderName}</Text>
              <Text tone="muted">(Always assigned to you)</Text>
            </Inline>
          )}
        </Stack>
      ) : (
        <KeyValueList items={items} />
      )}

      {dialogOpen && (
        <ActivityActionHolderDialog
          open
          onOpenChange={setDialogOpen}
          draft={draft}
          members={members}
          canAssignOthers={canAssignOthers}
          onSave={onSave}
        />
      )}
    </Stack>
  );
}

/**
 * Small popup behind the Assignment section's own edit-pencil — "Action
 * holder" only (renamed from `ActivityAssignmentDialog`, which used to also
 * own Description before it became directly inline-editable above). Same
 * `canAssignOthers` locking behavior the pre-#118 combined dialog already
 * had.
 */
function ActivityActionHolderDialog({
  open,
  onOpenChange,
  draft,
  members,
  canAssignOthers,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ActivityDraft;
  members: OrgMemberRecord[];
  canAssignOthers: boolean;
  onSave: ActivityAssignmentSectionProps["onSave"];
}) {
  const [actionHolderId, setActionHolderId] = useState(draft.actionHolderId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!actionHolderId) {
      setError("Select an action holder.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await onSave({ description: draft.description, solution: draft.solution, actionHolderId });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>Edit action holder</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="sm">
            <Label htmlFor="activity-action-holder">Action holder</Label>
            <Select
              id="activity-action-holder"
              value={actionHolderId}
              onChange={(event) => setActionHolderId(event.target.value)}
              disabled={!canAssignOthers}
            >
              <option value="" disabled>
                Select a member…
              </option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberDisplayName(member)}
                </option>
              ))}
            </Select>
            {!canAssignOthers && <Text tone="muted">Always assigned to you.</Text>}
          </Stack>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
