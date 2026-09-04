"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@yourorg/ui";
import type { AssetRecord } from "../actions";
import { DeleteAssetDialog } from "../components/delete-asset-dialog";

/**
 * Edit now navigates to the full-page `/assets/[id]/edit` (asset new/edit
 * design handoff) instead of opening the `AssetFormDialog` slide-in panel
 * (issue #53) — the product owner has reversed that decision back to a real
 * page; see `docs/ARCHITECTURE.md`'s "Popup vs. full page" section.
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
