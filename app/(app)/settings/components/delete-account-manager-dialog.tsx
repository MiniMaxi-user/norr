"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
import { deleteAccountManager, type AccountManagerRecord } from "@/lib/account-managers/actions";

export interface DeleteAccountManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountManager: AccountManagerRecord | null;
}

/**
 * Delete confirmation for a single Account Manager — same shape as
 * `DeleteAssetModelDialog`. No dependency-count check needed: deleting an
 * Account Manager just `set null`s `account_manager_id` on any client
 * currently pointing at it (`deleteAccountManager`'s own doc comment), unlike
 * `deleteClient`'s cascade-delete warning.
 */
export function DeleteAccountManagerDialog({ open, onOpenChange, accountManager }: DeleteAccountManagerDialogProps) {
  const router = useRouter();
  const name = accountManager ? `${accountManager.first_name} ${accountManager.last_name}` : "account manager";

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${name}?`}
      fallbackMessage="This cannot be undone. Any client currently assigned to this account manager will simply have no account manager afterwards."
      onConfirm={async () => {
        if (!accountManager) return { error: "No account manager selected." };
        const result = await deleteAccountManager(accountManager.id);
        return { error: result.error };
      }}
      onDeleted={() => router.refresh()}
      confirmLabel="Delete"
    />
  );
}
