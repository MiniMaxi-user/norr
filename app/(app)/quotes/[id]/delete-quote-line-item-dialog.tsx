"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
import { deleteQuoteLineItem, type QuoteLineItemRecord } from "../actions";

export interface DeleteQuoteLineItemDialogProps {
  lineItem: QuoteLineItemRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Flat confirm dialog for removing a single line item — same small-popup
 * shape as `app/(app)/quotes/components/delete-quote-dialog.tsx`/
 * `app/(app)/contracts/components/delete-contract-dialog.tsx`.
 */
export function DeleteQuoteLineItemDialog({ lineItem, open, onOpenChange }: DeleteQuoteLineItemDialogProps) {
  const router = useRouter();

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete line item"
      fallbackMessage={
        <>
          Are you sure you want to delete <strong>{lineItem.description}</strong>? This cannot be undone.
        </>
      }
      onConfirm={async () => {
        const result = await deleteQuoteLineItem(lineItem.id);
        return { error: !result.data ? (result.error ?? "Could not delete this line item.") : undefined };
      }}
      onDeleted={() => router.refresh()}
      confirmLabel="Delete"
    />
  );
}
