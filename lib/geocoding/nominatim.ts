import "server-only";

/**
 * Free, no-API-key geocoding via OpenStreetMap's Nominatim search API
 * (issue #41, Client Addresses). No marketplace integration exists for this
 * (confirmed via `vercel integration discover`) — same free/no-auth
 * OSM-based approach this repo already uses for Leaflet/OSM map *tiles* in
 * `app/(app)/assets/components/asset-map.tsx`, just the search endpoint
 * instead of the tile endpoint.
 *
 * Usage/fair-use policy (https://operations.osmfoundation.org/policies/nominatim/):
 *  - Requires a descriptive `User-Agent` identifying the calling application
 *    (below).
 *  - Max ~1 request/second, no bulk/heavy use. This module is called once
 *    per client-address create, and once per update where an address field
 *    actually changed (see `app/(app)/clients/actions.ts`) —
 *    a single on-save geocode per form submit, not a live-typing
 *    autocomplete, comfortably within fair use.
 *
 * `geocodeAddress` never throws: any network failure, non-OK HTTP response,
 * or "no match" result in `null` so a caller can save the record without a
 * pin rather than block the save on a geocoding hiccup.
 */

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

/** No dedicated support-contact email/URL exists yet anywhere else in this
 * repo (checked) — this is a generic, honest app identifier per Nominatim's
 * policy rather than an invented contact. Update this string if/when a real
 * support address exists. */
const USER_AGENT =
  "Norr FSM/1.0 (Field Service Management SaaS; server-side client-address geocoding; no dedicated support contact configured yet)";

export interface GeocodableAddress {
  addressLine1: string;
  postalCode: string;
  city: string;
  country: string;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

function buildQuery(address: GeocodableAddress): string {
  const cityLine = `${address.postalCode} ${address.city}`.trim();
  return [address.addressLine1, cityLine, address.country]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

/**
 * Looks up a single best-match latitude/longitude for the given address via
 * Nominatim's `/search` endpoint (`format=json&limit=1`). Returns `null`
 * (never throws) on any failure or no-match — see module comment.
 */
export async function geocodeAddress(address: GeocodableAddress): Promise<GeocodeResult | null> {
  const query = buildQuery(address);
  if (!query) return null;

  let response: Response;
  try {
    response = await fetch(`${NOMINATIM_SEARCH_URL}?format=json&limit=1&q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": USER_AGENT },
      // One-off server-action call, not a route render — no reason to let
      // Next's data cache retain (or dedupe across unrelated requests) a
      // third-party geocode lookup.
      cache: "no-store",
    });
  } catch (error) {
    console.error(`[geocodeAddress] Nominatim request failed for query "${query}":`, error);
    return null;
  }

  if (!response.ok) {
    console.error(`[geocodeAddress] Nominatim returned HTTP ${response.status} for query "${query}"`);
    return null;
  }

  let results: unknown;
  try {
    results = await response.json();
  } catch (error) {
    console.error(`[geocodeAddress] Nominatim response was not valid JSON for query "${query}":`, error);
    return null;
  }

  if (!Array.isArray(results) || results.length === 0) return null;

  const first = results[0] as { lat?: unknown; lon?: unknown };
  const latitude = typeof first.lat === "string" ? Number.parseFloat(first.lat) : NaN;
  const longitude = typeof first.lon === "string" ? Number.parseFloat(first.lon) : NaN;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    console.error(`[geocodeAddress] Nominatim result had no usable lat/lon for query "${query}"`);
    return null;
  }

  return { latitude, longitude };
}
