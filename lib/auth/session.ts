import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TenantRole } from "@/lib/rbac/permissions";
import { ensureOwnOrganizationBootstrapped } from "@/lib/auth/bootstrap";

export interface CurrentOrganization {
  id: string;
  name: string;
  slug: string | null;
}

export interface CurrentSession {
  userId: string;
  email: string;
  /** `users.is_platform_admin` — cross-tenant, never a tenant role. See
   * lib/rbac/permissions.ts `PermissionActor`. */
  isPlatformAdmin: boolean;
  /**
   * The signed-in user's first organization membership (ordered by
   * `created_at`), or `null` if they have none (e.g. a platform-admin-only
   * account with no tenant membership). There's no multi-org switcher yet
   * (not called for anywhere in docs/ARCHITECTURE.md for Phase 0) — a user
   * with more than one membership only ever sees their oldest one here.
   * Revisit this the moment an org switcher ships.
   */
  organization: CurrentOrganization | null;
  role: TenantRole | null;
}

/**
 * Resolves the current request's session, tenant role, and organization in
 * one place — the seam `app/(app)/layout.tsx`, server actions, and route
 * handlers should call instead of re-deriving it from `supabase.auth` +
 * `memberships` inline (issue #3/#4). Returns `null` when signed out.
 *
 * Runs under the caller's own session via `lib/supabase/server.ts` (subject
 * to RLS) — never the service-role client.
 */
export async function getCurrentSession(): Promise<CurrentSession | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const membershipQuery = () =>
    supabase
      .from("memberships")
      .select("role, organization:organizations(id, name, slug)")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

  const [profileResult, membershipResult] = await Promise.all([
    supabase.from("users").select("is_platform_admin").eq("id", user.id).maybeSingle(),
    membershipQuery(),
  ]);

  let membership = membershipResult.data as
    | { role: TenantRole; organization: { id: string; name: string; slug: string | null } | null }
    | null;

  // Self-healing fallback (see `ensureOwnOrganizationBootstrapped`'s own
  // comment for why this is needed here specifically, not just in
  // `logInAction`): a signed-in user with zero memberships gets one more
  // chance to bootstrap their own org right here, on every session
  // resolution, before we ever report them as org-less to a caller. Cheap
  // to call unconditionally once bootstrapped — it's a no-op single SELECT
  // after the first successful run.
  if (!membership) {
    await ensureOwnOrganizationBootstrapped(supabase, user.id);
    const retry = await membershipQuery();
    membership = retry.data as typeof membership;
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    isPlatformAdmin: (profileResult.data as { is_platform_admin: boolean } | null)?.is_platform_admin ?? false,
    organization: membership?.organization ?? null,
    role: membership?.role ?? null,
  };
}

/**
 * Same as `getCurrentSession`, but redirects unauthenticated requests to
 * `/login` — this is the seam `app/(app)/layout.tsx` uses to gate the whole
 * authenticated route group (issue #3). Nothing under `app/(app)` should
 * resolve the session any other way.
 */
export async function requireSession(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
