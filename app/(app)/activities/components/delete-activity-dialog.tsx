"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
import { deleteActivity, type ActivityRecord } from "../actions";

export interface DeleteActivityDialogProps {
  activity: ActivityRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Navigate back to the overview after a successful delete instead of just
   * refreshing in place — used from the detail page's own Delete action. */
  redirectOnDelete?: boolean;
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
}: DeleteActivityDialogProps) {
  const router = useRouter();

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete activity"
      fallbackMessage={
        <>
          Are you sure you want to delete this activity (<strong>{activity.description.slice(0, 80)}</strong>)? This
          cannot be undone.
        </>
      }
      onConfirm={async () => {
        const result = await deleteActivity(activity.id);
        return { error: !result.data ? (result.error ?? "Could not delete this activity.") : undefined };
      }}
      onDeleted={() => {
        if (redirectOnDelete) {
          router.push("/activities");
        }
        router.refresh();
      }}
      confirmLabel="Delete"
    />
  );
}
