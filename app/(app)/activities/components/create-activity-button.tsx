import Link from "next/link";
import { Button, type ButtonSize } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";

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
  /** Renders the design system's FilterBar add button (secondary, 30px,
   * "+ Activity" text, no icon) instead of the standard `Button` — used by the
   * related-list tabs of a detail page (issue #222). */
  filterBar?: boolean;
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
export function CreateActivityButton({ clientId, assetId, label, size, filterBar }: CreateActivityButtonProps) {
  const params = new URLSearchParams();
  if (assetId) {
    params.set("assetId", assetId);
  } else if (clientId) {
    params.set("clientId", clientId);
  }
  const query = params.toString();

  return (
    <Link href={query ? `/activities/new?${query}` : "/activities/new"}>
      {filterBar ? (
        <WebButton size="filter">{label ?? "New activity"}</WebButton>
      ) : (
        <Button type="button" variant="primary" size={size}>
          {label ?? "New activity"}
        </Button>
      )}
    </Link>
  );
}
