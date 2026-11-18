"use client";

import { deleteReferenceItem, type ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { SettingsDeleteDialog } from "./settings-dialog-kit";

export interface DeleteReferenceItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ReferenceListItemRecord | null;
}

/**
 * Delete confirmation for a single picklist value. A delete on a
 * still-referenced value (e.g. an Asset Type still used by an asset) fails
 * cleanly in `deleteReferenceItem` and the message is surfaced as-is.
 */
export function DeleteReferenceItemDialog({ open, onOpenChange, item }: DeleteReferenceItemDialogProps) {
  return (
    <SettingsDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${item?.label ?? "value"}?`}
      onConfirm={async () => {
        if (!item) return { error: "No value selected." };
        const result = await deleteReferenceItem(item.id);
        return { error: result.error };
      }}
    >
      This cannot be undone. If anything still uses this value, deleting it will be rejected — reassign those records
      first.
    </SettingsDeleteDialog>
  );
}
