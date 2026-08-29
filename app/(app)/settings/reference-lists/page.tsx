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
  // Article Groups (issue #92) are gated on the `articles` RBAC module, not
  // `settings` — `articles` is the FIRST module where `administratie` gets
  // full CRUD alongside `owner` (see `lib/rbac/permissions.ts`'s comment on
  // that module), unlike every other tab on this board (all owner-only via
  // `settings`). Threaded down separately so an `administratie` user sees
  // working Add/Edit/Delete affordances on the Article Groups tab even
  // though they're read-only on every other tab here.
  const canWriteArticleGroups = can(actor, "articles", "create");

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
        <ReferenceListsBoard canWrite={canWrite} canWriteArticleGroups={canWriteArticleGroups} />
      </Suspense>
    </Stack>
  );
}
