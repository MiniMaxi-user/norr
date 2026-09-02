"use client";

import { useState } from "react";
import { Button, Dialog, Label, Select, Stack, Text } from "@yourorg/ui";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { ActivityDraft } from "./activity-draft";

export interface ActivityStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ActivityDraft;
  activityStatuses: ReferenceListItemRecord[];
  onSave: (patch: Pick<ActivityDraft, "statusId">) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Small popup behind the hero's status badge Edit pencil — mirrors
 * `WorkOrderStatusPriorityDialog`'s placement/shape exactly (issue #106),
 * minus Priority (activities have no priority reference list).
 */
export function ActivityStatusDialog({ open, onOpenChange, draft, activityStatuses, onSave }: ActivityStatusDialogProps) {
  const [statusId, setStatusId] = useState(draft.statusId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultStatus = activityStatuses.find((item) => item.is_default);

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await onSave({ statusId });
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
        <Text>Status</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="sm">
            <Label htmlFor="activity-status">Status</Label>
            <Select id="activity-status" value={statusId} onChange={(event) => setStatusId(event.target.value)}>
              <option value="">
                {defaultStatus ? `Use default (${defaultStatus.label})` : "Use organization default"}
              </option>
              {activityStatuses.map((item) => (
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
