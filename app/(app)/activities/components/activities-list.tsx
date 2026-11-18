import { WebCard, WebDataTableEmpty, WebLinkButton, WebListPage } from "@yourorg/ui/web";
import { listClients } from "@/app/(app)/clients/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listActivities } from "../actions";
import { parseActivitiesQuery, type ActivitiesSearchParams } from "./activities-query";
import { ActivitiesTableCard } from "./activities-table-card";

/**
 * Async Server Component of `/activities`: fetches, then renders the
 * list-page shell (`WebListPage`) with the server-driven table. Rendered
 * inside `page.tsx`'s `Suspense` (fallback `WebListSkeleton`). One view only
 * (no view switcher).
 *
 * For an engineer caller, `listActivities` already comes back scoped to their
 * own rows (`action_holder_id = auth.uid()`) via RLS.
 */
export async function ActivitiesList({
  params,
  canCreate,
  canDelete,
}: {
  params: ActivitiesSearchParams;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const { page, options } = parseActivitiesQuery(params);

  const [result, clientsResult, membersResult, typesResult, statusesResult] = await Promise.all([
    listActivities(options),
    listClients({ limit: 200 }),
    listOrgMembers("activities"),
    listReferenceItems("activity_type"),
    listReferenceItems("activity_status"),
  ]);

  const primary = canCreate ? (
    <WebLinkButton variant="primary" href="/activities/new">
      New activity
    </WebLinkButton>
  ) : undefined;

  if (result.error || !result.data) {
    return (
      <WebListPage module="Activities" title="Activities" primary={primary}>
        <WebCard title="Activities">
          <WebDataTableEmpty>{result.error ?? "Could not load activities."}</WebDataTableEmpty>
        </WebCard>
      </WebListPage>
    );
  }

  const { activities, count, unfilteredCount } = result.data;

  return (
    <WebListPage module="Activities" title="Activities" count={unfilteredCount ?? count} primary={primary}>
      <ActivitiesTableCard
        activities={activities}
        total={count}
        unfilteredTotal={unfilteredCount}
        page={page}
        types={(typesResult.data?.items ?? []).map((item) => ({ value: item.id, label: item.label }))}
        statuses={(statusesResult.data?.items ?? []).map((item) => ({ value: item.id, label: item.label }))}
        clients={(clientsResult.data?.clients ?? []).map((client) => ({ value: client.id, label: client.name }))}
        actionHolders={(membersResult.data?.members ?? []).map((member) => ({
          value: member.id,
          label: memberDisplayName(member),
        }))}
        canCreate={canCreate}
        canDelete={canDelete}
      />
    </WebListPage>
  );
}
