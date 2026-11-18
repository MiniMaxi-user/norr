/** `setLastUsedView`/`preferencesStore` key for the Work order detail page's
 * tab — its own tiny module (not exported from `work-order-screen.tsx`, a
 * "use client" file) so the server page and the client screen share the
 * literal. */
export const WORK_ORDER_DETAIL_VIEW_KEY = "work-orders-detail";
