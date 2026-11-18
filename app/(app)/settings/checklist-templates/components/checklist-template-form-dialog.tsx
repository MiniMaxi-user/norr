"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  createChecklistTemplate,
  updateChecklistTemplate,
  type ChecklistTemplateRecord,
} from "@/lib/checklist-templates/actions";
import { DialogField, SettingsFormDialog, type DialogFormState } from "../../components/settings-dialog-kit";

const initialState: DialogFormState = {};

export interface ChecklistTemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for rename, absent for create. */
  template?: ChecklistTemplateRecord | null;
}

/**
 * Create/rename dialog for a checklist template — `name` is the only editable
 * column on `checklist_templates`, so this is a single-field dialog. The
 * manager mounts it only while open, so each open starts fresh.
 */
export function ChecklistTemplateFormDialog({ open, onOpenChange, template }: ChecklistTemplateFormDialogProps) {
  const isEdit = Boolean(template);
  const router = useRouter();

  async function action(_prevState: DialogFormState, formData: FormData): Promise<DialogFormState> {
    const input = { name: formData.get("name") };
    const result = isEdit
      ? await updateChecklistTemplate(template!.id, input)
      : await createChecklistTemplate(input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Something went wrong.", fieldErrors: result.fieldErrors };
    }
    return { success: true };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success) {
      onOpenChange(false);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <SettingsFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Rename template" : "Add checklist template"}
      submitLabel={isEdit ? "Save changes" : "Add template"}
      formAction={formAction}
      error={state.error}
    >
      <DialogField id="checklist-template-name" label="Name" errors={state.fieldErrors?.name}>
        <input
          id="checklist-template-name"
          className="web-input"
          name="name"
          defaultValue={template?.name}
          required
          maxLength={200}
          placeholder="e.g. HVAC Preventive Maintenance"
        />
      </DialogField>
    </SettingsFormDialog>
  );
}
