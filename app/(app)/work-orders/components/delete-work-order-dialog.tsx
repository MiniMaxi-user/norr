"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
import { deleteWorkOrder, type WorkOrderRecord } from "../actions";

export interface DeleteWorkOrderDialogProps {
  workOrder: WorkOrderRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Detail page usage: navigate back to the list after a successful delete
   * instead of just refreshing in place (list view usage). */
  redirectOnDelete?: boolean;
}

/**
 * Flat confirm dialog — correctly a small popup per docs/ARCHITECTURE.md
 * "Popup vs. full page" (a single-record removal, no relations to surface),
 * same shape as `app/(app)/assets/components/delete-asset-dialog.tsx`.
 */
export function DeleteWorkOrderDialog({ workOrder, open, onOpenChange, redirectOnDelete }: DeleteWorkOrderDialogProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteWorkOrder(workOrder.id);
      if (!result.data) {
        setError(result.error ?? "Could not delete this work order.");
        return;
      }
      onOpenChange(false);
      if (redirectOnDelete) {
        router.push("/work-orders");
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Delete work order</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          <Text>
            Are you sure you want to delete <strong>{workOrder.title}</strong>? This cannot be undone.
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
