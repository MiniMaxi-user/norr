"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import type { CurrentSession } from "@/lib/auth/session";

/**
 * Server Actions for a Platform Admin managing a tenant's login access
 * (issue #45, stage 2) — siblings of `activateAsTenant`
 * (`app/(app)/clients/actions.ts`), not a modification of it, and siblings
 * of `createInviteAction`/`redeemInviteAction` (`lib/auth/actions.ts`), not
 * a modification of those either.
 *
 * Why this file exists separately from `lib/auth/actions.ts`'s
 * `createInviteAction`: a platform admin is never a real member of the
 * tenant organization they're managing — they're only `owner` of their own
 * dedicated "Platform" org. `invites_insert_owner` and
 * `memberships_insert_bootstrap_or_owner` (see
 * `supabase/migrations/20260822180000_invites.sql` and the baseline
 * migration) both require `is_org_owner(organization_id)` against the
 * TARGET org, which a platform admin structurally never satisfies for
 * someone else's tenant. So every action here that touches the target
 * tenant org's `invites`/`memberships`/`auth.users` uses the SERVICE-ROLE
 * client (`lib/supabase/admin.ts`, bypasses RLS) instead — which is exactly
 * the "audited platform-admin cross-tenant write, checked in application
 * code, not an RLS bypass policy" case docs/ARCHITECTURE.md describes for
 * `lib/supabase/admin.ts`. Every action below independently re-verifies
 * `session.isPlatformAdmin` before doing anything with that client, since
 * RLS is no longer the backstop for these specific calls.
 *
 * The Client row itself, though, is always read through the CALLER's own
 * session client (`lib/supabase/server.ts`) — the platform admin can only
 * ever act on a Client row their own "Platform" org can already see under
 * ordinary RLS, and `represents_organization_id` (never a client-supplied
 * `organizationId`) is what derives which tenant org these actions are
 * allowed to touch. This is also why `getClient`'s existing RLS-scoped read
 * is reused rather than trusting anything the caller passes in directly.
 */

const uuidSchema = z.string().uuid("Invalid client id.");

/** Same validation shape as `contactCreateSchema.email` in `./schema.ts`
 * (trim + valid email format + 320 char max, the practical RFC 5321 limit),
 * but required rather than optional/preprocessed — every action in this
 * file needs a concrete email to invite or reset, never "not provided". */
const tenantOwnerEmailSchema = z.string().trim().email("Invalid email address.").max(320);

/** Mirrors `lib/auth/actions.ts`'s private (unexported) `getSiteOrigin` —
 * duplicated rather than imported because a `"use server"` file may only
 * export async functions, so that helper can't be shared as-is without
 * pulling it into a new non-"use server" module, which is out of scope
 * here. Keep in sync if the redirect-origin resolution logic there ever
 * changes. */
function getSiteOrigin(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

interface ActivatedTenantContext {
  session: CurrentSession;
  tenantOrganizationId: string;
}

/**
 * Shared preamble for every action below:
 *  1. `requireModuleContext("clients")` — the platform admin must still be a
 *     real member of *some* org (their own "Platform" org) with the
 *     `clients` feature enabled, same as any other caller of this module.
 *  2. An explicit `session.isPlatformAdmin` check — deliberately not
 *     `can()`/the RBAC matrix, since Platform Admin is not a `TenantRole`
 *     (see `activateAsTenant`'s own comment on this in `./actions.ts`).
 *  3. Looks up the Client row via the CALLER's own session client (RLS-
 *     scoped — a plain read of a row the platform admin's org can already
 *     see) and requires it to already be linked to a real tenant org
 *     (`represents_organization_id`) — every action in this file operates
 *     on an activated tenant, never a plain CRM client.
 */
async function requireActivatedTenantContext(
  clientId: string,
): Promise<{ ok: true; value: ActivatedTenantContext } | { ok: false; error: string }> {
  const ctx = await requireModuleContext("clients");
  if (!ctx.ok) return { ok: false, error: ctx.error };

  if (!ctx.context.session.isPlatformAdmin) {
    return { ok: false, error: "Only a platform admin can manage tenant access." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: client, error } = await supabase
    .from("clients")
    .select("represents_organization_id")
    .eq("id", clientId)
    .maybeSingle();

  if (error) return { ok: false, error: mapDbError(error) };
  if (!client) return { ok: false, error: "Client not found." };
  if (!client.represents_organization_id) {
    return { ok: false, error: "This client has not been activated as a tenant yet." };
  }

  return {
    ok: true,
    value: {
      session: ctx.context.session,
      tenantOrganizationId: client.represents_organization_id as string,
    },
  };
}

/**
 * Inserts a fresh `owner` invite into the target tenant org via the
 * SERVICE-ROLE client, mirroring `createInviteAction`'s insert shape
 * exactly (`lib/auth/actions.ts`) — same columns, same returned
 * `{ inviteUrl }` shape (a copyable `/invite/[token]` link, since this repo
 * has no SMTP/email provider configured — see that action's own doc
 * comment) — just written by `admin` instead of the caller's session client,
 * and with `organization_id` always the tenant org resolved server-side by
 * `requireActivatedTenantContext`, never a client-supplied value.
 */
async function insertTenantInvite(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  email: string,
  invitedBy: string,
): Promise<ActionResult<{ inviteUrl: string }>> {
  const { data: invite, error } = await admin
    .from("invites")
    .insert({
      organization_id: organizationId,
      email,
      role: "owner",
      invited_by: invitedBy,
    })
    .select("token")
    .single();

  if (error) {
    // 23505 here is `invites_pending_org_email_idx` (one pending invite per
    // org+email at a time — see the invites migration) — surfaced as a
    // clean message rather than the raw constraint-name error `mapDbError`
    // would otherwise fall through to (its switch has no case for 23505).
    if (error.code === "23505") {
      return fail("An invitation is already pending for this email.");
    }
    return fail(mapDbError(error));
  }

  return ok({ inviteUrl: `${getSiteOrigin()}/invite/${invite.token}` });
}

function emailFieldError(error: z.ZodError): Record<string, string[]> {
  return { email: [error.issues[0]?.message ?? "Invalid email address."] };
}

/**
 * Sends the first invite for a contact of an activated tenant client,
 * inviting them as `owner` of the tenant org the client represents. See
 * this file's header comment for why the SERVICE-ROLE client is required
 * here (a platform admin is never a member of the target tenant org).
 */
export async function inviteTenantOwner(
  clientId: string,
  email: string,
): Promise<ActionResult<{ inviteUrl: string }>> {
  const idResult = uuidSchema.safeParse(clientId);
  if (!idResult.success) return fail("Invalid client id.");

  const emailResult = tenantOwnerEmailSchema.safeParse(email);
  if (!emailResult.success) {
    return fail("Please fix the highlighted fields.", emailFieldError(emailResult.error));
  }
  const normalizedEmail = emailResult.data.toLowerCase();

  const tenantCtx = await requireActivatedTenantContext(idResult.data);
  if (!tenantCtx.ok) return fail(tenantCtx.error);
  const { session, tenantOrganizationId } = tenantCtx.value;

  // Service-role: see this file's header comment — the platform admin's own
  // session can never satisfy `invites_insert_owner`'s `is_org_owner(...)`
  // check against the TARGET tenant org.
  const admin = createAdminClient();
  return insertTenantInvite(admin, tenantOrganizationId, normalizedEmail, session.userId);
}

export interface TenantAccessResendResult {
  /** "invited" when a pending invite was (re)sent — see `inviteUrl`.
   * "reset" when a real password-reset link was generated for an already-
   * accepted member — see `actionLink`. */
  mode: "invited" | "reset";
  inviteUrl?: string;
  actionLink?: string;
}

/**
 * The single action behind the "Reset password" button, which does double
 * duty per the story:
 *  - a still-PENDING invite is resent (deleted + recreated — the invites
 *    table's own documented mechanism, see the migration's comment on
 *    `invites_pending_org_email_idx`);
 *  - an already-ACCEPTED member (a real `memberships` row exists) instead
 *    gets a freshly generated password-recovery link via the Supabase Admin
 *    API, returned for the platform admin to copy and send manually (no
 *    outbound email configured in this repo — see `insertTenantInvite`'s
 *    comment / `createInviteAction`'s own doc comment for the same
 *    reasoning);
 *  - neither exists yet (e.g. clicked before any invite was ever sent) falls
 *    back to sending a first invite, so this one action is safe to call any
 *    time once the client is activated as a tenant.
 */
export async function resendOrResetTenantAccess(
  clientId: string,
  email: string,
): Promise<ActionResult<TenantAccessResendResult>> {
  const idResult = uuidSchema.safeParse(clientId);
  if (!idResult.success) return fail("Invalid client id.");

  const emailResult = tenantOwnerEmailSchema.safeParse(email);
  if (!emailResult.success) {
    return fail("Please fix the highlighted fields.", emailFieldError(emailResult.error));
  }
  const normalizedEmail = emailResult.data.toLowerCase();

  const tenantCtx = await requireActivatedTenantContext(idResult.data);
  if (!tenantCtx.ok) return fail(tenantCtx.error);
  const { session, tenantOrganizationId } = tenantCtx.value;

  // Service-role for everything below: reading/deleting another org's
  // `invites`, reading its `memberships`/`users`, and calling the Auth
  // Admin API all require bypassing RLS the same way the write in
  // `inviteTenantOwner` does — see this file's header comment.
  const admin = createAdminClient();

  // `.ilike(email, normalizedEmail)` with no wildcard characters is a
  // case-insensitive equality match — the same matching the table's own
  // `invites_pending_org_email_idx` partial unique index performs via
  // `lower(email)` — so this is guaranteed to find the same row that index
  // would treat as "the" pending invite for this org+email, regardless of
  // what case it happened to be stored in.
  const { data: pending, error: pendingError } = await admin
    .from("invites")
    .select("id")
    .eq("organization_id", tenantOrganizationId)
    .is("accepted_at", null)
    .ilike("email", normalizedEmail)
    .maybeSingle();
  if (pendingError) return fail(mapDbError(pendingError));

  if (pending) {
    const { error: deleteError } = await admin.from("invites").delete().eq("id", pending.id);
    if (deleteError) return fail(mapDbError(deleteError));

    const inserted = await insertTenantInvite(admin, tenantOrganizationId, normalizedEmail, session.userId);
    if (inserted.error) return fail(inserted.error, inserted.fieldErrors);
    return ok({ mode: "invited", inviteUrl: inserted.data!.inviteUrl });
  }

  const { data: existingUser, error: userError } = await admin
    .from("users")
    .select("id")
    .ilike("email", normalizedEmail)
    .maybeSingle();
  if (userError) return fail(mapDbError(userError));

  if (existingUser) {
    const { data: membership, error: membershipError } = await admin
      .from("memberships")
      .select("id")
      .eq("organization_id", tenantOrganizationId)
      .eq("user_id", existingUser.id)
      .maybeSingle();
    if (membershipError) return fail(mapDbError(membershipError));

    if (membership) {
      // Real password reset for an already-accepted member. `recovery`
      // (not `resetPasswordForEmail`, which actually sends mail through
      // whatever email provider is configured) generates the link without
      // sending anything — this repo has no SMTP/email provider configured
      // (see `createInviteAction`'s own doc comment for the same
      // reasoning), so the platform admin copies/sends this manually.
      //
      // Confirmed against the installed @supabase/supabase-js@2.112.3 (->
      // @supabase/auth-js's `GoTrueAdminApi.generateLink` /
      // `GenerateLinkResponse` / `GenerateLinkProperties` types,
      // node_modules/@supabase/auth-js/dist/module/lib/types.d.ts): the
      // link is nested at `data.properties.action_link`, not at the
      // response's top level.
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: normalizedEmail,
      });
      if (linkError || !linkData?.properties?.action_link) {
        return fail(linkError?.message ?? "Could not generate a password reset link.");
      }
      return ok({ mode: "reset", actionLink: linkData.properties.action_link });
    }
  }

  // Neither a pending invite nor an accepted membership exists — fall back
  // to sending a first invite rather than erroring, per the story ("this one
  // button is genuinely safe to always show once represents_organization_id
  // is set").
  const first = await insertTenantInvite(admin, tenantOrganizationId, normalizedEmail, session.userId);
  if (first.error) return fail(first.error, first.fieldErrors);
  return ok({ mode: "invited", inviteUrl: first.data!.inviteUrl });
}

export type TenantAccessStatus = "none" | "invited" | "active";

/**
 * Read helper for the "Access" panel: given an activated tenant client and
 * the list of contact emails the panel already has (it's fed the client's
 * existing `contacts`, fetched by the page — this file stays decoupled from
 * the `contacts` table/module, per the plan), resolves each email's current
 * access status against the tenant org's `invites`/`memberships` — no
 * invite yet, a pending invite, or an accepted membership — so the panel can
 * render "Send invitation" vs. "Reset password" without a live client-side
 * Supabase query.
 *
 * The returned map is keyed by each input email trimmed + lower-cased (the
 * same normalization every write in this file applies before touching
 * `invites`/`users`) — callers should look up a contact's status via
 * `contact.email.trim().toLowerCase()`.
 */
export async function getTenantAccessStatus(
  clientId: string,
  emails: string[],
): Promise<ActionResult<{ organizationId: string; statusByEmail: Record<string, TenantAccessStatus> }>> {
  const idResult = uuidSchema.safeParse(clientId);
  if (!idResult.success) return fail("Invalid client id.");

  const tenantCtx = await requireActivatedTenantContext(idResult.data);
  if (!tenantCtx.ok) return fail(tenantCtx.error);
  const { tenantOrganizationId } = tenantCtx.value;

  const normalizedEmails = Array.from(
    new Set(
      emails
        .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
        .filter((value) => value.length > 0),
    ),
  );

  const statusByEmail: Record<string, TenantAccessStatus> = {};
  for (const value of normalizedEmails) statusByEmail[value] = "none";

  if (normalizedEmails.length === 0) {
    return ok({ organizationId: tenantOrganizationId, statusByEmail });
  }

  // Service-role: reading another org's `invites`/`memberships`/`users` is
  // the same cross-tenant read this file's header comment covers for the
  // write actions above — under the platform admin's own session,
  // `invites_select_owner` would return zero rows for a tenant org they're
  // not an owner-member of, and there is no SELECT policy on `memberships`/
  // `users` that would help either.
  const admin = createAdminClient();

  const [invitesResult, membershipsResult] = await Promise.all([
    admin.from("invites").select("email").eq("organization_id", tenantOrganizationId).is("accepted_at", null),
    admin.from("memberships").select("user_id").eq("organization_id", tenantOrganizationId),
  ]);
  if (invitesResult.error) return fail(mapDbError(invitesResult.error));
  if (membershipsResult.error) return fail(mapDbError(membershipsResult.error));

  const userIds = (membershipsResult.data ?? []).map((row: { user_id: string }) => row.user_id);
  const usersResult =
    userIds.length > 0
      ? await admin.from("users").select("email").in("id", userIds)
      : { data: [] as { email: string }[], error: null };
  if (usersResult.error) return fail(mapDbError(usersResult.error));

  const pendingEmails = new Set(
    (invitesResult.data ?? []).map((row: { email: string }) => row.email.toLowerCase()),
  );
  const activeEmails = new Set(
    (usersResult.data ?? []).map((row: { email: string }) => row.email.toLowerCase()),
  );

  for (const value of normalizedEmails) {
    if (activeEmails.has(value)) statusByEmail[value] = "active";
    else if (pendingEmails.has(value)) statusByEmail[value] = "invited";
  }

  return ok({ organizationId: tenantOrganizationId, statusByEmail });
}
