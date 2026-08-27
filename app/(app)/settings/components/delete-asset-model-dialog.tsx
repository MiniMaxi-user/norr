"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
import { deleteAssetModel, type AssetModelRecord } from "@/lib/asset-models/actions";

export interface DeleteAssetModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: AssetModelRecord | null;
}

/**
 * Delete confirmation for a single Asset Model — same shape as
 * `DeleteReferenceItemDialog`. `deleteAssetModel`'s own doc comment notes
 * there is no dependency-count helper needed yet (nothing references
 * `asset_models` today; issue #53's Asset form Model picker is on hold), so
 * a delete attempt simply succeeds or fails cleanly.
 */
export function DeleteAssetModelDialog({ open, onOpenChange, model }: DeleteAssetModelDialogProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  function handleDelete() {
    if (!model) return;
    const id = model.id;
    startDeleting(async () => {
      const result = await deleteAssetModel(id);
      if (result.error || !result.data) {
        setError(result.error ?? "Could not delete this model.");
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
        <Heading level={3}>Delete {model?.name ?? "model"}?</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          {error && <Text tone="danger">{error}</Text>}
          <Text tone="muted">This cannot be undone.</Text>
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
