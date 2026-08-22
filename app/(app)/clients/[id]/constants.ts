/** `setLastUsedView`/`preferencesStore` moduleKey for the Clients detail
 * page's Sites/Assets tab (see `client-detail.tsx` and `page.tsx`) — pulled
 * into its own tiny module so the two files can't drift out of sync on the
 * literal string. Not a top-level nav module (see `components/shell/nav-
 * items.ts`), just reusing the same generic "remember the last view a user
 * picked" seam for a page-level tab instead of a module-level view switcher. */
export const CLIENT_DETAIL_VIEW_KEY = "clients-detail";
