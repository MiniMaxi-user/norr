import { listTeamMembers } from "@/lib/team/actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
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
 *
 * `listArticlesForSelect` (issue #93) is fetched unconditionally alongside
 * it — cheap (unpaginated, active-only) and needed the moment any `engineer`
 * row's `EditTeamMemberDialog` opens; a failure here is likewise non-fatal,
 * `EditTeamMemberDialog`'s "Custom rate" section just renders with an empty
 * article list rather than blocking the whole Team screen.
 *
 * `listReferenceItems("region")` (issue #164, Planning module) is fetched the
 * same "cheap, unconditional, non-fatal" way for `EditTeamMemberDialog`'s
 * Region `<Select>` — see `TeamMemberRecord.regionId`'s own doc comment in
 * `lib/team/actions.ts` for why every row (not just engineers) can carry one.
 */
export async function TeamBoard({ canWrite, currentUserId }: { canWrite: boolean; currentUserId: string }) {
  const [result, articlesResult, regionsResult] = await Promise.all([
    listTeamMembers(),
    listArticlesForSelect(),
    listReferenceItems("region"),
  ]);

  return (
    <TeamManager
      members={result.data?.members ?? []}
      pendingInvites={result.data?.pendingInvites ?? []}
      loadError={result.error}
      canWrite={canWrite}
      currentUserId={currentUserId}
      articles={articlesResult.data?.articles ?? []}
      regions={regionsResult.data?.items ?? []}
    />
  );
}
