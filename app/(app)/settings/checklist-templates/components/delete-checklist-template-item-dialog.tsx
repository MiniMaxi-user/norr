"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
import { deleteChecklistTemplateItem, type ChecklistTemplateItemRecord } from "@/lib/checklist-templates/actions";

export interface DeleteChecklistTemplateItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ChecklistTemplateItemRecord | null;
}

/** Delete confirmation for a single template item — mirrors
 * `DeleteReferenceItemDialog`. */
export function DeleteChecklistTemplateItemDialog({ open, onOpenChange, item }: DeleteChecklistTemplateItemDialogProps) {
  const router = useRouter();

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${item?.label ?? "item"}?`}
      fallbackMessage="This cannot be undone. Work orders that already snapshotted this item into their own checklist keep their copy untouched."
      onConfirm={async () => {
        if (!item) return { error: "No item selected." };
        const result = await deleteChecklistTemplateItem(item.id);
        return { error: result.error };
      }}
      onDeleted={() => router.refresh()}
      confirmLabel="Delete"
    />
  );
}
