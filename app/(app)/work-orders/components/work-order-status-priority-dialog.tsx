"use client";

import { useState } from "react";
import { Button, Dialog, Label, Select, Stack, Text } from "@yourorg/ui";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { WorkOrderDraft } from "./work-order-draft";

export interface WorkOrderStatusPriorityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: WorkOrderDraft;
  statuses: ReferenceListItemRecord[];
  priorities: ReferenceListItemRecord[];
  onSave: (patch: Pick<WorkOrderDraft, "statusId" | "priorityId">) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Small popup behind the hero band's badges row Edit button (issue #102) —
 * the Status/Priority half of the old "Status & Priority" `Card`, ported
 * here as its own quick-edit popup so changing them doesn't require opening
 * the bigger Assignment popup too.
 */
export function WorkOrderStatusPriorityDialog({
  open,
  onOpenChange,
  draft,
  statuses,
  priorities,
  onSave,
}: WorkOrderStatusPriorityDialogProps) {
  const [statusId, setStatusId] = useState(draft.statusId);
  const [priorityId, setPriorityId] = useState(draft.priorityId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultStatus = statuses.find((item) => item.is_default);

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await onSave({ statusId, priorityId });
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
        <Text>Status &amp; priority</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="sm">
            <Label htmlFor="wo-status">Status</Label>
            <Select id="wo-status" value={statusId} onChange={(event) => setStatusId(event.target.value)}>
              <option value="">
                {defaultStatus ? `Use default (${defaultStatus.label})` : "Use organization default"}
              </option>
              {statuses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Stack>
          <Stack gap="sm">
            <Label htmlFor="wo-priority">Priority</Label>
            <Select id="wo-priority" value={priorityId} onChange={(event) => setPriorityId(event.target.value)}>
              <option value="">No priority</option>
              {priorities.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
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
