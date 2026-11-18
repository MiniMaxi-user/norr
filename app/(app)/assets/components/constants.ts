/** `setLastUsedView`/`preferencesStore` key for the Asset detail page's tab —
 * its own tiny module (not exported from `asset-screen.tsx`, a "use client"
 * file) so the server loader and the client screen share the literal. */
export const ASSET_DETAIL_VIEW_KEY = "assets-detail";
