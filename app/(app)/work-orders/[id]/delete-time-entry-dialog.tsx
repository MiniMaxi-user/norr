"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
import { deleteTimeEntry, type TimeEntryRecord } from "../time-entries-actions";

/**
 * Delete confirmation for a time entry. Only ever rendered when
 * `can(actor, "planning", "delete")` (owner/planner) — see
 * `time-entries-panel.tsx`. Plain confirm, no dependency-count check, same
 * shape as `app/(app)/clients/delete-contact-dialog.tsx`.
 */
export function DeleteTimeEntryDialog({
  open,
  onOpenChange,
  timeEntry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeEntry: TimeEntryRecord;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  function handleDelete() {
    startDeleting(async () => {
      const result = await deleteTimeEntry(timeEntry.id);
      if (result.error || !result.data) {
        setError(result.error ?? "Could not delete this time entry.");
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Delete time entry?</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          {error && <Text tone="danger">{error}</Text>}
          <Text tone="muted">This cannot be undone.</Text>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={handleDelete} disabled={isDeleting}>
          {isDeleting ? "Deleting…" : "Delete"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
