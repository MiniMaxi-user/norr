"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TenantRole } from "@yourorg/rbac";

/**
 * Server Actions backing the monteur-app's login (issue #168). Deliberately
 * much narrower than the root web app's `lib/auth/actions.ts`:
 *
 *  - No signup/invite flow at all — every engineer account already exists,
 *    created via the root app's existing invite flow. This app is
 *    login-only.
 *  - No `ensureOwnOrganizationBootstrapped` — that's a root-app-only concept
 *    (a fresh signup bootstrapping its own organization), meaningless here
 *    since every user signing in is pre-existing with an established
 *    membership.
 *  - No `next` redirect target — there is exactly one place to land after a
 *    successful login: `/today`.
 *  - An additional role gate on top of root's deactivated-org check: this
 *    app is engineer-only. See `logInAction` below for the exact ordering
 *    and copy.
 */

export interface AuthActionState {
  error?: string;
}

/**
 * Login. Mirrors the root app's `logInAction` (`lib/auth/actions.ts`) for
 * the invalid-credentials and deactivated-organization checks, but adds a
 * role gate: this app must only ever admit `engineer`-role members. That's a
 * real security boundary (defense in depth alongside RLS/`@yourorg/rbac`),
 * not just a UX nicety — a planner/owner/finance/administratie account must
 * never reach past this gate.
 */
export async function logInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Invalid email or password." };
  }

  if (!data.user) {
    return { error: "Invalid email or password." };
  }

  // Deactivated-tenant + role gate. Deliberately uses the SERVICE-ROLE
  // client (`lib/supabase/admin.ts`), not the caller's own just-established
  // session client, for this lookup — mirrors the root app's `logInAction`
  // reasoning exactly: under RLS, "no membership at all" and "membership
  // belongs to a deactivated org" both read back as zero rows, and only a
  // query that bypasses RLS can tell them apart. Selects `role` too (unlike
  // root's version) since that's this app's own extra gate.
  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("memberships")
    .select("role, organization:organizations(is_active)")
    .eq("user_id", data.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const typedMembership = membership as
    | { role: TenantRole; organization: { is_active: boolean } | null }
    | null;

  if (!typedMembership) {
    await supabase.auth.signOut();
    return { error: "This account does not have access to the engineer app." };
  }

  if (typedMembership.organization && typedMembership.organization.is_active === false) {
    await supabase.auth.signOut();
    return { error: "This account has been deactivated. Contact your administrator." };
  }

  if (typedMembership.role !== "engineer") {
    await supabase.auth.signOut();
    return { error: "This app is for engineers only. Log in on the norr web app." };
  }

  redirect("/today");
}

/** Logout. Called directly as a `<form action={logOutAction}>`. */
export async function logOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
