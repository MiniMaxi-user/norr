import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for use in Server Components, Server Actions, and Route
 * Handlers. Runs under the requesting user's session (anon key + cookies),
 * so it is subject to RLS the same way the browser client is — this is the
 * client server-side code should use for tenant-scoped reads/writes.
 *
 * Do NOT use this for cross-tenant/service-role access; see admin.ts.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component that can't set cookies (no
            // response to attach to). Safe to ignore as long as
            // middleware.ts is refreshing the session on every request.
          }
        },
      },
    },
  );
}
