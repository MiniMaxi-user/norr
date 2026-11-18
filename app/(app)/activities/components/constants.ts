/** `setLastUsedView`/`preferencesStore` key for the Activity detail page's
 * tab — its own tiny module (not exported from `activity-screen.tsx`, a
 * "use client" file) so the server page and the client screen share the
 * literal. */
export const ACTIVITY_DETAIL_VIEW_KEY = "activities-detail";
