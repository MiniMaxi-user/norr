import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { toSessionCookieOptions } from "@/lib/supabase/cookie-options";

/**
 * Refreshes the Supabase auth session on every request that passes through
 * middleware.ts. This keeps Server Component reads of the session fresh
 * without each one needing to handle token refresh itself.
 *
 * Mirrored from the root app's `lib/supabase/middleware.ts` (see that file
 * for the full `getClaims()` vs `getUser()` rationale — unchanged here).
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
  // token is verified locally instead (see doc comment in the root app's
  // equivalent file).
  await supabase.auth.getClaims();

  return supabaseResponse;
}
