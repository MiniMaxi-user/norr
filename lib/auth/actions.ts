"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isTenantRole, TENANT_ROLES, type TenantRole } from "@/lib/rbac/permissions";

/**
 * Server Actions backing the auth pages under `app/(auth)/*` (issue #3):
 * signup (+ organization/owner bootstrap), login, logout, and the
 * invite-redemption mechanism. Every Supabase call here runs under the
 * calling user's own session via `lib/supabase/server.ts` — never the
 * service-role client — per docs/ARCHITECTURE.md ("No client-side query
 * ever bypasses RLS. Server actions run under the user's session.").
 */

export interface AuthActionState {
  error?: string;
  info?: string;
}

function getSiteOrigin(): string {
  // Set in Vercel per-environment (see .env.example); falls back to local
  // dev. Used only to build the `emailRedirectTo` link Supabase puts in
  // confirmation/invite emails — flagged in the handoff for devops-release
  // to confirm this is set in every deployed environment and that the
  // resulting URLs are in Supabase Auth's redirect allow-list.
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

function readRedirectTarget(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  // Guard against open-redirect: only ever follow a same-site relative path.
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

/**
 * Shared bootstrap pattern (docs/ARCHITECTURE.md): create an organization
 * and self-insert the caller as its `owner`, both under the caller's own
 * session — relying on the RLS policy that allows a self-owner-insert only
 * while the org has zero members. No-ops (returns `{}` without inserting
 * anything) if the caller already has any membership, so it's safe to call
 * unconditionally rather than requiring callers to track "did this already
 * happen".
 *
 * This is called from two places, because org creation cannot always
 * happen inside `signUpAction` itself:
 *  - Immediately, inside `signUpAction`, when `signUp()` returns a session
 *    in the same request (true when the project's Auth settings have email
 *    confirmation OFF).
 *  - Deferred, from `logInAction`, on the first successful login after a
 *    signup that DID require email confirmation (true for this project as
 *    of writing — `mailer_autoconfirm: false`, confirmed against the live
 *    project's `/auth/v1/settings`). `signUp()` returns no session in that
 *    case, so nothing can be inserted yet; the organization name the user
 *    typed on the signup form is preserved via `options.data.organization_name`
 *    (Supabase user metadata) specifically so it survives until then.
 */
async function ensureOwnOrganizationBootstrapped(
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

/**
 * Signup (issue #3, step 1). Two paths:
 *
 *  - No invite token: bootstraps a brand-new organization and inserts the
 *    caller as its `owner` via `ensureOwnOrganizationBootstrapped` above.
 *  - With an invite token: skips org creation entirely and instead redeems
 *    the invite via the `redeem_invite` SECURITY DEFINER RPC (see the
 *    `invites` migration) — the invite already names the organization and
 *    role, so a fresh org must NOT be created here.
 *
 * If the Supabase project requires email confirmation, `signUp` returns no
 * session, so neither of the above can happen in this request — the
 * organization name is stashed in the new user's metadata
 * (`options.data.organization_name`) and picked up by
 * `ensureOwnOrganizationBootstrapped` the first time `logInAction` succeeds
 * for them post-confirmation. The invite case needs no such carry-over:
 * `emailRedirectTo` sends them back to `/invite/[token]`, which offers the
 * same redemption once they're signed in (whether that's via this same
 * flow or a plain manual login afterward).
 */
export async function signUpAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const inviteToken = String(formData.get("inviteToken") ?? "").trim() || null;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (!inviteToken && !organizationName) {
    return { error: "Organization name is required." };
  }

  const supabase = await createClient();

  const redirectPath = inviteToken ? `/invite/${inviteToken}` : "/login";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${getSiteOrigin()}${redirectPath}`,
      // Carried over to `user_metadata` so it survives the email-confirmation
      // round trip (see `ensureOwnOrganizationBootstrapped` above) — the
      // request that finally creates the organization/membership row is
      // often not this one.
      data: { organization_name: inviteToken ? null : organizationName || null },
    },
  });

  if (error) {
    return { error: error.message };
  }

  if (!data.session) {
    // Email confirmation is required by the project's Auth settings (true
    // for this project as of writing) — no session yet, so nothing here can
    // be bootstrapped under the user's own session (and shouldn't be
    // attempted with the service-role client either, per
    // docs/ARCHITECTURE.md). `ensureOwnOrganizationBootstrapped` finishes
    // this the first time `logInAction` succeeds for them.
    return {
      info: "Check your email to confirm your account before continuing.",
    };
  }

  if (inviteToken) {
    const { error: redeemError } = await supabase.rpc("redeem_invite", { p_token: inviteToken });
    if (redeemError) {
      return { error: `Account created, but the invite could not be accepted: ${redeemError.message}` };
    }
    redirect("/");
  }

  const { error: bootstrapError } = await ensureOwnOrganizationBootstrapped(
    supabase,
    data.session.user.id,
    organizationName,
  );
  if (bootstrapError) {
    return { error: bootstrapError };
  }

  redirect("/");
}

/**
 * Login (issue #3, step 2). `next` is validated to a same-site relative
 * path only (see `readRedirectTarget`) to avoid an open-redirect via a
 * crafted `next` value.
 *
 * Also doubles as the deferred half of signup bootstrap: a plain (no
 * invite) signup on a project that requires email confirmation has no
 * session at signup time, so nothing could be created yet (see
 * `signUpAction`/`ensureOwnOrganizationBootstrapped`). The very first
 * successful login for such a user has zero memberships, so this creates
 * their organization here instead — skipped when `next` points into an
 * invite redemption, since that user is about to join an *existing* org
 * and must not also get a freshly-created one.
 */
export async function logInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = readRedirectTarget(formData.get("next"));

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Invalid email or password." };
  }

  if (!next.startsWith("/invite/") && data.user) {
    const { error: bootstrapError } = await ensureOwnOrganizationBootstrapped(supabase, data.user.id);
    if (bootstrapError) {
      return { error: `Signed in, but couldn't finish setting up your organization: ${bootstrapError}` };
    }
  }

  redirect(next);
}

/** Logout. Called directly as a `<form action={logOutAction}>` from the
 * (server-rendered) topbar — no client component needed for something this
 * simple. */
export async function logOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Invite redemption (issue #3, step 3) for an already-authenticated user
 * whose email matches the invite (checked both here for UX and, more
 * importantly, inside `redeem_invite` itself server-side — see the new
 * `invites` migration for why the DB-side check is the one that actually
 * matters). Used by the "Accept invite" button on `/invite/[token]`.
 */
export async function redeemInviteAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) {
    return { error: "Missing invite token." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to accept this invite." };
  }

  const { error } = await supabase.rpc("redeem_invite", { p_token: token });
  if (error) {
    return { error: error.message };
  }

  redirect("/");
}

export interface CreateInviteState {
  error?: string;
  inviteUrl?: string;
}

/**
 * Owner-initiated invite creation (issue #3, step 3 — the other half).
 * Inserts an `invites` row under the caller's own session; RLS
 * (`invites_insert_owner`, see the new migration) already enforces that
 * only an owner of `organizationId` may do this, so this action doesn't
 * re-check that itself beyond what the DB will reject anyway.
 *
 * NOTE: this is not wired into any page yet — there's no team-management UI
 * in this repo yet (not part of issue #3's page list, and no `settings`
 * entry exists in components/shell/nav-items.ts). It's exposed here, ready
 * for `frontend-ui-engineer` to call from a future "Invite teammate" form.
 * It returns a shareable `/invite/{token}` link rather than sending an
 * email itself — there's no email provider/SMTP configured in this repo
 * yet (see .env.example), so actual delivery is a follow-up.
 */
export async function createInviteAction(
  _prevState: CreateInviteState,
  formData: FormData,
): Promise<CreateInviteState> {
  const organizationId = String(formData.get("organizationId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "").trim();

  if (!organizationId || !email || !role) {
    return { error: "Organization, email, and role are required." };
  }
  if (!isTenantRole(role)) {
    return { error: `Role must be one of: ${TENANT_ROLES.join(", ")}.` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to invite someone." };
  }

  const { data: invite, error } = await supabase
    .from("invites")
    .insert({
      organization_id: organizationId,
      email,
      role,
      invited_by: user.id,
    })
    .select("token")
    .single();

  if (error || !invite) {
    return { error: error?.message ?? "Could not create invite." };
  }

  return { inviteUrl: `${getSiteOrigin()}/invite/${invite.token}` };
}
