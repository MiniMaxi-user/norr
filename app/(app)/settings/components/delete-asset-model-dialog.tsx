"use client";

import { deleteAssetModel, type AssetModelRecord } from "@/lib/asset-models/actions";
import { SettingsDeleteDialog } from "./settings-dialog-kit";

export interface DeleteAssetModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: AssetModelRecord | null;
}

/** Delete confirmation for a single Asset Model. */
export function DeleteAssetModelDialog({ open, onOpenChange, model }: DeleteAssetModelDialogProps) {
  return (
    <SettingsDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${model?.name ?? "model"}?`}
      onConfirm={async () => {
        if (!model) return { error: "No model selected." };
        const result = await deleteAssetModel(model.id);
        return { error: result.error };
      }}
    >
      This cannot be undone.
    </SettingsDeleteDialog>
  );
}
