"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Dialog, Heading, Inline, Input, Label, Stack, Text } from "@yourorg/ui";
import {
  createChecklistTemplateItem,
  updateChecklistTemplateItem,
  type ChecklistTemplateItemRecord,
} from "@/lib/checklist-templates/actions";

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: FormState = {};

export interface ChecklistTemplateItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  /** Present for edit, absent for create. */
  item?: ChecklistTemplateItemRecord | null;
}

/**
 * Create/edit dialog for a single item within a checklist template. `sortOrder`
 * is deliberately not a field here — ordering is handled by the up/down move
 * affordance in `ChecklistTemplateItemsManager` (same split
 * `ReferenceListManager`/`ReferenceItemFormDialog` establish for reference
 * items), so a brand-new item is simply appended (DB default `0`, correctable
 * afterwards with the arrows).
 */
export function ChecklistTemplateItemFormDialog({
  open,
  onOpenChange,
  templateId,
  item,
}: ChecklistTemplateItemFormDialogProps) {
  const isEdit = Boolean(item);
  const router = useRouter();

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
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
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>{isEdit ? "Edit item" : "Add item"}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="md">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <Stack gap="xs">
              <Label htmlFor="checklist-item-label">Label</Label>
              <Input
                id="checklist-item-label"
                name="label"
                defaultValue={item?.label}
                required
                maxLength={500}
                placeholder="e.g. Check refrigerant level"
              />
              {state.fieldErrors?.label?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </Stack>

            <Inline gap="sm" align="center">
              <Checkbox id="checklist-item-required" name="isRequired" defaultChecked={item?.is_required ?? false} />
              <Label htmlFor="checklist-item-required">Required</Label>
            </Inline>
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SubmitButton isEdit={isEdit} />
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add item"}
    </Button>
  );
}
