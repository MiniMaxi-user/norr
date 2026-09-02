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
  onSave: (patch: Pick<ActivityDraft, "description" | "actionHolderId">) => Promise<{ ok: boolean; error?: string }>;
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

  useEffect(() => {
    setDescription(draft.description);
  }, [draft.description]);

  const memberById = new Map(members.map((member) => [member.id, member]));
  const actionHolder = draft.actionHolderId ? memberById.get(draft.actionHolderId) : undefined;
  const actionHolderName = actionHolder
    ? memberDisplayName(actionHolder)
    : activity
      ? memberDisplayName(activity.action_holder)
      : "—";

  async function handleDescriptionBlur() {
    if (readOnly || description === draft.description) return;
    setDescriptionError(null);
    const result = await onSave({ description, actionHolderId: draft.actionHolderId });
    if (!result.ok) {
      setDescription(draft.description);
      setDescriptionError(result.error ?? "Could not save the description.");
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
          !readOnly && (
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
            onChange={(event) => setDescription(event.target.value)}
            onBlur={handleDescriptionBlur}
          />
        </Stack>
      )}

      <KeyValueList items={items} />

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
    const result = await onSave({ description: draft.description, actionHolderId });
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
