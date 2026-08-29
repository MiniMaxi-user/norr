import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BackLink, Heading, Stack, Text } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { TeamBoard } from "./team-board";
import { TeamSkeleton } from "./team-skeleton";

export const metadata = { title: "Team" };

/**
 * Settings page for managing the org's own team (issue #88) — same shape as
 * `app/(app)/settings/reference-lists/page.tsx` /
 * `app/(app)/settings/checklist-templates/page.tsx`: gate on the `"settings"`
 * feature/module, then stream the actual data in via a `Suspense`-wrapped
 * Server Component board.
 *
 * `canWrite` here is `can(actor, "settings", "update")` rather than
 * `"create"` (what the other two settings pages use) — `lib/team/actions.ts`
 * gates its various writes across `create`/`update`/`delete`, but all three
 * resolve to the same "owner only" answer per the `settings` RBAC row (owner:
 * CRUD, everyone else: read-only), so which one this reads is cosmetic; each
 * dialog/action below still calls its own real server action, which
 * independently re-checks the specific permission it actually needs.
 */
export default async function TeamPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "settings"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "settings")) notFound();

  const canWrite = can(actor, "settings", "update");

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <div>
          <BackLink href="/settings">Back to settings</BackLink>
        </div>
        <Heading level={1}>Team</Heading>
        <Text tone="muted">
          {canWrite
            ? "Invite colleagues, manage their role, and reset access when needed."
            : "Everyone in your organization — only the owner can invite, change roles, or remove access."}
        </Text>
      </Stack>

      <Suspense fallback={<TeamSkeleton />}>
        <TeamBoard canWrite={canWrite} />
      </Suspense>
    </Stack>
  );
}
