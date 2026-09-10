import { OverviewHeroBand, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { listSolutionSubtypes } from "@/app/(app)/activities/solution-subtype-actions";
import { SolutionSubtypeManager } from "../components/solution-subtype-manager";

export const metadata = { title: "Solution Subtypes" };

/**
 * "Solution Subtypes" settings leaf (issues #134/#138) — same shape as
 * `../activity-subtypes/page.tsx`, minus the Activity Type reference-list
 * fetch: `solution_subtypes` is never linked to Type at any level. The
 * `"settings"` feature/module gate itself already ran in
 * `app/(app)/settings/layout.tsx` before this page could render — only
 * `canWrite` is computed here.
 */
export default async function SolutionSubtypesPage() {
  const session = await getCurrentSession();
  const actor: PermissionActor = { role: session?.role ?? null, isPlatformAdmin: session?.isPlatformAdmin ?? false };
  const canWrite = can(actor, "settings", "create");

  const result = await listSolutionSubtypes();

  return (
    <Stack gap="lg">
      <OverviewHeroBand
        title="Solution Subtypes"
        subtitle="Hierarchical, unlimited-depth subtypes describing how an Activity was resolved."
      />
      <SolutionSubtypeManager
        subtypes={result.data?.subtypes ?? []}
        loadError={result.error}
        canWrite={canWrite}
      />
    </Stack>
  );
}
