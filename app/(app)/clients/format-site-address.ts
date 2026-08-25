import type { SiteRecord } from "./actions";

/**
 * Shared "format a site as a label" helpers (issue #42, "Remove the Name
 * field from a client's Site/address") — a site no longer has its own
 * free-text `name`; it's identified purely by its formatted address
 * everywhere in the app. Both variants take a partial `SiteRecord` (`Pick`,
 * not the full record) so callers that only have a handful of address
 * columns in scope (e.g. a map pin, a `siteLabelById`-style lookup built from
 * a lighter row shape) don't need to thread a whole `SiteRecord` through just
 * to call these.
 *
 * Two variants, not one, since a full postal address reads well on a detail
 * page but is too long/noisy for a table row, dropdown option, map pin, or
 * legend entry:
 *  - `formatSiteAddress` — the full address (all parts, comma-separated),
 *    for detail views where this is the only representation shown (client
 *    hero meta line, delete-confirmation heading).
 *  - `formatSiteAddressShort` — a compact "address line 1, city" label, for
 *    tables/dropdowns/legends/map pins, especially ones that already show
 *    `city` or similar context alongside it.
 */

type FullAddressFields = Pick<SiteRecord, "address_line1" | "address_line2" | "postal_code" | "city" | "country">;

export function formatSiteAddress(site: FullAddressFields | null | undefined): string | null {
  if (!site) return null;
  const cityLine = [site.postal_code, site.city].filter(Boolean).join(" ");
  const parts = [site.address_line1, site.address_line2, cityLine, site.country].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length ? parts.join(", ") : null;
}

type ShortAddressFields = Pick<SiteRecord, "address_line1" | "city">;

export function formatSiteAddressShort(site: ShortAddressFields | null | undefined): string | null {
  if (!site) return null;
  const parts = [site.address_line1, site.city].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(", ") : null;
}
