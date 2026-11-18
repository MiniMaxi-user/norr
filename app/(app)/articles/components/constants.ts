/** `setLastUsedView`/`preferencesStore` key for the Article detail page's tab —
 * its own tiny module (not exported from `article-screen.tsx`, a "use client"
 * file) so the server loader and the client screen share the literal. */
export const ARTICLE_DETAIL_VIEW_KEY = "articles-detail";
