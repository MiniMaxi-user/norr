"use server";

import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { can, isTenantRole, TENANT_ROLES, type TenantRole } from "@/lib/rbac/permissions";
import { getAvatarUrl } from "@/lib/profile/avatar-url";
import { getSiteOrigin } from "@/lib/auth/site-origin";
import {
  rateOverrideSchema,
  toRateOverrideRow,
  fromRateOverrideRow,
  type RateOverrideRecord,
} from "@/lib/rate-overrides/schema";

/**
 * Server Actions for an OWNER managing their OWN tenant's team (issue #88):
 * list members + pending invites, invite/cancel-invite, change a teammate's
 * role, edit a teammate's display name, reset a teammate's password, and
 * remove a teammate — all scoped to the caller's own `session.organization.id`,
 * never a client-supplied org id.
 *
 * Deliberately its own module, NOT `lib/account-managers/actions.ts`: that
 * file is an unrelated tenant-configurable CRM reference-data concept ("who
 * at this org account-manages which client"), not a user login/membership —
 * see its own header comment. This file is the closest sibling of
 * `app/(app)/clients/platform-access-actions.ts` ("invite + resend/reset +
 * disable" for a tenant's login access) — same shape, but SAME-tenant (an
 * owner managing their own org) rather than CROSS-tenant (a platform admin
 * managing someone else's org).
 *
 * That same-tenant-vs-cross-tenant distinction is exactly why most of the
 * writes below run under the CALLER'S OWN session client
 * (`lib/supabase/server.ts`), not the service-role client
 * (`lib/supabase/admin.ts`) that `platform-access-actions.ts` needs
 * throughout: a platform admin is never a real member of the tenant org
 * they're managing, so RLS's `is_org_owner(organization_id)` checks can never
 * pass for them — but an owner managing their OWN org's team satisfies those
 * same checks directly. Confirmed against
 * `supabase/migrations/20260822150910_organizations_memberships_baseline_rls.sql`
 * and `supabase/migrations/20260822180000_invites.sql` before writing this
 * file:
 *   - `invites_insert_owner` / `invites_delete_owner` / `invites_select_owner`:
 *     all just `is_org_owner(organization_id)` — the caller's own session
 *     client is sufficient for `inviteTeamMember`/`cancelTeamInvite`, and for
 *     the pending-invites half of `listTeamMembers` (see that function's own
 *     comment on what a non-owner caller sees there).
 *   - `memberships_update_owner` / `memberships_delete_self_or_owner`: both
 *     just `is_org_owner(organization_id)` on the UPDATE/DELETE side, with NO
 *     additional "target row must be the caller's own" clause — an owner can
 *     already update/delete ANY membership row in their own org under their
 *     own session. So `updateTeamMemberRole` and `removeTeamMember` do NOT
 *     need the service-role client, contrary to what you might assume by
 *     analogy with `platform-access-actions.ts`.
 *   - `users_update_self` (`id = auth.uid()`, plus a column-level grant of
 *     only `full_name`/`avatar_path`/`locale` to `authenticated`): this is
 *     the one boundary an owner's own session genuinely cannot cross for
 *     someone else's row. `updateTeamMemberProfile` (editing a TEAMMATE's
 *     `full_name`) and `resetTeamMemberPassword` (an Auth Admin API call,
 *     which is inherently service-role regardless of RLS) are the only two
 *     actions in this file that use `createAdminClient()` — both
 *     independently re-verify the target is a member of the caller's own org
 *     INSIDE the service-role query itself before writing anything, the same
 *     "audited cross-member write, checked in application code" reasoning
 *     `platform-access-actions.ts` documents for its cross-TENANT case, just
 *     applied same-tenant here.
 *
 * No email-change support: the Dutch acceptance criteria lists email among
 * the "manageable" fields, but changing another user's Supabase Auth email
 * requires a re-verification flow this repo has no existing pattern for
 * (grepped — `app/(app)/profile/actions.ts` doesn't offer self-email-change
 * either), and is out of proportion to this story. Email is exposed
 * READ-ONLY via `listTeamMembers`. Locale/language is explicitly out of
 * scope too ("standaard taal (toekomst)" in the story). Avatar/photo upload
 * on a teammate's behalf is also out of scope — `listTeamMembers` surfaces
 * the existing `avatarUrl` (via `getAvatarUrl`) for display only.
 */

const uuidSchema = z.string().uuid("Invalid id.");

/** Same shape as `platform-access-actions.ts`'s `tenantOwnerEmailSchema` —
 * trim + valid email format + 320 char max (the practical RFC 5321 limit). */
const teamEmailSchema = z.string().trim().email("Invalid email address.").max(320);

/** Same shape as `app/(app)/profile/actions.ts`'s `fullName` field. */
const teamFullNameSchema = z.string().trim().min(1, "Name is required.").max(200, "Name is too long.");

function emailFieldError(error: z.ZodError): Record<string, string[]> {
  return { email: [error.issues[0]?.message ?? "Invalid email address."] };
}

function invalidRoleError(): Record<string, string[]> {
  return { role: [`Role must be one of: ${TENANT_ROLES.join(", ")}.`] };
}

export interface TeamMemberRecord {
  userId: string;
  email: string;
  fullName: string | null;
  role: TenantRole;
  avatarUrl: string | null;
  createdAt: string;
  /** `users.is_platform_admin` (issue #91) — this member is the cross-tenant
   * Platform Admin, not just a regular owner of this org. Protected in the
   * Team UI/actions below regardless of who's viewing: never removable, role
   * always stays `owner`. */
  isPlatformAdmin: boolean;
  /** Issue #93 rate override fields — see
   * `updateTeamMemberRateSettings` below. Present (with their default/`null`
   * values) on every member row regardless of role, since the underlying
   * columns exist on all of `memberships`, but only ever meaningfully edited
   * for `role === "engineer"` rows — `updateTeamMemberRateSettings` rejects
   * writes to any other role. */
  rateSettings: RateOverrideRecord;
}

export interface PendingTeamInviteRecord {
  id: string;
  email: string;
  role: TenantRole;
  createdAt: string;
}

export interface TeamMembersResult {
  members: TeamMemberRecord[];
  pendingInvites: PendingTeamInviteRecord[];
}

interface MembershipWithUserRow {
  created_at: string;
  role: TenantRole;
  has_custom_rate: boolean;
  travel_article_id: string | null;
  work_article_id: string | null;
  travel_sale_price: number | null;
  work_sale_price: number | null;
  user: {
    id: string;
    email: string;
    full_name: string | null;
    avatar_path: string | null;
    avatar_updated_at: string | null;
    is_platform_admin: boolean;
  } | null;
}

interface InviteRow {
  id: string;
  email: string;
  role: TenantRole;
  created_at: string;
}

/**
 * Lists the caller's own org's active members + pending invites. Read access
 * matches `settings`'s "everyone can read" shape (`can(actor, "settings",
 * "read")` — true for every tenant role) — this function doesn't gate on
 * `can()` beyond `requireModuleContext`'s own checks, since every tenant role
 * has at least `read` on `settings`.
 *
 * `pendingInvites` naturally comes back EMPTY for a non-owner caller: RLS
 * (`invites_select_owner`) only lets an org's owner see its `invites` rows at
 * all, so a planner/engineer/finance/administratie caller's own-session query
 * simply matches zero rows here — not an error, just an empty list. That's
 * fine for this story (only an owner manages the team), and means this
 * function never needs to branch on role itself.
 */
export async function listTeamMembers(): Promise<ActionResult<TeamMembersResult>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);

  const supabase = await createSupabaseServerClient();

  const [membershipsResult, invitesResult] = await Promise.all([
    supabase
      .from("memberships")
      .select(
        "created_at, role, has_custom_rate, travel_article_id, work_article_id, travel_sale_price, work_sale_price, user:users(id, email, full_name, avatar_path, avatar_updated_at, is_platform_admin)",
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("invites")
      .select("id, email, role, created_at")
      .is("accepted_at", null)
      .order("created_at", { ascending: true }),
  ]);

  if (membershipsResult.error) return fail(mapDbError(membershipsResult.error));
  if (invitesResult.error) return fail(mapDbError(invitesResult.error));

  const members = ((membershipsResult.data ?? []) as unknown as MembershipWithUserRow[])
    .filter(
      (row): row is MembershipWithUserRow & { user: NonNullable<MembershipWithUserRow["user"]> } =>
        row.user !== null,
    )
    .map((row) => ({
      userId: row.user.id,
      email: row.user.email,
      fullName: row.user.full_name,
      role: row.role,
      avatarUrl: getAvatarUrl(row.user.avatar_path, row.user.avatar_updated_at),
      createdAt: row.created_at,
      isPlatformAdmin: row.user.is_platform_admin,
      rateSettings: fromRateOverrideRow({
        has_custom_rate: row.has_custom_rate,
        travel_article_id: row.travel_article_id,
        work_article_id: row.work_article_id,
        travel_sale_price: row.travel_sale_price,
        work_sale_price: row.work_sale_price,
      }),
    }));

  const pendingInvites = ((invitesResult.data ?? []) as InviteRow[]).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  }));

  return ok({ members, pendingInvites });
}

export interface InviteTeamMemberResult {
  inviteUrl: string;
}

/**
 * Owner-only. Inserts a fresh invite for `email`/`role` into the CALLER's OWN
 * org, under the caller's own session client — `invites_insert_owner`
 * already enforces `is_org_owner(organization_id) and invited_by =
 * auth.uid()`, so no service-role client is needed (contrast with
 * `platform-access-actions.ts`'s `insertTenantInvite`, which is a platform
 * admin acting on a DIFFERENT org). Returns a copyable `/invite/[token]` link
 * — same reasoning as every other invite action in this repo: no
 * SMTP/email provider is configured yet.
 */
export async function inviteTeamMember(email: string, role: string): Promise<ActionResult<InviteTeamMemberResult>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  const { session, actor, organizationId } = ctx.context;

  if (!can(actor, "settings", "create")) {
    return fail("Only the organization owner can invite teammates.");
  }

  const emailResult = teamEmailSchema.safeParse(email);
  if (!emailResult.success) {
    return fail("Please fix the highlighted fields.", emailFieldError(emailResult.error));
  }
  if (!isTenantRole(role)) {
    return fail("Please fix the highlighted fields.", invalidRoleError());
  }
  const normalizedEmail = emailResult.data.toLowerCase();

  const supabase = await createSupabaseServerClient();
  const { data: invite, error } = await supabase
    .from("invites")
    .insert({
      organization_id: organizationId,
      email: normalizedEmail,
      role,
      invited_by: session.userId,
    })
    .select("token")
    .single();

  if (error) {
    // 23505 = `invites_pending_org_email_idx` (one pending invite per
    // org+email at a time) — same handling as `insertTenantInvite` in
    // `platform-access-actions.ts`.
    if (error.code === "23505") {
      return fail("An invitation is already pending for this email.");
    }
    return fail(mapDbError(error));
  }

  return ok({ inviteUrl: `${await getSiteOrigin()}/invite/${invite.token}` });
}

/** Owner-only. Cancels (deletes) a still-pending invite for the caller's own
 * org. `invites_delete_owner` RLS already scopes this to the caller's own
 * org, but `organization_id` is filtered explicitly here too, matching this
 * file's "own session client, own org id, never trust a client-supplied
 * cross-org match" convention. */
export async function cancelTeamInvite(inviteId: string): Promise<ActionResult<{ cancelled: true }>> {
  const idResult = uuidSchema.safeParse(inviteId);
  if (!idResult.success) return fail("Invalid invite id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;

  if (!can(actor, "settings", "delete")) {
    return fail("Only the organization owner can cancel an invite.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("invites")
    .delete()
    .eq("id", idResult.data)
    .eq("organization_id", organizationId)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Invite not found.");

  return ok({ cancelled: true as const });
}

export interface UpdateTeamMemberRoleResult {
  userId: string;
  role: TenantRole;
}

/**
 * Owner-only. Changes a teammate's role within the caller's own org. Runs
 * under the caller's OWN session client — `memberships_update_owner` RLS
 * already allows an owner to update any membership row in their own org (see
 * this file's header comment) — but still independently re-verifies the
 * target is a member of the caller's own org (the `.maybeSingle()` lookup
 * below) before deciding anything, rather than trusting the caller-supplied
 * `userId` to already be scoped correctly.
 *
 * Rejects the change if the target is currently the org's SOLE `owner` and
 * the new role isn't `owner` — an org must always retain at least one owner.
 *
 * Also rejects (issue #91) an owner changing THEIR OWN role via this panel —
 * `removeTeamMember` already had an equivalent self-check (see this file's
 * header comment), but role-change had no such guard: with 2+ owners, the
 * "sole owner" check above never fires, so an owner could otherwise
 * self-demote out of the role they need to keep managing the team at all.
 * And rejects changing the cross-tenant Platform Admin's role away from
 * `owner` at all, regardless of who's asking — that account needs guaranteed
 * `owner`-level access to every org, not just this one.
 */
export async function updateTeamMemberRole(
  userId: string,
  role: string,
): Promise<ActionResult<UpdateTeamMemberRoleResult>> {
  const idResult = uuidSchema.safeParse(userId);
  if (!idResult.success) return fail("Invalid user id.");
  if (!isTenantRole(role)) {
    return fail("Please fix the highlighted fields.", invalidRoleError());
  }

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  const { session, actor, organizationId } = ctx.context;

  if (!can(actor, "settings", "update")) {
    return fail("Only the organization owner can change a teammate's role.");
  }

  if (idResult.data === session.userId) {
    return fail("You can't change your own role from this panel.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: target, error: targetError } = await supabase
    .from("memberships")
    .select("id, role, user:users(is_platform_admin)")
    .eq("organization_id", organizationId)
    .eq("user_id", idResult.data)
    .maybeSingle<{ id: string; role: TenantRole; user: { is_platform_admin: boolean } | null }>();

  if (targetError) return fail(mapDbError(targetError));
  if (!target) return fail("This person is not a member of your organization.");

  if (target.user?.is_platform_admin && role !== "owner") {
    return fail("The platform admin's role can't be changed.");
  }

  if (target.role === "owner" && role !== "owner") {
    const { count, error: ownerCountError } = await supabase
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("role", "owner");
    if (ownerCountError) return fail(mapDbError(ownerCountError));
    if ((count ?? 0) <= 1) {
      return fail("You can't change the last owner's role — promote someone else first.");
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from("memberships")
    .update({ role })
    .eq("id", target.id)
    .eq("organization_id", organizationId)
    .select("user_id, role")
    .maybeSingle();

  if (updateError) return fail(mapDbError(updateError));
  if (!updated) return fail("Could not update this teammate's role.");

  return ok({ userId: updated.user_id, role: updated.role });
}

export interface UpdateTeamMemberProfileInput {
  fullName: string;
}

export interface UpdateTeamMemberProfileResult {
  userId: string;
  fullName: string;
}

/**
 * Owner-only. Edits a TEAMMATE's display name — not the caller's own, which
 * is `app/(app)/profile/actions.ts`'s `updateProfile`, untouched here.
 *
 * Uses the SERVICE-ROLE client: `users_update_self` (`id = auth.uid()`) only
 * ever lets a user write their OWN `users` row, so an owner's own session
 * cannot update a teammate's `full_name` at all — see this file's header
 * comment. Independently re-verifies the target is a member of the caller's
 * own org (via the service-role query itself, not a client-supplied
 * assumption) before writing.
 */
export async function updateTeamMemberProfile(
  userId: string,
  input: UpdateTeamMemberProfileInput,
): Promise<ActionResult<UpdateTeamMemberProfileResult>> {
  const idResult = uuidSchema.safeParse(userId);
  if (!idResult.success) return fail("Invalid user id.");

  const nameResult = teamFullNameSchema.safeParse(input?.fullName);
  if (!nameResult.success) {
    return fail("Please fix the highlighted fields.", {
      fullName: [nameResult.error.issues[0]?.message ?? "Invalid name."],
    });
  }

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;

  if (!can(actor, "settings", "update")) {
    return fail("Only the organization owner can edit a teammate's profile.");
  }

  const admin = createAdminClient();

  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", idResult.data)
    .maybeSingle();
  if (membershipError) return fail(mapDbError(membershipError));
  if (!membership) return fail("This person is not a member of your organization.");

  const { data: updated, error: updateError } = await admin
    .from("users")
    .update({ full_name: nameResult.data })
    .eq("id", idResult.data)
    .select("id, full_name")
    .maybeSingle();

  if (updateError) return fail(mapDbError(updateError));
  if (!updated) return fail("Could not update this teammate's profile.");

  return ok({ userId: updated.id, fullName: updated.full_name ?? "" });
}

export interface ResetTeamMemberPasswordResult {
  actionLink: string;
}

/**
 * Owner-only. Same pattern as `resendOrResetTenantAccess`'s
 * "already-accepted member" branch in `platform-access-actions.ts`:
 * generates a Supabase Auth password-recovery link via the service-role
 * Admin API (inherently service-role, regardless of RLS — there is no
 * caller-session equivalent of `auth.admin.generateLink`) and returns it for
 * the owner to copy/send manually — no SMTP/email provider is configured in
 * this repo. Re-verifies the target is a member of the caller's own org
 * before calling the Admin API.
 */
export async function resetTeamMemberPassword(
  userId: string,
): Promise<ActionResult<ResetTeamMemberPasswordResult>> {
  const idResult = uuidSchema.safeParse(userId);
  if (!idResult.success) return fail("Invalid user id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;

  if (!can(actor, "settings", "update")) {
    return fail("Only the organization owner can reset a teammate's password.");
  }

  const admin = createAdminClient();

  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", idResult.data)
    .maybeSingle();
  if (membershipError) return fail(mapDbError(membershipError));
  if (!membership) return fail("This person is not a member of your organization.");

  const { data: user, error: userError } = await admin
    .from("users")
    .select("email")
    .eq("id", idResult.data)
    .maybeSingle();
  if (userError) return fail(mapDbError(userError));
  if (!user) return fail("User not found.");

  // Same `GenerateLinkResponse` shape note as `resendOrResetTenantAccess` in
  // `platform-access-actions.ts`: the link is nested at
  // `data.properties.action_link`, not at the response's top level.
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: user.email,
  });
  if (linkError || !linkData?.properties?.action_link) {
    return fail(linkError?.message ?? "Could not generate a password reset link.");
  }

  return ok({ actionLink: linkData.properties.action_link });
}

/**
 * Owner-only. Removes a teammate's membership from the caller's own org —
 * never the underlying `auth.users`/`public.users` row, mirroring
 * `disableTenantAccess`'s "never a global ban" reasoning in
 * `platform-access-actions.ts`: this only revokes access to THIS org, not
 * every org the account might belong to.
 *
 * Runs under the caller's OWN session client — `memberships_delete_self_or_
 * owner` RLS already allows an owner to delete any membership row in their
 * own org (see this file's header comment) — but still re-verifies the
 * target is a member of the caller's own org first.
 *
 * Rejects three cases: removing yourself (self-removal from your own org via
 * this admin panel is out of scope/dangerous — no such flow exists elsewhere
 * in the app either), removing the org's sole remaining `owner`, and removing
 * the cross-tenant Platform Admin (issue #91) — that account must never lose
 * access to any org, regardless of who's asking.
 */
export async function removeTeamMember(userId: string): Promise<ActionResult<{ removed: true }>> {
  const idResult = uuidSchema.safeParse(userId);
  if (!idResult.success) return fail("Invalid user id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  const { session, actor, organizationId } = ctx.context;

  if (!can(actor, "settings", "delete")) {
    return fail("Only the organization owner can remove a teammate.");
  }

  if (idResult.data === session.userId) {
    return fail("You can't remove your own access from this panel.");
  }

  const supabase = await createSupabaseServerClient();

  const { data: target, error: targetError } = await supabase
    .from("memberships")
    .select("id, role, user:users(is_platform_admin)")
    .eq("organization_id", organizationId)
    .eq("user_id", idResult.data)
    .maybeSingle<{ id: string; role: TenantRole; user: { is_platform_admin: boolean } | null }>();

  if (targetError) return fail(mapDbError(targetError));
  if (!target) return fail("This person is not a member of your organization.");

  if (target.user?.is_platform_admin) {
    return fail("The platform admin can't be removed.");
  }

  if (target.role === "owner") {
    const { count, error: ownerCountError } = await supabase
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("role", "owner");
    if (ownerCountError) return fail(mapDbError(ownerCountError));
    if ((count ?? 0) <= 1) {
      return fail("You can't remove the last owner. Promote someone else first.");
    }
  }

  const { data, error } = await supabase
    .from("memberships")
    .delete()
    .eq("id", target.id)
    .eq("organization_id", organizationId)
    .select("id")
    .maybeSingle();

  if (error) return fail(mapDbError(error));
  if (!data) return fail("Could not remove this teammate.");

  return ok({ removed: true as const });
}

// ---------------------------------------------------------------------------
// Rate settings (issue #93, "Reistijd en werktijd artikelen beheren") — an
// engineer's default Travel-time/Work-time billing article override. See
// `lib/rate-overrides/schema.ts`'s header comment for the shared shape this
// mirrors 1:1 with `updateClientRateSettings` in
// `app/(app)/clients/actions.ts`. Storage: 5 columns added directly onto
// `public.memberships` by `supabase/migrations/20260830090000_engineer_
// client_rate_overrides.sql` — "an engineer" IS a membership row with
// `role = 'engineer'`, there is no separate `engineers` table.
// ---------------------------------------------------------------------------

export interface TeamMemberRateSettingsRecord extends RateOverrideRecord {
  userId: string;
}

/** Defense-in-depth existence check for `travelArticleId`/`workArticleId`,
 * same pattern as `validateAssetModel` in `app/(app)/assets/actions.ts`: RLS
 * on `articles` (any org member may SELECT) already scopes this lookup to
 * the caller's own organization, so a hit here also proves org membership —
 * no separate `.eq("organization_id", ...)` filter needed. Backstopped
 * either way by the DB's own `validate_rate_override_articles` trigger. */
async function validateRateOverrideArticle(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  articleId: string,
  label: "travel" | "work",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("articles").select("id").eq("id", articleId).maybeSingle();
  if (error) return { ok: false, error: mapDbError(error) };
  if (!data) {
    return {
      ok: false,
      error: `Invalid ${label} article — it does not exist, or it does not belong to your organization.`,
    };
  }
  return { ok: true };
}

/**
 * Owner-only. Sets/clears an engineer's (a membership row with
 * `role = 'engineer'`) custom Travel-time/Work-time billing rate override.
 * Runs under the caller's OWN session client — `memberships_update_owner`
 * RLS already allows an owner to update any membership row in their own org
 * (see this file's header comment) — but still independently re-verifies the
 * target is a member of the caller's own org, and specifically an
 * `engineer`, before writing anything.
 *
 * `hasCustomRate: false` clears `travelArticleId`/`workArticleId`/
 * `travelSalePrice`/`workSalePrice` back to `null` — see
 * `toRateOverrideRow`'s comment on why, rather than leaving stale values in
 * place.
 */
export async function updateTeamMemberRateSettings(
  userId: string,
  input: unknown,
): Promise<ActionResult<TeamMemberRateSettingsRecord>> {
  const idResult = uuidSchema.safeParse(userId);
  if (!idResult.success) return fail("Invalid user id.");

  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  const { actor, organizationId } = ctx.context;

  if (!can(actor, "settings", "update")) {
    return fail("Only the organization owner can change a teammate's rate settings.");
  }

  const parsed = rateOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Please fix the highlighted fields.", parsed.error.flatten().fieldErrors);
  }

  const supabase = await createSupabaseServerClient();

  const { data: target, error: targetError } = await supabase
    .from("memberships")
    .select("id, role")
    .eq("organization_id", organizationId)
    .eq("user_id", idResult.data)
    .maybeSingle<{ id: string; role: TenantRole }>();

  if (targetError) return fail(mapDbError(targetError));
  if (!target) return fail("This person is not a member of your organization.");
  if (target.role !== "engineer") {
    return fail("Custom rate settings only apply to teammates with the Engineer role.");
  }

  if (parsed.data.hasCustomRate) {
    const [travelCheck, workCheck] = await Promise.all([
      validateRateOverrideArticle(supabase, parsed.data.travelArticleId as string, "travel"),
      validateRateOverrideArticle(supabase, parsed.data.workArticleId as string, "work"),
    ]);
    if (!travelCheck.ok) return fail("Please fix the highlighted fields.", { travelArticleId: [travelCheck.error] });
    if (!workCheck.ok) return fail("Please fix the highlighted fields.", { workArticleId: [workCheck.error] });
  }

  const { data: updated, error: updateError } = await supabase
    .from("memberships")
    .update(toRateOverrideRow(parsed.data))
    .eq("id", target.id)
    .eq("organization_id", organizationId)
    .select("has_custom_rate, travel_article_id, work_article_id, travel_sale_price, work_sale_price")
    .maybeSingle();

  if (updateError) return fail(mapDbError(updateError));
  if (!updated) return fail("Could not update this teammate's rate settings.");

  return ok({ userId: idResult.data, ...fromRateOverrideRow(updated) });
}
