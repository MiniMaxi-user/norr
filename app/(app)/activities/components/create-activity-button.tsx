"use client";

import { useState } from "react";
import { Button, type ButtonSize } from "@yourorg/ui";
import { ActivityFormPanel } from "./activity-form-panel";

export interface CreateActivityButtonProps {
  /** Pre-scopes the panel to a single client — the client detail page's
   * Activiteiten tab passes this. */
  clientId?: string;
  /** Pre-scopes the panel to a single asset — the asset detail page passes
   * this. Its own client is resolved inside the panel from the asset, so
   * `clientId` above is never combined with this. */
  assetId?: string;
  label?: string;
  size?: ButtonSize;
}

/**
 * "New activity" trigger — opens `ActivityFormPanel` (a slide-in, per
 * `docs/ARCHITECTURE.md` "Popup vs. full page") instead of navigating to the
 * old `/activities/new` route (deleted). Owns its own `open` state so every
 * call site (`ActivitiesScreen`'s toolbar/empty state, `ActivitiesPanel` on
 * the client detail page, the asset detail page) stays a thin trigger with
 * no picklist prop-threading required — same shape as `CreateAssetButton`.
 * Rendered only when the caller holds `create`/`create_own` on the
 * `activities` module — an actor without either never sees this at all.
 */
export function CreateActivityButton({ clientId, assetId, label, size }: CreateActivityButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="primary" size={size} onClick={() => setOpen(true)}>
        {label ?? "New activity"}
      </Button>
      <ActivityFormPanel mode="create" lockedClientId={clientId} lockedAssetId={assetId} open={open} onOpenChange={setOpen} />
    </>
  );
}
