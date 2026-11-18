"use client";

import { deleteChecklistTemplate, type ChecklistTemplateRecord } from "@/lib/checklist-templates/actions";
import { SettingsDeleteDialog } from "../../components/settings-dialog-kit";

export interface DeleteChecklistTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ChecklistTemplateRecord | null;
}

/**
 * Delete confirmation for a whole checklist template (cascades to its items).
 * Work orders that already attached it keep their own snapshotted checklist
 * (`checklist_template_id` there is `on delete set null`).
 */
export function DeleteChecklistTemplateDialog({ open, onOpenChange, template }: DeleteChecklistTemplateDialogProps) {
  return (
    <SettingsDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${template?.name ?? "template"}?`}
      onConfirm={async () => {
        if (!template) return { error: "No template selected." };
        const result = await deleteChecklistTemplate(template.id);
        return { error: result.error };
      }}
    >
      This removes the template and its items as a future option for new checklists. Work orders that already attached
      this template keep their own already-completed checklist untouched.
    </SettingsDeleteDialog>
  );
}
