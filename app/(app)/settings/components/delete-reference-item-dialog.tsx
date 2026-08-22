"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
import { deleteReferenceItem, type ReferenceListItemRecord } from "@/lib/reference-lists/actions";

export interface DeleteReferenceItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ReferenceListItemRecord | null;
}

/**
 * Delete confirmation for a single picklist value. `lib/reference-lists/
 * actions.ts`'s `deleteReferenceItem` doc comment notes there's no
 * dependency-count helper the way `getClientDependencyCounts` exists for
 * clients — a delete on a still-referenced value (e.g. an Asset Type still
 * used by an asset) simply fails cleanly (`23503`, mapped to a readable
 * message by `mapDbError`) and is surfaced here as-is.
 */
export function DeleteReferenceItemDialog({ open, onOpenChange, item }: DeleteReferenceItemDialogProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  function handleDelete() {
    if (!item) return;
    const id = item.id;
    startDeleting(async () => {
      const result = await deleteReferenceItem(id);
      if (result.error || !result.data) {
        setError(result.error ?? "Could not delete this value.");
        return;
      }
      setError(null);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Delete {item?.label ?? "value"}?</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          {error && <Text tone="danger">{error}</Text>}
          <Text tone="muted">
            This cannot be undone. If anything still uses this value, deleting it will be rejected — reassign
            those records first.
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
