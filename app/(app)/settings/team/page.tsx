import { Suspense } from "react";
import { notFound } from "next/navigation";
import { OverviewHeroBand, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { TeamBoard } from "./team-board";
import { TeamSkeleton } from "./team-skeleton";

export const metadata = { title: "Team" };

/**
 * Settings page for managing the org's own team (issue #88; simplified in
 * issue #110 stage 3 — the `"settings"` feature/module gate now runs once in
 * `app/(app)/settings/layout.tsx`, not per-leaf). `session` is still needed
 * here (unlike the other simplified leaves) for `currentUserId`, so the
 * `getCurrentSession()` call stays.
 *
 * `canWrite` here is `can(actor, "settings", "update")` rather than
 * `"create"` (what the other settings leaves use) — `lib/team/actions.ts`
 * gates its various writes across `create`/`update`/`delete`, but all three
 * resolve to the same "owner only" answer per the `settings` RBAC row (owner:
 * CRUD, everyone else: read-only), so which one this reads is cosmetic; each
 * dialog/action below still calls its own real server action, which
 * independently re-checks the specific permission it actually needs.
 */
export default async function TeamPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  const canWrite = can(actor, "settings", "update");

  return (
    <Stack gap="lg">
      <OverviewHeroBand
        title="Team"
        subtitle={
          canWrite
            ? "Invite colleagues, manage their role, and reset access when needed."
            : "Everyone in your organization — only the owner can invite, change roles, or remove access."
        }
      />

      <Suspense fallback={<TeamSkeleton />}>
        <TeamBoard canWrite={canWrite} currentUserId={session.userId} />
      </Suspense>
    </Stack>
  );
}
