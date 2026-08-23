import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BackLink, Heading, Stack, Text } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { ChecklistTemplatesBoard } from "./checklist-templates-board";
import { ChecklistTemplatesSkeleton } from "./checklist-templates-skeleton";

export const metadata = { title: "Checklist templates" };

/**
 * Settings page for tenant-configured Checklist Templates (issue #14, second
 * stage) — same shape as `app/(app)/settings/reference-lists/page.tsx`:
 * gated on the `"settings"` module/feature (NOT `"checklists"`), per
 * `lib/checklist-templates/actions.ts`'s module comment — template CRUD is
 * configuration data at the same RBAC tier as `reference_lists`, distinct
 * from the `"checklists"` module that gates per-work-order instances.
 */
export default async function ChecklistTemplatesPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "settings"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "settings")) notFound();

  const canWrite = can(actor, "settings", "create");

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <div>
          <BackLink href="/settings">Back to settings</BackLink>
        </div>
        <Heading level={1}>Checklist templates</Heading>
        <Text tone="muted">
          {canWrite
            ? "Build reusable inspection/checklist forms that can be attached to any work order — add, rename, or remove a template, and manage the items inside it."
            : "Reusable inspection/checklist forms attachable to work orders — only the organization owner can change them."}
        </Text>
      </Stack>

      <Suspense fallback={<ChecklistTemplatesSkeleton />}>
        <ChecklistTemplatesBoard canWrite={canWrite} />
      </Suspense>
    </Stack>
  );
}
