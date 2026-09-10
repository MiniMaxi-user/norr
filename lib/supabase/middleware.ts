import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { toSessionCookieOptions } from "@/lib/supabase/cookie-options";

/**
 * Refreshes the Supabase auth session on every request that passes through
 * middleware.ts. This keeps Server Component reads of the session fresh
 * without each one needing to handle token refresh itself.
 *
 * Auth gating/redirects (e.g. "no session -> /login") are intentionally NOT
 * implemented here — that belongs to auth-rbac-engineer's auth flow work.
 * This scaffold only wires up the session-refresh plumbing.
 *
 * Uses `getClaims()` rather than `getUser()` (issue #143 — performance
 * finding on #139): the middleware `matcher` in `middleware.ts` covers
 * essentially every request, including RSC payload fetches and `Link`
 * prefetches, so this ran on every single one of them. `getUser()` always
 * makes an HTTPS round-trip to Supabase Auth; `getClaims()` verifies the
 * JWT locally against the project's cached JSON Web Key Set instead — this
 * project already signs with an asymmetric key (ES256, confirmed via its
 * `/auth/v1/.well-known/jwks.json`), so that's a real local-verification
 * path, not the symmetric-secret fallback that would silently degrade back
 * to a `getUser()`-equivalent network call every time. Per
 * `GoTrueClient.getClaims()`'s own doc comment, a token that's about to
 * expire is still refreshed first (a network call, same as before) — this
 * only removes the round-trip for the common case of an already-valid
 * token, and that refresh still flows through the `setAll` cookie handler
 * below exactly like a `getUser()`-triggered refresh did.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(
              name,
              value,
              toSessionCookieOptions(options),
            );
          }
        },
      },
    },
  );

  // Touch the session so expired/about-to-expire tokens get refreshed and
  // the new cookies are attached to supabaseResponse above; a still-valid
  // token is verified locally instead (see doc comment above).
  await supabase.auth.getClaims();

  return supabaseResponse;
}
