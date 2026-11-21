"use server";

import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, mapDbError, type ActionResult } from "@/lib/actions/result";
import { getEnabledFeatures } from "@/lib/rbac/features";
import { addonModules, coreModules, type CatalogFeatureKey, MODULE_CATALOG } from "@/lib/rbac/module-catalog";
import { can, TENANT_ROLES, type TenantRole } from "@/lib/rbac/permissions";

export interface SubscriptionModule {
  key: CatalogFeatureKey;
  label: string;
  description: string;
}

export interface SubscriptionOverview {
  coreModules: SubscriptionModule[];
  enabledAddons: SubscriptionModule[];
  /** Shipped add-ons the tenant doesn't have (yet). */
  availableAddons: SubscriptionModule[];
  /** Active users (memberships) per tenant role; every role is present, also with 0. */
  usersByRole: { role: TenantRole; count: number }[];
  totalUsers: number;
}

function toModule(key: CatalogFeatureKey): SubscriptionModule {
  return { key, label: MODULE_CATALOG[key].label, description: MODULE_CATALOG[key].description };
}

/**
 * Subscription section in Settings (#249): which modules the tenant has and the
 * active users per role. Owner only (`can(actor, "subscription", "read")`);
 * read-only - modules are switched by the platform admin, never the tenant.
 */
export async function getSubscriptionOverview(): Promise<ActionResult<SubscriptionOverview>> {
  const ctx = await requireModuleContext("settings");
  if (!ctx.ok) return fail(ctx.error);
  if (!can(ctx.context.actor, "subscription", "read")) {
    return fail("You do not have permission to view the subscription.");
  }

  const supabase = await createSupabaseServerClient();
  const [enabledKeys, membershipsResult] = await Promise.all([
    getEnabledFeatures(ctx.context.session.organization),
    supabase.from("memberships").select("role").eq("organization_id", ctx.context.organizationId),
  ]);
  if (membershipsResult.error) return fail(mapDbError(membershipsResult.error));

  const enabled = new Set<string>(enabledKeys);
  const counts = new Map<string, number>();
  for (const row of membershipsResult.data ?? []) {
    counts.set(row.role as string, (counts.get(row.role as string) ?? 0) + 1);
  }

  const addons = addonModules().filter((key) => MODULE_CATALOG[key].shipped);
  return ok({
    coreModules: coreModules().map(toModule),
    enabledAddons: addons.filter((key) => enabled.has(key)).map(toModule),
    availableAddons: addons.filter((key) => !enabled.has(key)).map(toModule),
    usersByRole: TENANT_ROLES.map((role) => ({ role, count: counts.get(role) ?? 0 })),
    totalUsers: membershipsResult.data?.length ?? 0,
  });
}
