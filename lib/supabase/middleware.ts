import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every request that passes through
 * middleware.ts. This keeps Server Component reads of the session fresh
 * without each one needing to handle token refresh itself.
 *
 * Auth gating/redirects (e.g. "no session -> /login") are intentionally NOT
 * implemented here — that belongs to auth-rbac-engineer's auth flow work.
 * This scaffold only wires up the session-refresh plumbing.
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
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Touch the session so expired tokens get refreshed and the new cookies
  // are attached to supabaseResponse above.
  await supabase.auth.getUser();

  return supabaseResponse;
}
