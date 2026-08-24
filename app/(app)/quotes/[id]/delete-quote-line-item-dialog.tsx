"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteQuoteLineItem(lineItem.id);
      if (!result.data) {
        setError(result.error ?? "Could not delete this line item.");
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Delete line item</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          <Text>
            Are you sure you want to delete <strong>{lineItem.description}</strong>? This cannot be undone.
          </Text>
          {error && <Text tone="danger">{error}</Text>}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={confirmDelete} disabled={isPending}>
          {isPending ? "Deleting…" : "Delete"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
