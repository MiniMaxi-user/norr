import Link from "next/link";
import { Button, type ButtonSize } from "@yourorg/ui";

export interface CreateActivityButtonProps {
  /** Pre-scopes the create page to a single client (`/activities/new?clientId=...`)
   * — the client detail page's Activiteiten tab passes this. */
  clientId?: string;
  /** Pre-scopes the create page to a single asset — the asset detail page
   * passes this. Its own client is resolved server-side from the asset, so
   * `clientId` above is never combined with this. */
  assetId?: string;
  label?: string;
  size?: ButtonSize;
}

/**
 * "New activity" trigger — navigates to the full-page create form
 * (`/activities/new`, docs/ARCHITECTURE.md "Popup vs. full page — pick by
 * weight, not habit") rather than opening a `Dialog`. Issue #118 moved
 * Activities off the slide-in-panel carve-out `ActivityFormPanel` (deleted)
 * used, back to a plain `<Link>` trigger — same shape as
 * `CreateContractButton`. Rendered only when the caller holds
 * `create`/`create_own` on the `activities` module — an actor without either
 * never sees this at all.
 */
export function CreateActivityButton({ clientId, assetId, label, size }: CreateActivityButtonProps) {
  const params = new URLSearchParams();
  if (assetId) {
    params.set("assetId", assetId);
  } else if (clientId) {
    params.set("clientId", clientId);
  }
  const query = params.toString();

  return (
    <Link href={query ? `/activities/new?${query}` : "/activities/new"}>
      <Button type="button" variant="primary" size={size}>
        {label ?? "New activity"}
      </Button>
    </Link>
  );
}
