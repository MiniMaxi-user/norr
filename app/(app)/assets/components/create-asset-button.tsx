"use client";

import { useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@yourorg/ui";
import { AssetFormDialog } from "./asset-form-dialog";

export interface CreateAssetButtonProps {
  /** Pre-scopes the dialog to a single client (locks the client picker,
   * hides it entirely) — passed by the Clients detail page's Assets tab. */
  clientId?: string;
  /** Pre-selects (without locking) a site in the dialog. */
  siteId?: string;
  /** Overrides the default "Add asset" label — the Clients detail page's
   * Assets tab (`assets-panel.tsx`) passes "+ Asset" to match the
   * `SectionHeader` "+ X" convention (docs/DESIGN-SYSTEM.md "tab-panel add
   * button" convention) rather than this default. */
  label?: string;
  /** The standalone Assets module page (`assets-screen.tsx`) wants its own
   * default (larger) toolbar button; a client-detail tab's toolbar wants
   * `"sm"` to match every other tab's "Add X" button there (Sites, Contacts
   * — issue #51). Left undefined (default size) for the module page, passed
   * explicitly as `"sm"` from `clients/[id]/assets-panel.tsx`. */
  size?: ButtonSize;
  /** Both the standalone module page's own "New Asset" toolbar button and a
   * client-detail tab's `SectionHeader` "add" action use the default
   * top-level `"primary"` (accent) treatment, just at different sizes (see
   * `size` above) — see `docs/DESIGN-SYSTEM.md`'s "Buttons: default size vs.
   * small" and `docs/ARCHITECTURE.md`'s tab-panel "Add X" button convention.
   * Left overridable for a future caller that genuinely needs a different
   * variant; unused by either current caller. */
  variant?: ButtonVariant;
}

/**
 * Owner-only "Add asset" trigger — opens the slide-in `AssetFormDialog`
 * (issue #53: "Asset edit pagina is omgebouwd als slider popup", see that
 * component's own doc comment and docs/ARCHITECTURE.md "Popup vs. full
 * page") instead of navigating to the old `/assets/new` route (deleted). A
 * `"use client"` component now (owns the dialog's `open` state) rather than
 * the previous plain `<Link>` Server Component.
 */
export function CreateAssetButton({ clientId, siteId, label, size, variant }: CreateAssetButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant={variant ?? "primary"} size={size} onClick={() => setOpen(true)}>
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
