import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { listTeamMembers } from "@/lib/team/actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { TeamMemberDetail } from "./team-member-detail";

export const metadata = { title: "Team member" };

interface TeamMemberDetailPageProps {
  params: Promise<{ userId: string }>;
}

/**
 * `/settings/team/[userId]` — a single team member's own detail page (issue
 * #192), replacing what used to be config buried inside
 * `EditTeamMemberDialog`. Per docs/ARCHITECTURE.md's "Popup vs. full page":
 * a `Dialog` is for a small, secondary sub-entity, and rate overrides
 * (issue #93) + region-linking (issue #164/#192, "op de monteur details
 * pagina") both specifically call for a real page, not a bigger popup.
 *
 * There is no single-member fetch action — `listTeamMembers()` already
 * exists and is cheap (unpaginated, one query per org), so this just finds
 * the matching row in its result, same "list already exists" reasoning
 * other leaf pages use rather than adding a redundant one-off query.
 * `notFound()` covers both a bad id and an id belonging to a different
 * org (RLS already scopes `listTeamMembers()` to the caller's own org, so a
 * cross-org id simply never appears in its result).
 *
 * The `"settings"` feature/module gate already ran in
 * `app/(app)/settings/layout.tsx`; only `canWrite` is computed here, same
 * `can(actor, "settings", "update")` gate `../page.tsx` (the Team list) uses
 * for its own edit affordances.
 */
export default async function TeamMemberDetailPage({ params }: TeamMemberDetailPageProps) {
  const { userId } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  const canWrite = can(actor, "settings", "update");

  const [membersResult, articlesResult, regionsResult] = await Promise.all([
    listTeamMembers(),
    listArticlesForSelect(),
    listReferenceItems("region"),
  ]);

  const member = membersResult.data?.members.find((candidate) => candidate.userId === userId);
  if (!member) notFound();

  return (
    <TeamMemberDetail
      member={member}
      articles={articlesResult.data?.articles ?? []}
      regions={regionsResult.data?.items ?? []}
      canWrite={canWrite}
      currentUserId={session.userId}
    />
  );
}
