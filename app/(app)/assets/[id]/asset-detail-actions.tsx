"use client";

import { useState } from "react";
import { Button } from "@yourorg/ui";
import type { AssetRecord } from "../actions";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { AssetFormDialog } from "../components/asset-form-dialog";
import { DeleteAssetDialog } from "../components/delete-asset-dialog";

export function AssetDetailActions({
  asset,
  clients,
  assetTypes,
  assetStatuses,
  assetSubtypes,
  canEdit,
  canDelete,
}: {
  asset: AssetRecord;
  clients: ClientRecord[];
  assetTypes: ReferenceListItemRecord[];
  assetStatuses: ReferenceListItemRecord[];
  assetSubtypes: ReferenceListItemRecord[];
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

      {editing && (
        <AssetFormDialog
          mode="edit"
          asset={asset}
          clients={clients}
          assetTypes={assetTypes}
          assetStatuses={assetStatuses}
          assetSubtypes={assetSubtypes}
          open
          onOpenChange={setEditing}
        />
      )}
      {deleting && (
        <DeleteAssetDialog asset={asset} open onOpenChange={setDeleting} redirectOnDelete />
      )}
    </>
  );
}
