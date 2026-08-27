import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TenantRole } from "@/lib/rbac/permissions";
import { ensureOwnOrganizationBootstrapped } from "@/lib/auth/bootstrap";
import { getAvatarUrl } from "@/lib/profile/avatar-url";
import type { Locale } from "@/lib/profile/locale";

export interface CurrentOrganization {
  id: string;
  name: string;
  slug: string | null;
}

export interface CurrentSession {
  userId: string;
  email: string;
  /** `users.full_name` — same field `lib/members/format.ts`'s
   * `memberDisplayName` reads for every other member; `null` for an account
   * that hasn't set one. The topbar avatar/user menu falls back to `email`
   * (via that same helper) when this is `null`. */
  fullName: string | null;
  /** `users.is_platform_admin` — cross-tenant, never a tenant role. See
   * lib/rbac/permissions.ts `PermissionActor`. */
  isPlatformAdmin: boolean;
  /** Public URL for the signed-in user's profile photo (issue #49), derived
   * server-side from `users.avatar_path`/`avatar_updated_at` — `null` when
   * no photo has been uploaded. See `lib/profile/avatar-url.ts`. Identity-
   * level, not gated by `hasFeature()` — every authenticated user has one. */
  avatarUrl: string | null;
  /** `users.locale` — stored UI-language preference only; there is no
   * i18n/translation system in this app yet (see the migration's column
   * comment). Read by the profile panel's language select. */
  locale: Locale;
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
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

  const [profileResult, membershipResult] = await Promise.all([
    supabase
      .from("users")
      .select("is_platform_admin, full_name, avatar_path, avatar_updated_at, locale")
      .eq("id", user.id)
      .maybeSingle(),
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

  const profile = profileResult.data as {
    is_platform_admin: boolean;
    full_name: string | null;
    avatar_path: string | null;
    avatar_updated_at: string | null;
    locale: Locale;
  } | null;

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? null,
    isPlatformAdmin: profile?.is_platform_admin ?? false,
    avatarUrl: getAvatarUrl(profile?.avatar_path ?? null, profile?.avatar_updated_at ?? null),
    locale: profile?.locale ?? "nl",
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
