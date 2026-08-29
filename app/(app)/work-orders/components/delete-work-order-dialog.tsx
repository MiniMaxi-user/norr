"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
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

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete work order"
      fallbackMessage={
        <>
          Are you sure you want to delete <strong>{workOrder.title}</strong>? This cannot be undone.
        </>
      }
      onConfirm={async () => {
        const result = await deleteWorkOrder(workOrder.id);
        return { error: !result.data ? (result.error ?? "Could not delete this work order.") : undefined };
      }}
      onDeleted={() => {
        if (redirectOnDelete) {
          router.push("/work-orders");
        }
        router.refresh();
      }}
      confirmLabel="Delete"
    />
  );
}
