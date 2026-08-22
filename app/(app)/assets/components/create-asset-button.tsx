"use client";

import { useState } from "react";
import { Button } from "@yourorg/ui";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import { AssetFormDialog } from "./asset-form-dialog";

/** Owner-only "Add asset" trigger + dialog, used from both the toolbar and
 * the empty state's CTA. Mounts `AssetFormDialog` only while open so a
 * previous submission's leftover error/success state never flashes on
 * reopen. */
export function CreateAssetButton({ clients }: { clients: ClientRecord[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        Add asset
      </Button>
      {open && <AssetFormDialog mode="create" clients={clients} open onOpenChange={setOpen} />}
    </>
  );
}
