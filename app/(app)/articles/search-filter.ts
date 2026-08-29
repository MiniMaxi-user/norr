/**
 * Plain (non-`"use server"`) helper module — deliberately NOT in `actions.ts`.
 * Next.js requires every top-level export of a `"use server"` file to be an
 * async Server Action; `buildArticleSearchFilter` is a synchronous pure
 * string-builder, so it has to live outside that file (this broke the
 * production build: "Server Actions must be async functions"). Same
 * colocated-plain-helper pattern as `app/(app)/clients/format-site-address.ts`.
 */

/**
 * Turns a user-supplied search term into a safe PostgREST `.or()` filter
 * string across `article_number`/`description`/`ean`/`gtin`/`mpn`. Exported
 * so issue #95's quote/line-item article picker can reuse this exact search
 * shape rather than reimplementing it.
 *
 * Escapes the user's own `%`/`_` (SQL `LIKE` wildcards) so a literal percent
 * sign in a search term doesn't act as a wildcard, then wraps the resulting
 * pattern in double quotes — PostgREST's `.or()` filter syntax requires
 * quoting any value that itself contains a comma or parenthesis (both of
 * which are structural characters in that mini-language), and a user-typed
 * search term can legitimately contain either.
 */
export function buildArticleSearchFilter(term: string): string {
  const escapedWildcards = term.replace(/[%_]/g, (match) => `\\${match}`);
  const escapedQuotes = escapedWildcards.replace(/"/g, '\\"');
  const pattern = `"%${escapedQuotes}%"`;
  return ["article_number", "description", "ean", "gtin", "mpn"].map((column) => `${column}.ilike.${pattern}`).join(",");
}
