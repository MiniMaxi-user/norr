"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
import { deleteReferenceItem, type ReferenceListItemRecord } from "@/lib/reference-lists/actions";

export interface DeleteReferenceItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ReferenceListItemRecord | null;
}

/**
 * Delete confirmation for a single picklist value. `lib/reference-lists/
 * actions.ts`'s `deleteReferenceItem` doc comment notes there's no
 * dependency-count helper the way `getClientDependencyCounts` exists for
 * clients — a delete on a still-referenced value (e.g. an Asset Type still
 * used by an asset) simply fails cleanly (`23503`, mapped to a readable
 * message by `mapDbError`) and is surfaced here as-is.
 */
export function DeleteReferenceItemDialog({ open, onOpenChange, item }: DeleteReferenceItemDialogProps) {
  const router = useRouter();

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${item?.label ?? "value"}?`}
      fallbackMessage="This cannot be undone. If anything still uses this value, deleting it will be rejected — reassign those records first."
      onConfirm={async () => {
        if (!item) return { error: "No value selected." };
        const result = await deleteReferenceItem(item.id);
        return { error: result.error };
      }}
      onDeleted={() => router.refresh()}
      confirmLabel="Delete"
    />
  );
}
