"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
import { deleteAsset, type AssetRecord } from "../actions";

export interface DeleteAssetDialogProps {
  asset: AssetRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Detail page usage: navigate back to the list after a successful
   * delete instead of just refreshing in place (list view usage). */
  redirectOnDelete?: boolean;
}

export function DeleteAssetDialog({ asset, open, onOpenChange, redirectOnDelete }: DeleteAssetDialogProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteAsset(asset.id);
      if (!result.data) {
        setError(result.error ?? "Could not delete this asset.");
        return;
      }
      onOpenChange(false);
      if (redirectOnDelete) {
        router.push("/assets");
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Delete asset</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          <Text>
            Are you sure you want to delete <strong>{asset.name}</strong>? This cannot be undone.
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
