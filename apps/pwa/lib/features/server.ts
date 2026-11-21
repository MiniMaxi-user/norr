import "server-only";

import { cache } from "react";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * PWA-side feature gating (issue #248). The PWA can't import the web app's
 * `lib/rbac/features.ts`, so this mirrors its read path: ONE select of the
 * org's enabled `organization_features` rows (RLS: members read their own
 * org's rows), memoized per request with React `cache()`. Module off = off:
 * routes answer 404, as if the module didn't exist.
 *
 * Keys the PWA cares about: `checklists`, `inventory`, `meters`.
 */
export type PwaFeatureKey = "checklists" | "inventory" | "meters";

export const getEnabledFeatureKeys = cache(async (organizationId: string): Promise<ReadonlySet<string>> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_features")
    .select("feature_key")
    .eq("organization_id", organizationId)
    .eq("enabled", true);
  if (error) {
    // Fail closed: an add-on we can't confirm is treated as off.
    console.error("getEnabledFeatureKeys: failed to load organization features", error);
    return new Set<string>();
  }
  return new Set((data ?? []).map((row) => (row as { feature_key: string }).feature_key));
});

export async function hasFeature(organizationId: string | null | undefined, key: PwaFeatureKey): Promise<boolean> {
  if (!organizationId) return false;
  return (await getEnabledFeatureKeys(organizationId)).has(key);
}

/** `null` when the module is on; otherwise the 404 response to return. */
export async function requireFeature(
  organizationId: string | null | undefined,
  key: PwaFeatureKey,
): Promise<NextResponse | null> {
  if (await hasFeature(organizationId, key)) return null;
  return NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
