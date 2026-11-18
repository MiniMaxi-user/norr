"use client";

import { useState } from "react";
import { Button, type ButtonSize } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import { NewWorkOrderPickerDialog } from "./new-work-order-picker-dialog";

export interface CreateWorkOrderButtonProps {
  /** Pre-scopes the picker (and the create page it hands off to) to a single
   * client — same `lockedClientId` shape as `CreateAssetButton`, used both by
   * a future client-scoped entry point and (issue #113 follow-up) the
   * Clients detail page's own Work Orders tab. */
  clientId?: string;
  label?: string;
  /** Every client in scope for the picker's own Client `<Select>` —
   * `work-orders-list.tsx`'s already-fetched `clients` list. Omitted
   * (defaults to empty) when `clientId` is set, since the picker hides that
   * field entirely once locked to a single client. */
  clients?: ClientRecord[];
  /** The standalone Work Orders overview page's own toolbar button wants the
   * default (larger) size; the Clients detail page's Work Orders tab
   * (`work-orders-panel.tsx`) passes `"sm"` to match every other tab's
   * `SectionHeader` "+ X" button there — same `size` convention
   * `CreateAssetButton`/`CreateActivityButton` already use. */
  size?: ButtonSize;
  /** Renders the design system's FilterBar add button (secondary, 30px, "+ X"
   * text, no icon) instead of the standard `Button` — used by the
   * related-list tabs of a detail page (issue #222). */
  filterBar?: boolean;
  /** `primary`: the list page header's navy WebButton (issue #222); `link`:
   * the empty state's inline text link. */
  webStyle?: "primary" | "link";
}

/**
 * Owner/planner "New work order" trigger — rendered only when
 * `can(actor, "planning", "create")` (an engineer never sees this, matching
 * `createWorkOrder`'s own RBAC gate), same as before.
 *
 * *** Issue #106 *** changed this from a plain `<Link>` straight to
 * `/work-orders/new` into a button that first opens `NewWorkOrderPickerDialog`
 * — a small popup collecting Client/Site/Asset (required) + Contract
 * (optional) via the exact same cascade `WorkOrderRelationsDialog` uses. That
 * popup doesn't persist anything itself; on "Continue" it navigates to
 * `/work-orders/new?clientId=&siteId=&assetId=&contractId=`, which is still
 * the real full-page create form (docs/ARCHITECTURE.md "Popup vs. full
 * page" — Work Orders stays a top-level module's own record, never a
 * `Dialog` create/edit surface) — this popup's whole job is only to gather
 * the mandatory relations before dropping the user into that unchanged
 * screen for the actual Save.
 */
export function CreateWorkOrderButton({ clientId, label, clients = [], size, filterBar, webStyle }: CreateWorkOrderButtonProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      {webStyle === "primary" ? (
        <WebButton variant="primary" onClick={() => setPickerOpen(true)}>
          {label ?? "New work order"}
        </WebButton>
      ) : webStyle === "link" ? (
        <button type="button" className="web-rail-link" onClick={() => setPickerOpen(true)}>
          {label ?? "New work order"}
        </button>
      ) : filterBar ? (
        <WebButton size="filter" onClick={() => setPickerOpen(true)}>
          {label ?? "New work order"}
        </WebButton>
      ) : (
        <Button type="button" variant="primary" size={size} onClick={() => setPickerOpen(true)}>
          {label ?? "New work order"}
        </Button>
      )}
      {pickerOpen && (
        <NewWorkOrderPickerDialog open onOpenChange={setPickerOpen} clients={clients} lockedClientId={clientId} />
      )}
    </>
  );
}
