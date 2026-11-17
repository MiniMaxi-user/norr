"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Card, FormGrid, Input, Label, Stack, Text } from "@yourorg/ui";
import { updateContractNumberingSettings } from "../contract-numbering/actions";

export interface ContractNumberingFormProps {
  initial: { prefix: string; nextNumber: number };
  /** `can(actor, "contract_numbering", "update")` - read-only callers see text, no inputs. */
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
 * Contract numbering settings (issue #216): prefix + next number with a live
 * preview of the next assigned contract number.
 */
export function ContractNumberingForm({ initial, canWrite }: ContractNumberingFormProps) {
  async function action(_prev: FormState, formData: FormData): Promise<FormState> {
    const input = {
      prefix: String(formData.get("prefix") ?? "").trim().toUpperCase(),
      nextNumber: Number(formData.get("nextNumber")),
    };
    const result = await updateContractNumberingSettings(input);
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

  const previewLine = <Text>Next contract number: <strong>{preview}</strong></Text>;

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
          {state.success && <Text tone="success">Contract numbering saved.</Text>}

          <FormGrid columns={2}>
            <Stack gap="xs">
              <Label htmlFor="contract-numbering-prefix">Prefix</Label>
              <Input
                id="contract-numbering-prefix"
                name="prefix"
                value={prefix}
                maxLength={10}
                onChange={(event) => setPrefix(event.target.value.toUpperCase())}
              />
              <Text tone="muted">1-10 characters: capital letters, digits and - _ . /. Changing the prefix does not renumber existing contracts.</Text>
              {errors.prefix?.map((message) => (
                <Text key={message} tone="danger">{message}</Text>
              ))}
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="contract-numbering-next">Next number</Label>
              <Input
                id="contract-numbering-next"
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
