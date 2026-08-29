import { listTeamMembers } from "@/lib/team/actions";
import { TeamManager } from "./components/team-manager";

/**
 * The data-fetching heart of the Team screen, rendered inside a `Suspense`
 * boundary by `page.tsx` (docs/ARCHITECTURE.md "route-level streaming") so
 * the page shell (heading, back link) paints immediately — same shape
 * `ReferenceListsBoard`/`ChecklistTemplatesBoard` give their own Suspense
 * boundary.
 *
 * `listTeamMembers` failing is treated as non-fatal (same convention every
 * other manager on this settings surface uses): the board still renders
 * `TeamManager` with whatever it got (empty arrays) plus the error message,
 * instead of crashing the whole route.
 */
export async function TeamBoard({ canWrite, currentUserId }: { canWrite: boolean; currentUserId: string }) {
  const result = await listTeamMembers();

  return (
    <TeamManager
      members={result.data?.members ?? []}
      pendingInvites={result.data?.pendingInvites ?? []}
      loadError={result.error}
      canWrite={canWrite}
      currentUserId={currentUserId}
    />
  );
}
