"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
import { deleteTimeEntry, type TimeEntryRecord } from "../time-entries-actions";

/**
 * Delete confirmation for a time entry. Only ever rendered when
 * `can(actor, "planning", "delete")` (owner/planner) — see
 * `work-order-hours-section.tsx`. Plain confirm, no dependency-count check,
 * same shape as `app/(app)/clients/delete-contact-dialog.tsx`.
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

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete time entry?"
      onConfirm={async () => {
        const result = await deleteTimeEntry(timeEntry.id);
        return { error: result.error };
      }}
      onDeleted={() => router.refresh()}
      confirmLabel="Delete"
    />
  );
}
