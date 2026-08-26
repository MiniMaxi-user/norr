import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TenantRole } from "@/lib/rbac/permissions";

/**
 * Shared bootstrap pattern (docs/ARCHITECTURE.md): create an organization
 * and self-insert the caller as its `owner`, both under the caller's own
 * session — relying on the RLS policy that allows a self-owner-insert only
 * while the org has zero members. No-ops (returns `{}` without inserting
 * anything) if the caller already has any membership, so it's safe to call
 * unconditionally rather than requiring callers to track "did this already
 * happen".
 *
 * Deliberately NOT in `lib/auth/actions.ts` (a `"use server"` Server Actions
 * file): this takes a live Supabase client as an argument, which isn't a
 * valid Server Action parameter, and — more importantly — it needs to be
 * callable from `lib/auth/session.ts` too (see `getCurrentSession`), not
 * just from the two auth actions that used to be its only callers.
 *
 * Callers today:
 *  - `signUpAction` (lib/auth/actions.ts), immediately, when `signUp()`
 *    returns a session in the same request (true when the project's Auth
 *    settings have email confirmation OFF).
 *  - `logInAction` (lib/auth/actions.ts), on the first successful login
 *    after a signup that required email confirmation — `signUp()` returns
 *    no session in that case, so nothing can be inserted yet; the
 *    organization name the user typed on the signup form is preserved via
 *    `options.data.organization_name` (Supabase user metadata) specifically
 *    so it survives until then.
 *  - `getCurrentSession` (lib/auth/session.ts), as a fallback safety net for
 *    every authenticated page load. This exists because Supabase's browser
 *    client can establish a session directly from the tokens/code in an
 *    email confirmation link's redirect (`detectSessionInUrl`), entirely
 *    bypassing `logInAction` — a real gap found live: a user who never
 *    explicitly submits the login form ends up signed in with zero
 *    memberships, and the sidebar/nav then shows every module as
 *    unavailable (`hasFeature()` returns false for a null organization).
 *    Calling this here means ANY authenticated request with no organization
 *    self-heals on its very next page load, regardless of which path
 *    established the session.
 *
 * The "do I already have a membership" existence check below deliberately
 * uses the SERVICE-ROLE client (`lib/supabase/admin.ts`), not the caller's
 * own RLS-scoped `supabase` client that's passed in for everything else
 * here — a real bug found in review of issue #47's tenant-deactivation
 * feature. `supabase/migrations/20260826120000_organizations_is_active.sql`
 * made `memberships_select_self_or_same_org`'s "see your own row" branch
 * also require the row's own organization to be `is_active`, so under RLS a
 * user whose only membership is for a just-deactivated org now reads back
 * zero membership rows — indistinguishable, under the caller's own session,
 * from a user who genuinely has none. Left unfixed, this function would
 * treat "my org was deactivated" as "I've never had an org" and silently
 * bootstrap a brand-new, active, empty organization for that user on their
 * very next page load (this function is called from `getCurrentSession` on
 * every request) — completely defeating the login gate for anyone with an
 * already-open session. The service-role client sidesteps that ambiguity by
 * seeing the real row regardless of `is_active`, mirroring the identical fix
 * `logInAction` (`lib/auth/actions.ts`) already needed for this exact
 * scenario at login time. Everything AFTER this check (the actual org/
 * membership INSERTs) deliberately keeps using the caller's own RLS-scoped
 * `supabase` client — that's not incidental, it's what lets those inserts
 * rely on `memberships_insert_bootstrap_or_owner`'s "only while the org has
 * zero members" guard as a real security backstop, not just an application-
 * level check.
 */
export async function ensureOwnOrganizationBootstrapped(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  organizationNameHint?: string,
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: existingMemberships } = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  if (existingMemberships && existingMemberships.length > 0) {
    return {};
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const metadataName =
    typeof user?.user_metadata?.organization_name === "string"
      ? user.user_metadata.organization_name.trim()
      : "";
  const emailLocalPart = (user?.email ?? "").split("@")[0];
  const organizationName =
    organizationNameHint?.trim() || metadataName || `${emailLocalPart || "New"}'s organization`;

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .insert({ name: organizationName, created_by: userId })
    .select("id")
    .single();

  if (organizationError || !organization) {
    return { error: organizationError?.message ?? "Could not create organization." };
  }

  const { error: membershipError } = await supabase.from("memberships").insert({
    user_id: userId,
    organization_id: organization.id,
    role: "owner" satisfies TenantRole,
  });

  return membershipError ? { error: membershipError.message } : {};
}
