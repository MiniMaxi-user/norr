"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Card, FormGrid, Input, Label, Stack, Text } from "@yourorg/ui";
import { updateWorkOrderNumberingSettings } from "../work-order-numbering/actions";

export interface WorkOrderNumberingFormProps {
  initial: { prefix: string; nextNumber: number };
  /** `can(actor, "work_order_numbering", "update")` - read-only callers see text, no inputs. */
  canWrite: boolean;
}

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
  saved?: { prefix: string; nextNumber: number };
}

const initialState: FormState = {};

/**
 * Work order numbering settings (issue #218): prefix + next number with a live
 * preview of the next assigned work order number.
 */
export function WorkOrderNumberingForm({ initial, canWrite }: WorkOrderNumberingFormProps) {
  async function action(_prev: FormState, formData: FormData): Promise<FormState> {
    const input = {
      prefix: String(formData.get("prefix") ?? "").trim().toUpperCase(),
      nextNumber: Number(formData.get("nextNumber")),
    };
    const result = await updateWorkOrderNumberingSettings(input);
    if (result.error) {
      return { error: result.error, fieldErrors: result.fieldErrors };
    }
    return { success: true, saved: input };
  }

  const [state, formAction] = useActionState(action, initialState);
  const current = state.saved ?? initial;
  const [prefix, setPrefix] = useState(current.prefix);
  const [nextNumber, setNextNumber] = useState(String(current.nextNumber));

  const preview = `${(canWrite ? prefix : current.prefix).trim().toUpperCase()}${canWrite ? nextNumber : current.nextNumber}`;
  const errors = state.fieldErrors ?? {};

  const previewLine = <Text>Next work order number: <strong>{preview}</strong></Text>;

  if (!canWrite) {
    return (
      <Card>
        <Stack gap="md">
          <FormGrid columns={2}>
            <Stack gap="xs">
              <Label>Prefix</Label>
              <Text>{current.prefix}</Text>
            </Stack>
            <Stack gap="xs">
              <Label>Next number</Label>
              <Text>{current.nextNumber}</Text>
            </Stack>
          </FormGrid>
          {previewLine}
          <Text tone="muted">Only an owner or administratie member can change these settings.</Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Card>
      <form action={formAction}>
        <Stack gap="lg">
          {state.error && <Text tone="danger">{state.error}</Text>}
          {state.success && <Text tone="success">Work order numbering saved.</Text>}

          <FormGrid columns={2}>
            <Stack gap="xs">
              <Label htmlFor="work-order-numbering-prefix">Prefix</Label>
              <Input
                id="work-order-numbering-prefix"
                name="prefix"
                value={prefix}
                maxLength={10}
                onChange={(event) => setPrefix(event.target.value.toUpperCase())}
              />
              <Text tone="muted">1-10 characters: capital letters, digits and - _ . /. Changing the prefix does not renumber existing work orders.</Text>
              {errors.prefix?.map((message) => (
                <Text key={message} tone="danger">{message}</Text>
              ))}
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="work-order-numbering-next">Next number</Label>
              <Input
                id="work-order-numbering-next"
                name="nextNumber"
                type="number"
                min={initial.nextNumber}
                step={1}
                value={nextNumber}
                onChange={(event) => setNextNumber(event.target.value)}
              />
              <Text tone="muted">The number can only be raised, never lowered.</Text>
              {errors.nextNumber?.map((message) => (
                <Text key={message} tone="danger">{message}</Text>
              ))}
            </Stack>
          </FormGrid>

          {previewLine}

          <div>
            <SubmitButton />
          </div>
        </Stack>
      </form>
    </Card>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}
