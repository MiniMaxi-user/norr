"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Label, Stack, Text, Textarea } from "@yourorg/ui";
import { createClient, updateClient, type ClientRecord } from "./actions";
import { FormField } from "./form-field";
import { useEscapeToClose } from "./use-escape-to-close";

interface ClientFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: ClientFormState = {};

/**
 * Create/edit dialog for a client. Owner-only — callers must gate rendering
 * on `can(actor, "clients", "create" | "update")` themselves (this
 * component doesn't re-check RBAC; it just posts to whichever Server Action
 * applies).
 *
 * Uses `useActionState` the same way `app/(auth)/login/login-form.tsx`
 * does, but the action passed in is a small local wrapper (not itself a
 * `"use server"` export) that adapts the native `FormData` a `<form
 * action={...}>` produces into the plain object `createClient`/
 * `updateClient` expect, and maps their `ActionResult` shape
 * (`lib/actions/result.ts`) into this dialog's local form state. `useActionState`
 * accepts any async function here, server action or not (React 19) — see
 * docs on Form Actions.
 */
export function ClientFormDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: ClientRecord | null;
}) {
  const isEdit = Boolean(client);
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  async function action(_prevState: ClientFormState, formData: FormData): Promise<ClientFormState> {
    const input = Object.fromEntries(formData.entries());
    const result = isEdit ? await updateClient(client!.id, input) : await createClient(input);
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
    // Only re-run when the mutation actually succeeds — `onOpenChange`/
    // `router` are stable enough for this dialog's lifetime and including
    // them would re-fire this on every re-render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Header>
        <Heading level={3}>{isEdit ? "Edit client" : "Add client"}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="md">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <FormField label="Name" name="name" defaultValue={client?.name} required errors={state.fieldErrors?.name} />
            <FormField
              label="Email"
              name="email"
              type="email"
              defaultValue={client?.email}
              errors={state.fieldErrors?.email}
            />
            <FormField label="Phone" name="phone" defaultValue={client?.phone} errors={state.fieldErrors?.phone} />
            <FormField
              label="Address line 1"
              name="addressLine1"
              defaultValue={client?.address_line1}
              errors={state.fieldErrors?.addressLine1}
            />
            <FormField
              label="Address line 2"
              name="addressLine2"
              defaultValue={client?.address_line2}
              errors={state.fieldErrors?.addressLine2}
            />
            <FormField
              label="Postal code"
              name="postalCode"
              defaultValue={client?.postal_code}
              errors={state.fieldErrors?.postalCode}
            />
            <FormField label="City" name="city" defaultValue={client?.city} errors={state.fieldErrors?.city} />
            <FormField label="Country" name="country" defaultValue={client?.country} errors={state.fieldErrors?.country} />

            <Stack gap="xs">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" defaultValue={client?.notes ?? ""} />
              {state.fieldErrors?.notes?.map((message) => (
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
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add client"}
    </Button>
  );
}
