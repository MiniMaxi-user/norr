"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  createChecklistTemplateItem,
  updateChecklistTemplateItem,
  type ChecklistTemplateItemRecord,
} from "@/lib/checklist-templates/actions";
import { DialogField, SettingsFormDialog, type DialogFormState } from "../../components/settings-dialog-kit";

const initialState: DialogFormState = {};

export interface ChecklistTemplateItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  /** Present for edit, absent for create. */
  item?: ChecklistTemplateItemRecord | null;
}

/**
 * Create/edit dialog for a single item within a checklist template.
 * `sortOrder` is deliberately not a field: ordering is Move up / Move down in
 * the tree's row menu, so a new item is appended (DB default `0`, correctable
 * afterwards).
 */
export function ChecklistTemplateItemFormDialog({
  open,
  onOpenChange,
  templateId,
  item,
}: ChecklistTemplateItemFormDialogProps) {
  const isEdit = Boolean(item);
  const router = useRouter();

  async function action(_prevState: DialogFormState, formData: FormData): Promise<DialogFormState> {
    const input = {
      label: formData.get("label"),
      isRequired: formData.get("isRequired") === "on",
    };
    const result = isEdit
      ? await updateChecklistTemplateItem(item!.id, input)
      : await createChecklistTemplateItem(templateId, input);
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
      title={isEdit ? "Edit item" : "Add item"}
      submitLabel={isEdit ? "Save changes" : "Add item"}
      formAction={formAction}
      error={state.error}
    >
      <DialogField id="checklist-item-label" label="Label" errors={state.fieldErrors?.label}>
        <input
          id="checklist-item-label"
          className="web-input"
          name="label"
          defaultValue={item?.label}
          required
          maxLength={500}
          placeholder="e.g. Check refrigerant level"
        />
      </DialogField>

      <label className="web-field-checkbox" htmlFor="checklist-item-required">
        <input
          id="checklist-item-required"
          type="checkbox"
          name="isRequired"
          defaultChecked={item?.is_required ?? false}
        />
        Required
      </label>
    </SettingsFormDialog>
  );
}
