import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in Client Components ("use client").
 *
 * This client runs under the browser session (anon key) and is subject to
 * RLS like any other authenticated/anon request — it must never be used to
 * bypass tenant isolation. See docs/ARCHITECTURE.md ("No client-side query
 * ever bypasses RLS").
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
