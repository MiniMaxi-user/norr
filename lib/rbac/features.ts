import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * Feature-flag / entitlement gating (CLAUDE.md rule 3: "Feature access goes
 * through hasFeature(org, key) — never assume a module is available").
 * Backed by `organization_features` (docs/ARCHITECTURE.md "Feature flags").
 * The module catalog (tier / requires / shipped) lives in
 * `lib/rbac/module-catalog.ts`.
 */

/**
 * Minimal shape `hasFeature` needs. Deliberately loose (just an id) so any
 * organization-shaped object — a full `organizations` row, a session's
 * `organization`, a test fixture — can be passed.
 */
export interface FeatureOrganization {
  id: string;
}

/**
 * Feature keys. Same strings as `organization_features.feature_key` and (for
 * the nav) `moduleKey` in components/shell/nav-items.ts.
 *
 * `reporting` and `billing` are unbuilt placeholders; `platform` is the
 * platform-admin special case (resolved via `isPlatformAdmin`, never via
 * `hasFeature`, see `resolveNavItems()`).
 */
export type FeatureKey =
  | "dashboard"
  | "clients"
  | "assets"
  | "articles"
  | "activities"
  | "planning"
  | "settings"
  | "contracts"
  | "quotes"
  | "invoicing"
  | "checklists"
  | "inventory"
  | "meters"
  | "preventive_maintenance"
  | "reporting"
  | "billing"
  | "platform";

/**
 * Keys with a shipped implementation. A key outside this set is never
 * available, whatever `organization_features` says (keep in sync with
 * `shipped` in `module-catalog.ts` and `feature_catalog.shipped` in the DB).
 * `reporting`, `billing` and `platform` are intentionally absent;
 * `preventive_maintenance` is catalogued but not shipped yet.
 */
export const SHIPPED_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  "dashboard",
  "clients",
  "assets",
  "articles",
  "activities",
  "planning",
  "settings",
  "contracts",
  "quotes",
  "invoicing",
  "checklists",
  "inventory",
  "meters",
]);

/**
 * ONE query for all enabled feature keys of an organization, memoized per
 * request with React `cache()` (same pattern as `getCurrentSession`, #141),
 * so dozens of `hasFeature` calls in one render cost a single round trip.
 * Runs under the user's session: RLS lets members read their own org's rows
 * and platform admins read all.
 */
export const getOrganizationFeatureKeys = cache(
  async (organizationId: string): Promise<ReadonlySet<string>> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organization_features")
      .select("feature_key")
      .eq("organization_id", organizationId)
      .eq("enabled", true);
    if (error || !data) return new Set<string>();
    return new Set(data.map((row: { feature_key: string }) => row.feature_key));
  },
);

/**
 * `hasFeature(organization, featureKey)` — the one gate every module
 * route/component/server-action must check (CLAUDE.md rule 3). True iff the
 * key is shipped AND enabled for the organization. Fails closed (false) on
 * no organization or a query error.
 */
export async function hasFeature(
  organization: FeatureOrganization | null | undefined,
  featureKey: FeatureKey,
): Promise<boolean> {
  if (!organization) return false;
  if (!SHIPPED_FEATURES.has(featureKey)) return false;
  const enabled = await getOrganizationFeatureKeys(organization.id);
  return enabled.has(featureKey);
}

/**
 * The whole effective set (shipped AND enabled) for callers that need all of
 * it at once: nav, Subscription page, the PWA features route.
 */
export async function getEnabledFeatures(
  organization: FeatureOrganization | null | undefined,
): Promise<FeatureKey[]> {
  if (!organization) return [];
  const enabled = await getOrganizationFeatureKeys(organization.id);
  return [...SHIPPED_FEATURES].filter((key) => enabled.has(key));
}
