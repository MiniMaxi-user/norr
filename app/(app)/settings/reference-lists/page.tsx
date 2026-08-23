import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BackLink, Heading, Stack, Text } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { ReferenceListsBoard } from "./reference-lists-board";
import { ReferenceListsSkeleton } from "./reference-lists-skeleton";

export const metadata = { title: "Reference lists" };

export default async function ReferenceListsPage() {
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
        <Heading level={1}>Reference lists</Heading>
        <Text tone="muted">
          {canWrite
            ? "Add, edit, reorder, or remove the values available in each picklist below."
            : "The values available in each picklist below — only the organization owner can change them."}
        </Text>
      </Stack>

      <Suspense fallback={<ReferenceListsSkeleton />}>
        <ReferenceListsBoard canWrite={canWrite} />
      </Suspense>
    </Stack>
  );
}
