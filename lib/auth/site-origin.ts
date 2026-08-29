import { headers } from "next/headers";

/**
 * Used to build the `emailRedirectTo` link Supabase puts in
 * confirmation/invite emails, and every shareable invite link shown in the
 * UI (`lib/auth/actions.ts`'s `createInviteAction`,
 * `app/(app)/clients/platform-access-actions.ts`'s platform-admin invite
 * action). Reads the actual incoming request's own `Host` header first, so
 * the link always matches whatever domain the caller is really browsing on
 * right now (the production custom domain, a PR preview, or localhost) — a
 * fixed env var can silently point at a stale/renamed Vercel project URL
 * even while the user is correctly on the production custom domain (issue
 * #69: browsing norr.software produced an invite link pointing at an old
 * norr-steel.vercel.app deployment URL).
 *
 * A plain (non-"use server") module deliberately — this is imported by two
 * separate `"use server"` files, and a `"use server"` file may only export
 * async functions, so this couldn't live inside either of them and still be
 * shared instead of duplicated.
 */
export async function getSiteOrigin(): Promise<string> {
  const host = (await headers()).get("host");
  if (host) {
    const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
    return `${protocol}://${host}`;
  }
  // Fallback chain below only matters if this ever runs with no `Host`
  // header available (shouldn't happen for any caller today, all of which
  // run as Server Actions submitted from a real page request):
  //  1. NEXT_PUBLIC_SITE_URL — set explicitly in Vercel for Production only.
  //  2. VERCEL_URL — auto-injected by Vercel on every deployment.
  //  3. localhost — local dev.
  // Whatever this resolves to MUST be present in Supabase Auth's redirect
  // URL allow-list (dashboard, or the `additional_redirect_urls` project
  // config) or `signUp`'s `emailRedirectTo` will be silently ignored.
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
