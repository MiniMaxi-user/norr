import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TenantRole } from "@yourorg/rbac";

export interface CurrentEngineerOrganization {
  id: string;
  name: string;
  slug: string | null;
}

export interface CurrentEngineerSession {
  userId: string;
  email: string;
  fullName: string | null;
  role: TenantRole | null;
  organization: CurrentEngineerOrganization | null;
}

/**
 * Resolves the current request's session for the monteur-app — a trimmed
 * equivalent of the root app's `getCurrentSession`
 * (`lib/auth/session.ts`), same `users`/`memberships` query shape (oldest
 * membership first), but without `isPlatformAdmin`/`avatarUrl`/`locale` —
 * nothing here reads those fields yet, so they aren't carried over. Returns
 * `null` when signed out.
 *
 * Runs under the caller's own session via `lib/supabase/server.ts` (subject
 * to RLS) — never the service-role client.
 *
 * Wrapped in React's `cache()` like root's version, for the same reason: a
 * single request's render can call this from multiple places (layout +
 * page) without re-resolving the session/membership each time.
 */
export const getCurrentEngineerSession = cache(
  async (): Promise<CurrentEngineerSession | null> => resolveCurrentEngineerSession(),
);

async function resolveCurrentEngineerSession(): Promise<CurrentEngineerSession | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [profileResult, membershipResult] = await Promise.all([
    supabase.from("users").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("memberships")
      .select("role, organization:organizations(id, name, slug)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const membership = membershipResult.data as
    | { role: TenantRole; organization: CurrentEngineerOrganization | null }
    | null;

  const profile = profileResult.data as { full_name: string | null } | null;

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? null,
    organization: membership?.organization ?? null,
    role: membership?.role ?? null,
  };
}

/**
 * Same as `getCurrentEngineerSession`, but redirects to `/login` when signed
 * out OR when the resolved role isn't `engineer` — this is the seam
 * `app/(app)/layout.tsx` uses to gate the whole protected route group.
 *
 * The role check here is defense in depth on top of `logInAction`'s own
 * gate (`lib/auth/actions.ts`): a session that started as an engineer but
 * whose role changed mid-session (e.g. demoted/reassigned from the web app
 * while this app's session cookie is still valid), or any other edge case
 * that let a non-engineer session through, must not silently render
 * protected content.
 */
export async function requireEngineerSession(): Promise<CurrentEngineerSession> {
  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    redirect("/login");
  }
  return session;
}
