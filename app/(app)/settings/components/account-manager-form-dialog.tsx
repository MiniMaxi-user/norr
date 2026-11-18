"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  createAccountManager,
  updateAccountManager,
  type AccountManagerRecord,
} from "@/lib/account-managers/actions";
import { DialogField, SettingsFormDialog, type DialogFormState } from "./settings-dialog-kit";

const initialState: DialogFormState = {};

export interface AccountManagerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit, absent for create. */
  accountManager?: AccountManagerRecord | null;
}

/**
 * Create/edit dialog for a single `public.account_managers` row (issue #58):
 * two plain required text fields. The manager mounts it only while open, so
 * each open starts fresh.
 */
export function AccountManagerFormDialog({ open, onOpenChange, accountManager }: AccountManagerFormDialogProps) {
  const isEdit = Boolean(accountManager);
  const router = useRouter();

  async function action(_prevState: DialogFormState, formData: FormData): Promise<DialogFormState> {
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
    <SettingsFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit account manager" : "Add account manager"}
      submitLabel={isEdit ? "Save changes" : "Add account manager"}
      formAction={formAction}
      error={state.error}
    >
      <DialogField id="account-manager-first-name" label="First name" errors={state.fieldErrors?.firstName}>
        <input
          id="account-manager-first-name"
          className="web-input"
          name="firstName"
          defaultValue={accountManager?.first_name}
          required
          maxLength={200}
        />
      </DialogField>
      <DialogField id="account-manager-last-name" label="Last name" errors={state.fieldErrors?.lastName}>
        <input
          id="account-manager-last-name"
          className="web-input"
          name="lastName"
          defaultValue={accountManager?.last_name}
          required
          maxLength={200}
        />
      </DialogField>
    </SettingsFormDialog>
  );
}
