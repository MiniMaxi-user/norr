import { OverviewHeroBand, Stack, Text } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { getOrganizationTimeRoundingSettings } from "../organization-time-rounding-actions";
import { OrganizationTimeRoundingForm } from "../components/organization-time-rounding-form";

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

  return (
    <Stack gap="lg">
      <OverviewHeroBand
        title="Time Rounding"
        subtitle="Minimum billable duration and rounding rules applied separately to logged Travel time and Work time — e.g. a 25 min work entry rounds up to 30 min, or a 40 min travel entry floors up to a 60 min minimum. Applied wherever hours are billed; the raw clocked times are always kept as logged."
      />
      {settingsResult.data ? (
        <OrganizationTimeRoundingForm initial={settingsResult.data.settings} canWrite={canWrite} />
      ) : (
        <Text tone="danger">{settingsResult.error ?? "Could not load time rounding settings."}</Text>
      )}
    </Stack>
  );
}
