import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { getOrganizationTimeRoundingSettings } from "../organization-time-rounding-actions";
import { OrganizationTimeRoundingForm } from "../components/organization-time-rounding-form";
import { SettingsLoadError } from "../components/settings-load-error";

export const metadata = { title: "Time Rounding" };

/**
 * Org-level travel/work minimum-duration + rounding settings (issue #198,
 * "Afronding reistijd werktijd") — own Settings leaf, same shape as
 * `../default-rates/page.tsx` (single async `page.tsx`, no `Suspense`, two
 * lightweight reads at most — here it's exactly one). The `"settings"`
 * feature/module gate already ran in `app/(app)/settings/layout.tsx`; only
 * `canWrite` is computed here, same `can(actor, "settings", "update")`
 * owner-only gate `../organization-time-rounding-actions.ts`'s own header
 * comment documents (mirrors `../organization-rate-actions.ts`'s reasoning
 * for why this deviates from a literal "owner/planner" read of the issue).
 */
export default async function TimeRoundingPage() {
  const session = await getCurrentSession();
  const actor: PermissionActor = { role: session?.role ?? null, isPlatformAdmin: session?.isPlatformAdmin ?? false };
  const canWrite = can(actor, "settings", "update");

  const settingsResult = await getOrganizationTimeRoundingSettings();

  if (!settingsResult.data) {
    return <SettingsLoadError navKey="time_rounding" message={settingsResult.error ?? "Could not load time rounding settings."} />;
  }

  return <OrganizationTimeRoundingForm initial={settingsResult.data.settings} canWrite={canWrite} />;
}
