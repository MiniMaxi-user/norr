"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteQuote(quote.id);
      if (!result.data) {
        setError(result.error ?? "Could not delete this quote.");
        return;
      }
      onOpenChange(false);
      if (redirectOnDelete) {
        router.push("/quotes");
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Delete quote</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          <Text>
            Are you sure you want to delete <strong>{quote.name}</strong>? This also removes its line items.
            This cannot be undone.
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
