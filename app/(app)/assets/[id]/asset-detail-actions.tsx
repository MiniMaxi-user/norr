"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@yourorg/ui";
import type { AssetRecord } from "../actions";
import { DeleteAssetDialog } from "../components/delete-asset-dialog";

export function AssetDetailActions({
  asset,
  canEdit,
  canDelete,
}: {
  asset: AssetRecord;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      {canEdit && (
        <Link href={`/assets/${asset.id}/edit`}>
          <Button type="button" variant="outline">
            Edit
          </Button>
        </Link>
      )}
      {canDelete && (
        <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
          Delete
        </Button>
      )}

      {deleting && <DeleteAssetDialog asset={asset} open onOpenChange={setDeleting} redirectOnDelete />}
    </>
  );
}
