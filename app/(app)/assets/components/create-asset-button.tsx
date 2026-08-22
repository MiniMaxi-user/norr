"use client";

import { useState } from "react";
import { Button } from "@yourorg/ui";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { AssetFormDialog } from "./asset-form-dialog";

export interface CreateAssetButtonProps {
  clients: ClientRecord[];
  assetTypes: ReferenceListItemRecord[];
  assetStatuses: ReferenceListItemRecord[];
  /** Pre-scopes the create dialog to a single client (see
   * `AssetFormDialog`'s `lockedClientId`) — passed by the Clients detail
   * page's Assets tab. */
  lockedClientId?: string;
  /** Overrides the default "Add asset" label — the Clients detail page uses
   * a shorter "Add asset" too, but a future call site might want e.g. "Add
   * asset to this site". */
  label?: string;
}

/** Owner-only "Add asset" trigger + dialog, used from both the toolbar and
 * the empty state's CTA. Mounts `AssetFormDialog` only while open so a
 * previous submission's leftover error/success state never flashes on
 * reopen. */
export function CreateAssetButton({
  clients,
  assetTypes,
  assetStatuses,
  lockedClientId,
  label,
}: CreateAssetButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        {label ?? "Add asset"}
      </Button>
      {open && (
        <AssetFormDialog
          mode="create"
          clients={clients}
          lockedClientId={lockedClientId}
          assetTypes={assetTypes}
          assetStatuses={assetStatuses}
          open
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
