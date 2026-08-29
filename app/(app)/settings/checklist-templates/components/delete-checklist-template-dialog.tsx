"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
import { deleteChecklistTemplate, type ChecklistTemplateRecord } from "@/lib/checklist-templates/actions";

export interface DeleteChecklistTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ChecklistTemplateRecord | null;
}

/**
 * Delete confirmation for a whole checklist template (cascades to its
 * `checklist_template_items` via `on delete cascade`). Any work order that
 * already instantiated this template is unaffected — `checklist_template_id`
 * there is `on delete set null`, so an in-progress/completed instance keeps
 * its own already-snapshotted items regardless (see the migration's design
 * notes) — surfaced here so this isn't mistaken for "deletes the instances
 * too".
 */
export function DeleteChecklistTemplateDialog({ open, onOpenChange, template }: DeleteChecklistTemplateDialogProps) {
  const router = useRouter();

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${template?.name ?? "template"}?`}
      fallbackMessage="This removes the template and its items as a future option for new checklists. Work orders that already attached this template keep their own already-completed checklist untouched."
      onConfirm={async () => {
        if (!template) return { error: "No template selected." };
        const result = await deleteChecklistTemplate(template.id);
        return { error: result.error };
      }}
      onDeleted={() => router.refresh()}
      confirmLabel="Delete"
    />
  );
}
