"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
import { deleteChecklistTemplateItem, type ChecklistTemplateItemRecord } from "@/lib/checklist-templates/actions";

export interface DeleteChecklistTemplateItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ChecklistTemplateItemRecord | null;
}

/** Delete confirmation for a single template item — mirrors
 * `DeleteReferenceItemDialog`. */
export function DeleteChecklistTemplateItemDialog({ open, onOpenChange, item }: DeleteChecklistTemplateItemDialogProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  function handleDelete() {
    if (!item) return;
    const id = item.id;
    startDeleting(async () => {
      const result = await deleteChecklistTemplateItem(id);
      if (result.error || !result.data) {
        setError(result.error ?? "Could not delete this item.");
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
        <Heading level={3}>Delete {item?.label ?? "item"}?</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          {error && <Text tone="danger">{error}</Text>}
          <Text tone="muted">
            This cannot be undone. Work orders that already snapshotted this item into their own checklist keep
            their copy untouched.
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
