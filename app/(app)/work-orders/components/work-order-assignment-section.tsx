"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Button,
  Callout,
  Dialog,
  IconButton,
  Input,
  KeyValueList,
  type KeyValueListItem,
  Label,
  SectionHeader,
  Select,
  Stack,
  Text,
  Textarea,
} from "@yourorg/ui";
import { AlertTriangle, FileText, Pencil } from "@yourorg/ui/icons";
import type { WorkOrderRecord } from "../actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { formatDateTime } from "@/lib/format/date";
import type { WorkOrderDraft } from "./work-order-draft";

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoDateTime(local: string): string {
  if (!local) return "";
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

export interface WorkOrderAssignmentSectionProps {
  mode: "create" | "edit";
  draft: WorkOrderDraft;
  workOrder?: WorkOrderRecord;
  members: OrgMemberRecord[];
  readOnly?: boolean;
  onSave: (
    patch: Pick<WorkOrderDraft, "description" | "notes" | "assignedTo" | "scheduledAt">,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Assignment" column (mockup's "Opdracht") — issue #102. Description as a
 * plain paragraph, Notes as a highlighted callout (only rendered when set —
 * the mockup's sample "Sleutel kelder ophalen…" text is just sample data,
 * not a hardcoded fixture), then a key/value list (Assigned to / Scheduled
 * for / From activity / Created / Last modified). All four editable fields
 * (description/notes/assignedTo/scheduledAt) share ONE small Edit popup —
 * same "one Edit button per section" convention `WorkOrderRelationCards`/
 * `WorkOrderChecklistSection` use, rather than a separate popup per field.
 * "From activity"/"Created"/"Last modified" are read-only system/derived
 * fields, never part of the popup. "Created" moved here from
 * `WorkOrderHero`'s own top-right slot (issue #103) — it's a record fact like
 * the others in this list, not something that belonged in the hero band.
 */
export function WorkOrderAssignmentSection({
  mode,
  draft,
  workOrder,
  members,
  readOnly,
  onSave,
}: WorkOrderAssignmentSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const memberById = new Map(members.map((member) => [member.id, member]));
  const assignedMember = draft.assignedTo ? memberById.get(draft.assignedTo) : undefined;
  const createdByMember = workOrder?.created_by ? memberById.get(workOrder.created_by) : undefined;

  const assignmentItems: KeyValueListItem[] = [
    {
      key: "assigned-to",
      label: "Assigned to",
      value: <Text>{assignedMember ? memberDisplayName(assignedMember) : "Unassigned"}</Text>,
    },
    {
      key: "scheduled-for",
      label: "Scheduled for",
      value: <Text>{draft.scheduledAt ? formatDateTime(draft.scheduledAt, { month: "long" }) : "—"}</Text>,
    },
    {
      // Issue #106: the label always renders now — only the link itself is
      // conditional. A work order with no source activity previously
      // dropped this row entirely, which read as a missing fact rather than
      // "not applicable"; a muted em dash (matching this list's other empty
      // values, e.g. "Scheduled for" above) makes that explicit instead.
      key: "from-activity",
      label: "From activity",
      // Issue #118 gave Activities a real `/activities/[id]` detail page —
      // deep-links straight there now instead of the old filtered-list +
      // auto-open-panel workaround this row used while that route didn't
      // exist yet.
      value: workOrder?.source_activity_id ? (
        <Link href={`/activities/${workOrder.source_activity_id}`}>View activity</Link>
      ) : (
        <Text tone="muted">—</Text>
      ),
    },
  ];
  if (mode === "edit" && workOrder) {
    assignmentItems.push(
      {
        key: "created",
        label: "Created",
        value: (
          <Text>
            {formatDateTime(workOrder.created_at, { month: "long" })}
            {createdByMember ? ` · ${memberDisplayName(createdByMember)}` : ""}
          </Text>
        ),
      },
      {
        key: "last-modified",
        label: "Last modified",
        value: <Text>{formatDateTime(workOrder.updated_at, { month: "long" })}</Text>,
      },
    );
  }

  return (
    <Stack gap="md">
      <SectionHeader
        icon={FileText}
        title="Assignment"
        actions={
          !readOnly && (
            <IconButton variant="ghost" aria-label="Edit assignment" onClick={() => setDialogOpen(true)}>
              <Pencil />
            </IconButton>
          )
        }
      />

      {draft.description ? (
        <Text>{draft.description}</Text>
      ) : (
        <Text tone="muted">No description yet.</Text>
      )}

      {draft.notes && <Callout icon={AlertTriangle}>{draft.notes}</Callout>}

      <KeyValueList items={assignmentItems} />

      {dialogOpen && (
        <WorkOrderAssignmentDialog
          open
          onOpenChange={setDialogOpen}
          draft={draft}
          members={members}
          onSave={onSave}
        />
      )}
    </Stack>
  );
}

function WorkOrderAssignmentDialog({
  open,
  onOpenChange,
  draft,
  members,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: WorkOrderDraft;
  members: OrgMemberRecord[];
  onSave: WorkOrderAssignmentSectionProps["onSave"];
}) {
  const [description, setDescription] = useState(draft.description);
  const [notes, setNotes] = useState(draft.notes);
  const [assignedTo, setAssignedTo] = useState(draft.assignedTo);
  const [scheduledAtLocal, setScheduledAtLocal] = useState(toDatetimeLocalValue(draft.scheduledAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const engineers = members.filter((member) => member.role === "engineer" || member.id === draft.assignedTo);

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await onSave({
      description,
      notes,
      assignedTo,
      scheduledAt: toIsoDateTime(scheduledAtLocal),
    });
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
        <Text>Edit assignment</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="sm">
            <Label htmlFor="wo-description">Description</Label>
            <Textarea
              id="wo-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Stack>
          <Stack gap="sm">
            <Label htmlFor="wo-notes">Notes</Label>
            <Textarea id="wo-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Stack>
          <Stack gap="sm">
            <Label htmlFor="wo-assigned-to">Assigned to (standard engineer)</Label>
            <Select id="wo-assigned-to" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
              <option value="">Unassigned</option>
              {engineers.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberDisplayName(member)}
                </option>
              ))}
            </Select>
            <Text tone="muted">
              Defaults every logged travel/work time entry to this engineer — changeable per entry.
            </Text>
          </Stack>
          <Stack gap="sm">
            <Label htmlFor="wo-scheduled">Scheduled for</Label>
            <Input
              id="wo-scheduled"
              type="datetime-local"
              value={scheduledAtLocal}
              onChange={(event) => setScheduledAtLocal(event.target.value)}
            />
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
