"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTenantRole, TENANT_ROLES } from "@/lib/rbac/permissions";
import { ensureOwnOrganizationBootstrapped } from "@/lib/auth/bootstrap";

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
  // Used to build the `emailRedirectTo` link Supabase puts in
  // confirmation/invite emails. Preference order:
  //  1. NEXT_PUBLIC_SITE_URL — set explicitly in Vercel for Production only
  //     (the stable custom/production domain), so confirmation emails sent
  //     from a production signup always point at the production URL even
  //     though VERCEL_URL would also technically resolve there.
  //  2. VERCEL_URL — auto-injected by Vercel on every deployment (including
  //     previews), so a signup on a PR preview redirects back to that same
  //     preview instead of production or localhost. Not NEXT_PUBLIC_-
  //     prefixed because it's only ever read here, server-side.
  //  3. localhost — local dev.
  // Whatever this resolves to MUST be present in Supabase Auth's redirect
  // URL allow-list (dashboard, or the `additional_redirect_urls` project
  // config) or `signUp`'s `emailRedirectTo` will be silently ignored.
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function readRedirectTarget(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  // Guard against open-redirect: only ever follow a same-site relative path.
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
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

  // Deactivated-tenant login gate (issue #47, stage 2). See
  // `supabase/migrations/20260826120000_organizations_is_active.sql` for the
  // RLS half this backs up: once `organizations.is_active = false`,
  // `is_member_of_org`/`is_org_owner` already make that org's data
  // invisible/unwritable, but a still-valid session/JWT would otherwise let
  // the user reach this app's shell and sit on a "not a member of any
  // organization" error rather than being told plainly that their account
  // was deactivated. This check closes that gap by refusing the login
  // outright.
  //
  // Deliberately uses the SERVICE-ROLE client (`lib/supabase/admin.ts`), not
  // the caller's own just-established session client, for this one lookup:
  // as of this migration, RLS on `memberships` (`memberships_select_self_or_
  // same_org`) requires the target organization to be active even for the
  // "see your own row" branch, so under the caller's own session there is no
  // way to distinguish "this user has no membership at all" from "this
  // user's only membership is for a deactivated org" — both read back as
  // zero rows. Only a query that bypasses RLS can tell them apart, which is
  // exactly what's needed here. This mirrors `getCurrentSession`'s own
  // membership-lookup shape (`memberships` joined to `organizations`,
  // oldest-first, `limit(1)`) so "the org this check looks at" and "the org
  // `getCurrentSession` would have resolved after login" are always the same
  // one — just run here via `createAdminClient()` instead of the session
  // client, and only ever used to read `organizations.is_active`, nothing
  // else.
  //
  // Runs before `ensureOwnOrganizationBootstrapped` below (an inactive-org
  // user must never trigger a bootstrap side effect) and unconditionally,
  // regardless of `next` — a user redeeming an invite
  // (`next.startsWith("/invite/")`) has zero memberships yet by definition
  // (the invite hasn't been redeemed), so `membership` below naturally comes
  // back `null` for them and this check is a no-op, exactly like every other
  // brand-new/platform-admin-only account with no tenant membership.
  if (data.user) {
    const admin = createAdminClient();
    const { data: membership } = await admin
      .from("memberships")
      .select("organization:organizations(is_active)")
      .eq("user_id", data.user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const organization = membership?.organization as { is_active: boolean } | null | undefined;
    if (organization && organization.is_active === false) {
      // Invalidate the session `signInWithPassword` just established above —
      // otherwise the browser would be left holding a live, valid session
      // cookie for an account we're about to tell the user is deactivated.
      await supabase.auth.signOut();
      return { error: "This account has been deactivated. Contact your administrator." };
    }
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
