"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog } from "@yourorg/ui";
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

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${model?.name ?? "model"}?`}
      onConfirm={async () => {
        if (!model) return { error: "No model selected." };
        const result = await deleteAssetModel(model.id);
        return { error: result.error };
      }}
      onDeleted={() => router.refresh()}
      confirmLabel="Delete"
    />
  );
}
