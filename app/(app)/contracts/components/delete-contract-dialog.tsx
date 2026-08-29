"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
import { deleteContract, type ContractRecord } from "../actions";

export interface DeleteContractDialogProps {
  contract: ContractRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Detail page usage: navigate back to the list after a successful delete
   * instead of just refreshing in place (list view usage). */
  redirectOnDelete?: boolean;
}

/**
 * Flat confirm dialog — correctly a small popup per docs/ARCHITECTURE.md
 * "Popup vs. full page" (a single-record removal; its `contract_assets`
 * links cascade-delete at the DB layer, no separate confirmation needed for
 * those), same shape as `app/(app)/work-orders/components/delete-work-order-dialog.tsx`.
 */
export function DeleteContractDialog({ contract, open, onOpenChange, redirectOnDelete }: DeleteContractDialogProps) {
  const router = useRouter();

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete contract"
      fallbackMessage={
        <>
          Are you sure you want to delete <strong>{contract.name}</strong>? This also removes its linked assets.
          This cannot be undone.
        </>
      }
      onConfirm={async () => {
        const result = await deleteContract(contract.id);
        return { error: !result.data ? (result.error ?? "Could not delete this contract.") : undefined };
      }}
      onDeleted={() => {
        if (redirectOnDelete) {
          router.push("/contracts");
        }
        router.refresh();
      }}
      confirmLabel="Delete"
    />
  );
}
