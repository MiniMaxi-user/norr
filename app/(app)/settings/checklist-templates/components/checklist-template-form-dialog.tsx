"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Input, Label, Stack, Text } from "@yourorg/ui";
import {
  createChecklistTemplate,
  updateChecklistTemplate,
  type ChecklistTemplateRecord,
} from "@/lib/checklist-templates/actions";

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: FormState = {};

export interface ChecklistTemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for rename, absent for create — same `isEdit = Boolean(item)`
   * convention as `ReferenceItemFormDialog`. */
  template?: ChecklistTemplateRecord | null;
}

/**
 * Create/rename dialog for a checklist template — `name` is the only
 * editable column on `checklist_templates` today (see the migration's
 * column-grant lockdown), so this is deliberately a single-field dialog.
 * `Dialog` fully unmounts when closed (see `Dialog`'s own doc comment), so
 * each open gets a fresh `defaultValue` — no reset effect needed the way
 * `ReferenceItemFormDialog` needs one for its controlled `color` preview.
 */
export function ChecklistTemplateFormDialog({ open, onOpenChange, template }: ChecklistTemplateFormDialogProps) {
  const isEdit = Boolean(template);
  const router = useRouter();

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
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
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>{isEdit ? "Rename template" : "Add checklist template"}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="md">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <Stack gap="xs">
              <Label htmlFor="checklist-template-name">Name</Label>
              <Input
                id="checklist-template-name"
                name="name"
                defaultValue={template?.name}
                required
                maxLength={200}
                placeholder="e.g. HVAC Preventive Maintenance"
              />
              {state.fieldErrors?.name?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </Stack>
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
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add template"}
    </Button>
  );
}
