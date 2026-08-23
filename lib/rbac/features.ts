import "server-only";

/**
 * Feature-flag / entitlement gating (issue #4, CLAUDE.md rule 3: "Feature
 * access goes through hasFeature(org, key) — never assume a module is
 * available"). Every module route/component must check entitlement through
 * this one helper (docs/ARCHITECTURE.md "Feature flags") instead of
 * hardcoding module availability.
 *
 * Phase 0/1 reality: `organization_features` (docs/ARCHITECTURE.md "Core
 * schema (v1)") doesn't exist yet — it lands in Phase 3 with Stripe billing
 * sync (docs/ROADMAP.md). This file stubs the *implementation* only; the
 * function signature and every call site (components/shell/nav-items.ts,
 * and any future module route) already call this exactly the way they will
 * once the table exists, so nothing needs rewiring later — see the TODO
 * inside `hasFeature` for the exact swap.
 */

/**
 * Minimal shape `hasFeature` needs. Deliberately loose (just an id) so any
 * organization-shaped object — a full row from `organizations`, a session's
 * `organization`, a test fixture — can be passed without an import cycle on
 * a "real" Organization type.
 */
export interface FeatureOrganization {
  id: string;
}

/**
 * Feature keys. Kept 1:1 with `moduleKey` in components/shell/nav-items.ts
 * and with `Module` in lib/rbac/permissions.ts today (see the comment on
 * `Module` for why that's a coincidence worth not over-relying on) — and
 * will be 1:1 with `organization_features.feature_key` once that table
 * exists.
 */
export type FeatureKey =
  | "dashboard"
  | "clients"
  | "assets"
  | "contracts"
  | "planning"
  // Checklists (issue #14, second stage) — see
  // `lib/checklist-templates/actions.ts` and
  // `app/(app)/work-orders/checklist-actions.ts`, and
  // `lib/rbac/permissions.ts`'s dedicated `checklists` module. Not a
  // `nav-items.ts` entry of its own (checklist templates are configured
  // under Settings, and checklist instances live inside a work order's own
  // detail page), but every one of those files' Server Actions still calls
  // `hasFeature()` first per CLAUDE.md rule 3.
  | "checklists"
  | "reporting"
  | "billing"
  // Tenant-configurable reference lists (picklists) — see
  // lib/reference-lists/actions.ts and lib/rbac/permissions.ts's `settings`
  // module. Not a `nav-items.ts` entry today (no dedicated Settings page
  // yet — a concurrent frontend effort owns that), but every
  // reference-lists Server Action still calls `hasFeature()` first per
  // CLAUDE.md rule 3.
  | "settings";

/**
 * Phase 0 stand-in for "the org's Stripe subscription entitles them to this
 * module": since there's no billing yet, entitlement is really just "does
 * this module have a shipped implementation at all" (docs/ROADMAP.md
 * phasing) — gated purely on the feature key, not on which organization is
 * asking. Update this set as modules ship; it goes away entirely once the
 * TODO below is done.
 *
 * `clients` and `assets` added here as part of Phase 1 Core CRM (issues
 * #8/#9): `app/(app)/clients/actions.ts` and `app/(app)/assets/actions.ts`
 * both call `hasFeature()` at the top of every action (CLAUDE.md rule 3) —
 * leaving these two out of this set would make every one of those actions
 * unconditionally fail with "module not enabled", which would be wrong now
 * that the modules are actually shipping.
 *
 * `settings` added alongside the reference-lists feature (tenant-
 * configurable Asset Type/Status picklists, `lib/reference-lists/actions.ts`)
 * — it ships in the same PR as `assets`' migration to `type_id`/`status_id`,
 * so it needs to be usable immediately, same reasoning as `clients`/`assets`
 * above.
 *
 * `planning` added alongside the Work Orders module
 * (`app/(app)/work-orders/actions.ts`, issue #13): every one of that file's
 * actions calls `hasFeature()` first per CLAUDE.md rule 3, so leaving
 * `planning` out of this set would make the module unconditionally fail with
 * "module not enabled" now that it's actually shipping — same reasoning as
 * `clients`/`assets`/`settings` above.
 *
 * `contracts` added alongside the Contracts module (`app/(app)/contracts/
 * actions.ts`, issue #33): every one of that file's actions (and the
 * `components/shell/nav-items.ts` entry) calls `hasFeature()` first per
 * CLAUDE.md rule 3 — same reasoning as `planning` above.
 *
 * `checklists` added alongside the Checklists module (issue #14, second
 * stage — `lib/checklist-templates/actions.ts` and
 * `app/(app)/work-orders/checklist-actions.ts`): every action in both of
 * those files calls `hasFeature()` first per CLAUDE.md rule 3 — same
 * reasoning as `contracts`/`planning` above. This exact omission (shipping a
 * module's actions/RBAC row without adding its key here) has already broken
 * `planning` once this session and was caught just before landing for
 * `contracts` — don't repeat it a third time.
 */
const SHIPPED_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  "dashboard",
  "clients",
  "assets",
  "settings",
  "planning",
  "contracts",
  "checklists",
]);

/**
 * `hasFeature(organization, featureKey)` — the one gate every module
 * route/component/server-action must check before treating a module as
 * available (CLAUDE.md rule 3).
 *
 * TODO(auth-rbac-engineer / billing-engineer, Phase 3 — docs/ROADMAP.md):
 * once `organization_features (organization_id, feature_key, enabled)`
 * exists (synced from Stripe webhooks), replace the body with:
 *
 *   import { createClient } from "@/lib/supabase/server";
 *   const supabase = await createClient();
 *   const { data } = await supabase
 *     .from("organization_features")
 *     .select("enabled")
 *     .eq("organization_id", organization.id)
 *     .eq("feature_key", featureKey)
 *     .maybeSingle();
 *   return data?.enabled ?? false;
 *
 * Every call site already does `await hasFeature(...)` and already passes a
 * real organization — this swap is the only change needed.
 */
export async function hasFeature(
  organization: FeatureOrganization | null | undefined,
  featureKey: FeatureKey,
): Promise<boolean> {
  if (!organization) return false;
  return SHIPPED_FEATURES.has(featureKey);
}
