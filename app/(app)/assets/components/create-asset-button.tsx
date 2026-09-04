import Link from "next/link";
import { Button, type ButtonSize, type ButtonVariant } from "@yourorg/ui";

export interface CreateAssetButtonProps {
  /** Pre-scopes (and locks, via `/assets/new?clientId=...`) the Client
   * relation card — passed by the Clients detail page's Assets tab. */
  clientId?: string;
  /** Pre-selects (without locking) a site on the create page. */
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
 * Owner-only "Add asset" trigger — navigates to the full-page `/assets/new`
 * create form (asset new/edit design handoff) rather than opening a
 * `Dialog`. Replaces the `AssetFormDialog` slide-in panel this used to open
 * (issue #53) now that the product owner has reversed that decision back to
 * a real page — see `docs/ARCHITECTURE.md`'s "Popup vs. full page" section.
 * A plain Server Component `<Link>` again (no dialog `open` state to own).
 */
export function CreateAssetButton({ clientId, siteId, label, size, variant }: CreateAssetButtonProps) {
  const params = new URLSearchParams();
  if (clientId) params.set("clientId", clientId);
  if (siteId) params.set("siteId", siteId);
  const query = params.toString();

  return (
    <Link href={query ? `/assets/new?${query}` : "/assets/new"}>
      <Button type="button" variant={variant ?? "primary"} size={size}>
        {label ?? "Add asset"}
      </Button>
    </Link>
  );
}
