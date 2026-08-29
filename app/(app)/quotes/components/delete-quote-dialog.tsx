"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
import { deleteQuote, type QuoteRecord } from "../actions";

export interface DeleteQuoteDialogProps {
  quote: QuoteRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Detail page usage: navigate back to the list after a successful delete
   * instead of just refreshing in place (list view usage). */
  redirectOnDelete?: boolean;
}

/**
 * Flat confirm dialog — correctly a small popup per docs/ARCHITECTURE.md
 * "Popup vs. full page" (a single-record removal; its `quote_line_items`
 * cascade-delete at the DB layer, no separate confirmation needed for
 * those), same shape as `app/(app)/contracts/components/delete-contract-dialog.tsx`.
 */
export function DeleteQuoteDialog({ quote, open, onOpenChange, redirectOnDelete }: DeleteQuoteDialogProps) {
  const router = useRouter();

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete quote"
      fallbackMessage={
        <>
          Are you sure you want to delete <strong>{quote.name}</strong>? This also removes its line items. This
          cannot be undone.
        </>
      }
      onConfirm={async () => {
        const result = await deleteQuote(quote.id);
        return { error: !result.data ? (result.error ?? "Could not delete this quote.") : undefined };
      }}
      onDeleted={() => {
        if (redirectOnDelete) {
          router.push("/quotes");
        }
        router.refresh();
      }}
      confirmLabel="Delete"
    />
  );
}
