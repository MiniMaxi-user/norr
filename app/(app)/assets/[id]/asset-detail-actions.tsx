"use client";

import { useState } from "react";
import { Button } from "@yourorg/ui";
import type { AssetRecord } from "../actions";
import { AssetFormDialog } from "../components/asset-form-dialog";
import { DeleteAssetDialog } from "../components/delete-asset-dialog";

/**
 * Edit now opens the slide-in `AssetFormDialog` (issue #53) instead of
 * navigating to the old `/assets/[id]/edit` route (deleted) — same "Popup
 * vs. full page" carve-out documented on that component.
 */
export function AssetDetailActions({
  asset,
  canEdit,
  canDelete,
}: {
  asset: AssetRecord;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      {canEdit && (
        <Button type="button" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
      )}
      {canDelete && (
        <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
          Delete
        </Button>
      )}

      {canEdit && <AssetFormDialog open={editing} onOpenChange={setEditing} mode="edit" asset={asset} />}
      {deleting && <DeleteAssetDialog asset={asset} open onOpenChange={setDeleting} redirectOnDelete />}
    </>
  );
}
