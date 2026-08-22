"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Badge, Button, Dialog, Heading, Input, Label, Stack, Text } from "@yourorg/ui";
import {
  createReferenceItem,
  updateReferenceItem,
  type ReferenceListItemRecord,
} from "@/lib/reference-lists/actions";
import { REFERENCE_ITEM_COLOR_PALETTE } from "@/lib/reference-lists/schema";

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: FormState = {};

export interface ReferenceItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listKey: string;
  /** Present for edit, absent for create — same `isEdit = Boolean(item)`
   * convention as `ClientFormDialog`/`SiteFormDialog`. */
  item?: ReferenceListItemRecord | null;
}

/**
 * Create/edit dialog for a single value within a tenant-configurable
 * reference list (Asset Type/Status today). Generic over `listKey` — reused
 * by `ReferenceListManager` for every list rather than one dialog per list.
 */
export function ReferenceItemFormDialog({ open, onOpenChange, listKey, item }: ReferenceItemFormDialogProps) {
  const isEdit = Boolean(item);
  const router = useRouter();
  const [color, setColor] = useState(item?.color ?? "");

  useEffect(() => {
    setColor(item?.color ?? "");
  }, [item]);

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
    const input = {
      value: formData.get("value"),
      label: formData.get("label"),
      color: formData.get("color") || undefined,
    };
    const result = isEdit ? await updateReferenceItem(item!.id, input) : await createReferenceItem(listKey, input);
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
        <Heading level={3}>{isEdit ? "Edit value" : "Add value"}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="md">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <Stack gap="xs">
              <Label htmlFor="ref-item-label">Label</Label>
              <Input id="ref-item-label" name="label" defaultValue={item?.label} required maxLength={200} />
              {state.fieldErrors?.label?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </Stack>

            <Stack gap="xs">
              <Label htmlFor="ref-item-value">Value (stable id)</Label>
              <Input
                id="ref-item-value"
                name="value"
                defaultValue={item?.value}
                required
                maxLength={100}
                placeholder="e.g. hvac"
              />
              <Text tone="muted">
                Lowercase letters, numbers, and underscores only. Not shown anywhere — only the Label is
                user-facing.
              </Text>
              {state.fieldErrors?.value?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </Stack>

            <Stack gap="xs">
              <Label htmlFor="ref-item-color">Color</Label>
              <Input
                id="ref-item-color"
                name="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                placeholder="blue, green, #22c55e…"
                maxLength={20}
              />
              <Text tone="muted">
                One of: {REFERENCE_ITEM_COLOR_PALETTE.join(", ")} — or a hex code (e.g. #22c55e). Leave blank for
                no color.
              </Text>
              {color && (
                <div>
                  <Badge color={color}>{item?.label || "Preview"}</Badge>
                </div>
              )}
              {state.fieldErrors?.color?.map((message) => (
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
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add value"}
    </Button>
  );
}
