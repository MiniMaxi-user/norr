"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
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
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  function handleDelete() {
    if (!accountManager) return;
    const id = accountManager.id;
    startDeleting(async () => {
      const result = await deleteAccountManager(id);
      if (result.error || !result.data) {
        setError(result.error ?? "Could not delete this account manager.");
        return;
      }
      setError(null);
      onOpenChange(false);
      router.refresh();
    });
  }

  const name = accountManager ? `${accountManager.first_name} ${accountManager.last_name}` : "account manager";

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Delete {name}?</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          {error && <Text tone="danger">{error}</Text>}
          <Text tone="muted">
            This cannot be undone. Any client currently assigned to this account manager will simply have no
            account manager afterwards.
          </Text>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={handleDelete} disabled={isDeleting}>
          {isDeleting ? "Deleting…" : "Delete"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
