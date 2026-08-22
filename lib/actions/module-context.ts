import "server-only";

import { requireSession, type CurrentSession } from "@/lib/auth/session";
import { hasFeature, type FeatureKey } from "@/lib/rbac/features";
import type { PermissionActor } from "@/lib/rbac/permissions";

/**
 * Shared "top of every action" preamble (CLAUDE.md rules 2 & 3: check
 * `hasFeature()` and resolve the RBAC actor before any side effect).
 * `app/(app)/clients/actions.ts` and `app/(app)/assets/actions.ts` both call
 * this first, so the feature-flag + membership checks live in exactly one
 * place instead of being re-typed per action.
 *
 * `requireSession()` already redirects signed-out callers to `/login`
 * (see lib/auth/session.ts) — by the time this runs, there is always a
 * signed-in user; what's left to check here is (a) do they have a tenant
 * membership at all, and (b) is this module enabled for their org.
 */
export interface ModuleContext {
  session: CurrentSession;
  actor: PermissionActor;
  organizationId: string;
}

/**
 * Tagged union (not just an `error?`-presence check) so `ctx.ok` narrows
 * cleanly in TypeScript's control flow analysis — an `error?: undefined` /
 * `error: string` shape doesn't narrow reliably because an empty string is
 * still a valid (falsy) `string`, which defeats a plain `if (ctx.error)`
 * check as a discriminant.
 */
export type ModuleContextResult =
  | { ok: true; context: ModuleContext }
  | { ok: false; error: string };

export async function requireModuleContext(featureKey: FeatureKey): Promise<ModuleContextResult> {
  const session = await requireSession();

  if (!session.organization) {
    // A platform-admin-only account with no tenant membership, or (in
    // theory) a signed-in user whose membership row was removed mid-session.
    // Real cross-tenant platform-admin reads go through lib/supabase/admin.ts
    // from a trusted, separate route — not through these tenant-scoped
    // module actions (see docs/ARCHITECTURE.md).
    return { ok: false, error: "You are not a member of any organization." };
  }

  if (!(await hasFeature(session.organization, featureKey))) {
    return { ok: false, error: "This module is not enabled for your organization." };
  }

  return {
    ok: true,
    context: {
      session,
      actor: { role: session.role, isPlatformAdmin: session.isPlatformAdmin },
      organizationId: session.organization.id,
    },
  };
}
