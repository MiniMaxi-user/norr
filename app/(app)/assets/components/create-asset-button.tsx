import Link from "next/link";
import { Button } from "@yourorg/ui";

export interface CreateAssetButtonProps {
  /** Pre-scopes the create page to a single client (`/assets/new?clientId=...`)
   * — passed by the Clients detail page's Assets tab so the client picker
   * arrives already locked, matching the old dialog's `lockedClientId`
   * behavior. */
  clientId?: string;
  /** Pre-selects (without locking) a site on the create page
   * (`/assets/new?siteId=...`). */
  siteId?: string;
  /** Overrides the default "Add asset" label — the Clients detail page uses
   * a shorter "Add asset" too, but a future call site might want e.g. "Add
   * asset to this site". */
  label?: string;
}

/**
 * Owner-only "Add asset" trigger — navigates to the full-page create form
 * (`/assets/new`, docs/ARCHITECTURE.md "Popup vs. full page — pick by
 * weight, not habit") instead of opening a `Dialog`. A plain Server
 * Component now (no dialog state to manage), used from both the toolbar and
 * the empty state's CTA.
 */
export function CreateAssetButton({ clientId, siteId, label }: CreateAssetButtonProps) {
  const params = new URLSearchParams();
  if (clientId) params.set("clientId", clientId);
  if (siteId) params.set("siteId", siteId);
  const query = params.toString();

  return (
    <Link href={query ? `/assets/new?${query}` : "/assets/new"}>
      <Button type="button" variant="primary">
        {label ?? "Add asset"}
      </Button>
    </Link>
  );
}
