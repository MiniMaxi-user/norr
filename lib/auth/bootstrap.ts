import "server-only";

import { createClient } from "@/lib/supabase/server";
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
 */
export async function ensureOwnOrganizationBootstrapped(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  organizationNameHint?: string,
): Promise<{ error?: string }> {
  const { data: existingMemberships } = await supabase
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
