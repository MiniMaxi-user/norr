"use client";

import { useState } from "react";
import { Button, type ButtonSize } from "@yourorg/ui";
import { AssetFormDialog } from "./asset-form-dialog";

export interface CreateAssetButtonProps {
  /** Pre-scopes the dialog to a single client (locks the client picker,
   * hides it entirely) — passed by the Clients detail page's Assets tab. */
  clientId?: string;
  /** Pre-selects (without locking) a site in the dialog. */
  siteId?: string;
  /** Overrides the default "Add asset" label — the Clients detail page uses
   * a shorter "Add asset" too, but a future call site might want e.g. "Add
   * asset to this site". */
  label?: string;
  /** The standalone Assets module page (`assets-screen.tsx`) wants its own
   * default (larger) toolbar button; a client-detail tab's toolbar wants
   * `"sm"` to match every other tab's "Add X" button there (Sites, Contacts
   * — issue #51). Left undefined (default size) for the module page, passed
   * explicitly as `"sm"` from `clients/[id]/assets-panel.tsx`. */
  size?: ButtonSize;
}

/**
 * Owner-only "Add asset" trigger — opens the slide-in `AssetFormDialog`
 * (issue #53: "Asset edit pagina is omgebouwd als slider popup", see that
 * component's own doc comment and docs/ARCHITECTURE.md "Popup vs. full
 * page") instead of navigating to the old `/assets/new` route (deleted). A
 * `"use client"` component now (owns the dialog's `open` state) rather than
 * the previous plain `<Link>` Server Component.
 */
export function CreateAssetButton({ clientId, siteId, label, size }: CreateAssetButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="primary" size={size} onClick={() => setOpen(true)}>
        {label ?? "Add asset"}
      </Button>
      <AssetFormDialog
        open={open}
        onOpenChange={setOpen}
        mode="create"
        lockedClientId={clientId}
        initialSiteId={siteId}
      />
    </>
  );
}
