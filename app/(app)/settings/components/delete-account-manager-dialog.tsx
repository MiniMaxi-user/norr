"use client";

import { deleteAccountManager, type AccountManagerRecord } from "@/lib/account-managers/actions";
import { SettingsDeleteDialog } from "./settings-dialog-kit";

export interface DeleteAccountManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountManager: AccountManagerRecord | null;
}

/**
 * Delete confirmation for a single Account Manager. Deleting only clears
 * `account_manager_id` on clients that point at it (see
 * `deleteAccountManager`), so there is no dependency check.
 */
export function DeleteAccountManagerDialog({ open, onOpenChange, accountManager }: DeleteAccountManagerDialogProps) {
  const name = accountManager ? `${accountManager.first_name} ${accountManager.last_name}` : "account manager";

  return (
    <SettingsDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${name}?`}
      onConfirm={async () => {
        if (!accountManager) return { error: "No account manager selected." };
        const result = await deleteAccountManager(accountManager.id);
        return { error: result.error };
      }}
    >
      This cannot be undone. Any client currently assigned to this account manager will simply have no account manager
      afterwards.
    </SettingsDeleteDialog>
  );
}
