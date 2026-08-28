"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
import { deleteActivity, type ActivityRecord } from "../actions";

export interface DeleteActivityDialogProps {
  activity: ActivityRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Navigate back to the overview after a successful delete instead of just
   * refreshing in place — used from the quick-view dialog / edit page. */
  redirectOnDelete?: boolean;
  /** Called only on a SUCCESSFUL delete, separate from `onOpenChange` (which
   * also fires on plain Cancel) — lets a caller nested inside another dialog
   * (`ActivityQuickViewDialog`) tell "the record is gone, close me too" apart
   * from "the user backed out of the confirmation". */
  onDeleted?: () => void;
}

/**
 * Flat confirm dialog — correctly a small popup per docs/ARCHITECTURE.md
 * "Popup vs. full page" (a single-record removal, no relations to surface),
 * same shape as `DeleteWorkOrderDialog`/`DeleteAssetDialog`. Owner/planner
 * only in practice (the only actors this ever renders for — an engineer has
 * no `delete` action on `activities` at all, see `lib/rbac/permissions.ts`).
 */
export function DeleteActivityDialog({
  activity,
  open,
  onOpenChange,
  redirectOnDelete,
  onDeleted,
}: DeleteActivityDialogProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteActivity(activity.id);
      if (!result.data) {
        setError(result.error ?? "Could not delete this activity.");
        return;
      }
      onOpenChange(false);
      onDeleted?.();
      if (redirectOnDelete) {
        router.push("/activities");
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Delete activity</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          <Text>
            Are you sure you want to delete this activity (<strong>{activity.description.slice(0, 80)}</strong>)?
            This cannot be undone.
          </Text>
          {error && <Text tone="danger">{error}</Text>}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={confirmDelete} disabled={isPending}>
          {isPending ? "Deleting…" : "Delete"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
