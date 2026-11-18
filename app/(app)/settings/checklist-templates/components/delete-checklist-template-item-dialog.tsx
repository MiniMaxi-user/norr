"use client";

import { deleteChecklistTemplateItem, type ChecklistTemplateItemRecord } from "@/lib/checklist-templates/actions";
import { SettingsDeleteDialog } from "../../components/settings-dialog-kit";

export interface DeleteChecklistTemplateItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ChecklistTemplateItemRecord | null;
}

/** Delete confirmation for a single template item. */
export function DeleteChecklistTemplateItemDialog({ open, onOpenChange, item }: DeleteChecklistTemplateItemDialogProps) {
  return (
    <SettingsDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${item?.label ?? "item"}?`}
      onConfirm={async () => {
        if (!item) return { error: "No item selected." };
        const result = await deleteChecklistTemplateItem(item.id);
        return { error: result.error };
      }}
    >
      This cannot be undone. Work orders that already snapshotted this item into their own checklist keep their copy
      untouched.
    </SettingsDeleteDialog>
  );
}
