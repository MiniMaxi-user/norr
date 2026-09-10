import { OverviewHeroBand, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { listActivitySubtypes } from "@/app/(app)/activities/subtypes-actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { ActivitySubtypeManager } from "../components/activity-subtype-manager";

export const metadata = { title: "Activity Subtypes" };

/**
 * "Activity Subtypes" settings leaf (issues #134/#138) — same shape as
 * `../asset-models/page.tsx`/`../article-groups/page.tsx`: a single async
 * `page.tsx`, no Suspense (a couple of lightweight queries, not heavy enough
 * to stream around). The `"settings"` feature/module gate itself already ran
 * in `app/(app)/settings/layout.tsx` before this page could render — only
 * `canWrite` is computed here.
 *
 * Gated on the `settings` RBAC module (owner CRUD, everyone else read-only) —
 * NOT `articles` like `../article-groups/page.tsx` (that page's
 * `administratie`-also-writes exception is specific to the Articles module).
 * `activity_subtypes`' RLS is owner-only writes with zero can()-vs-RLS gap
 * against `settings` — see `subtypes-actions.ts`'s own module comment.
 */
export default async function ActivitySubtypesPage() {
  const session = await getCurrentSession();
  const actor: PermissionActor = { role: session?.role ?? null, isPlatformAdmin: session?.isPlatformAdmin ?? false };
  const canWrite = can(actor, "settings", "create");

  const [subtypesResult, typeResult] = await Promise.all([listActivitySubtypes(), listReferenceItems("activity_type")]);

  return (
    <Stack gap="lg">
      <OverviewHeroBand
        title="Activity Subtypes"
        subtitle="Hierarchical, unlimited-depth subtypes for Activities — each top-level subtype is tied to an Activity Type."
      />
      <ActivitySubtypeManager
        subtypes={subtypesResult.data?.subtypes ?? []}
        typeItems={typeResult.data?.items ?? []}
        loadError={subtypesResult.error ?? typeResult.error}
        canWrite={canWrite}
      />
    </Stack>
  );
}
