import { Suspense } from "react";
import { OverviewHeroBand, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { ChecklistTemplatesBoard } from "./checklist-templates-board";
import { ChecklistTemplatesSkeleton } from "./checklist-templates-skeleton";

export const metadata = { title: "Checklist templates" };

/**
 * Settings page for tenant-configured Checklist Templates (issue #14, second
 * stage; simplified in issue #110 stage 3 — the `"settings"` module/feature
 * gate now runs once in `app/(app)/settings/layout.tsx`, not per-leaf). Still
 * gated on `"settings"` (NOT `"checklists"`), per
 * `lib/checklist-templates/actions.ts`'s module comment — template CRUD is
 * configuration data at the same RBAC tier as `reference_lists`, distinct
 * from the `"checklists"` module that gates per-work-order instances.
 */
export default async function ChecklistTemplatesPage() {
  const session = await getCurrentSession();
  const actor: PermissionActor = { role: session?.role ?? null, isPlatformAdmin: session?.isPlatformAdmin ?? false };
  const canWrite = can(actor, "settings", "create");

  return (
    <Stack gap="lg">
      <OverviewHeroBand
        title="Checklist templates"
        subtitle={
          canWrite
            ? "Build reusable inspection/checklist forms that can be attached to any work order — add, rename, or remove a template, and manage the items inside it."
            : "Reusable inspection/checklist forms attachable to work orders — only the organization owner can change them."
        }
      />

      <Suspense fallback={<ChecklistTemplatesSkeleton />}>
        <ChecklistTemplatesBoard canWrite={canWrite} />
      </Suspense>
    </Stack>
  );
}
