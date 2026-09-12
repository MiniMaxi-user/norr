import type { CookieOptions } from "@supabase/ssr";

/**
 * @supabase/ssr always forces `maxAge` on every cookie write it asks us to
 * perform: 400 days for a real "set" (login, token refresh), or `0` for a
 * removal (sign-out, stale-chunk cleanup) — see
 * `node_modules/@supabase/ssr/dist/main/cookies.js` (`setCookieOptions` /
 * `removeCookieOptions`). Passing `cookieOptions.maxAge` to
 * `createServerClient()` does not change this: the library re-applies its
 * own value last.
 *
 * To satisfy "stay logged in across reloads within one browser session, but
 * require login again after the browser is fully closed" (#111), the actual
 * auth cookies must be session cookies (no `Max-Age`/`Expires`). The only
 * place we control the options handed to the underlying cookie store is our
 * own `setAll` callback, so strip persistence there for real "set" writes
 * only — a positive `maxAge` — and leave removals (`maxAge === 0`) untouched
 * so sign-out/cleanup still deletes cookies immediately.
 *
 * Mirrored from the root app's `lib/supabase/cookie-options.ts` (apps/pwa is
 * a separate Next.js process talking to the same Supabase project, so it
 * needs its own copy of this plumbing rather than importing across apps).
 */
export function toSessionCookieOptions(options: CookieOptions): CookieOptions {
  if (typeof options.maxAge === "number" && options.maxAge > 0) {
    const { maxAge, expires, ...rest } = options;
    return rest;
  }

  return options;
}
