"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
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

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete asset"
      fallbackMessage={
        <>
          Are you sure you want to delete <strong>{asset.name}</strong>? This cannot be undone.
        </>
      }
      onConfirm={async () => {
        const result = await deleteAsset(asset.id);
        return { error: !result.data ? (result.error ?? "Could not delete this asset.") : undefined };
      }}
      onDeleted={() => {
        if (redirectOnDelete) {
          router.push("/assets");
        }
        router.refresh();
      }}
      confirmLabel="Delete"
    />
  );
}
