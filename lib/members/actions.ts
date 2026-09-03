"use server";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { canAny, type TenantRole } from "@/lib/rbac/permissions";
import type { FeatureKey } from "@/lib/rbac/features";

/**
 * Minimal "who can this be assigned to" directory for the current org —
 * added alongside the Work Orders module frontend (issue #13) to back its
 * `assignedTo` picker (`app/(app)/work-orders/components/work-order-form.tsx`)
 * and to resolve `work_orders.assigned_to` uuids into a display name for the
 * list/detail views. `work_orders` doesn't embed a resolved assignee the way
 * it embeds `work_order_status`/`work_order_priority` (see
 * `app/(app)/work-orders/actions.ts`'s `WORK_ORDER_SELECT` comment) — this is
 * the smallest read that closes that gap without touching that already-
 * landed backend file.
 *
 * Deliberately NOT under `app/(app)/work-orders/` — this is `memberships`/
 * `users` data, not work-order data, so any future module that needs an
 * "assign to a member" picker (e.g. a Contracts account owner) should reuse
 * this rather than growing its own copy — same "shared, not module-owned"
 * reasoning as `lib/reference-lists/actions.ts`.
 *
 * No new RLS needed: `memberships_select_self_or_same_org` (any member can
 * see every membership row of their own org) and
 * `users_select_self_or_org_peers` (a user can see the profile of anyone who
 * shares an org with them) — both already in
 * `20260822150910_organizations_memberships_baseline_rls.sql` — are
 * sufficient for this read. Gated on the CALLING module's own feature key
 * (default `"planning"`, Work Orders' original caller) rather than a fixed
 * one — Activities' "action holder" picker (issue #118) is a second caller
 * that isn't entitled to `"planning"` at all, so hardcoding that key here
 * left its member picker permanently empty for any org with `activities` but
 * not `planning` enabled. Pass the caller's own `moduleKey` instead of
 * duplicating this file per module.
 */
export interface OrgMemberRecord {
  id: string;
  email: string;
  full_name: string | null;
  role: TenantRole;
}

interface MembershipWithUserRow {
  role: TenantRole;
  user: { id: string; email: string; full_name: string | null } | null;
}

export async function listOrgMembers(
  moduleKey: FeatureKey = "planning",
): Promise<ActionResult<{ members: OrgMemberRecord[] }>> {
  const ctx = await requireModuleContext(moduleKey);
  if (!ctx.ok) return fail(ctx.error);

  if (!canAny(ctx.context.actor, moduleKey, ["read", "read_own"])) {
    return fail("You do not have permission to view members.");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("role, user:users(id, email, full_name)")
    .order("created_at", { ascending: true });

  if (error) return fail(mapDbError(error));

  const members = ((data ?? []) as unknown as MembershipWithUserRow[])
    .filter((row): row is MembershipWithUserRow & { user: NonNullable<MembershipWithUserRow["user"]> } =>
      row.user !== null,
    )
    .map((row) => ({
      id: row.user.id,
      email: row.user.email,
      full_name: row.user.full_name,
      role: row.role,
    }));

  return ok({ members });
}
