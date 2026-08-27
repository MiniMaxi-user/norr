"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Input, Label, Stack, Text } from "@yourorg/ui";
import {
  createAccountManager,
  updateAccountManager,
  type AccountManagerRecord,
} from "@/lib/account-managers/actions";

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: FormState = {};

export interface AccountManagerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit, absent for create — same `isEdit = Boolean(accountManager)`
   * convention as `AssetModelFormDialog`/`ReferenceItemFormDialog`. */
  accountManager?: AccountManagerRecord | null;
}

/**
 * Create/edit dialog for a single `public.account_managers` row (issue #58)
 * — same `size="sm"` shape as `AssetModelFormDialog`, but much simpler: two
 * plain required text fields, no comboboxes, no cross-FK cascade.
 */
export function AccountManagerFormDialog({ open, onOpenChange, accountManager }: AccountManagerFormDialogProps) {
  const isEdit = Boolean(accountManager);
  const router = useRouter();

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
    const input = {
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
    };
    const result = isEdit
      ? await updateAccountManager(accountManager!.id, input)
      : await createAccountManager(input);
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
        <Heading level={3}>{isEdit ? "Edit account manager" : "Add account manager"}</Heading>
      </Dialog.Header>
      <form action={formAction}>
        <Dialog.Body>
          <Stack gap="md">
            {state.error && <Text tone="danger">{state.error}</Text>}

            <Stack gap="xs">
              <Label htmlFor="account-manager-first-name">First name</Label>
              <Input
                id="account-manager-first-name"
                name="firstName"
                defaultValue={accountManager?.first_name}
                required
                maxLength={200}
              />
              {state.fieldErrors?.firstName?.map((message) => (
                <Text key={message} tone="danger">
                  {message}
                </Text>
              ))}
            </Stack>

            <Stack gap="xs">
              <Label htmlFor="account-manager-last-name">Last name</Label>
              <Input
                id="account-manager-last-name"
                name="lastName"
                defaultValue={accountManager?.last_name}
                required
                maxLength={200}
              />
              {state.fieldErrors?.lastName?.map((message) => (
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
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add account manager"}
    </Button>
  );
}
