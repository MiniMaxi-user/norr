import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, canAny, can, type PermissionActor } from "@/lib/rbac/permissions";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { getActivity } from "../actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { getAsset } from "@/app/(app)/assets/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listWorkOrders } from "@/app/(app)/work-orders/actions";
import { listActivityNotes } from "../notes-actions";
import { listActivityEvents } from "../history-actions";
import { listActivitySubtypes } from "../subtypes-actions";
import { listSolutionSubtypes } from "../solution-subtype-actions";
import { ACTIVITY_DETAIL_VIEW_KEY } from "../components/constants";
import { ActivityScreen, type ActivityDetailTab } from "../components/activity-screen";

const TAB_IDS: ActivityDetailTab[] = ["overview", "notes", "workorders"];

export const metadata = { title: "Activity" };

interface ActivityDetailPageProps {
  params: Promise<{ id: string }>;
  /** `?tab=notes` etc. deep-links straight to a tab. */
  searchParams: Promise<{ tab?: string }>;
}

/**
 * Activity detail page — renders the same shared `ActivityScreen`
 * (`../components/activity-screen.tsx`, `mode="edit"`) that `/activities/new`
 * renders with `mode="create"` (web design system, issue #222). Overview +
 * Notes / Work orders tabs; one Edit button for a caller with update rights.
 *
 * `readOnly` (exactly `!canEdit` below) omits the Edit button and every other
 * write affordance for a `finance`/`administratie` viewer (plain `read`) —
 * never a 404, never a disabled-but-technically-interactive control RLS would
 * just reject.
 */
export default async function ActivityDetailPage({ params, searchParams }: ActivityDetailPageProps) {
  const { id } = await params;
  const { tab: requestedTab } = await searchParams;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "activities"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "activities")) notFound();

  const activityResult = await getActivity(id);
  if (!activityResult.data) notFound();
  const activity = activityResult.data.activity;

  const canEdit = canAny(actor, "activities", ["update", "update_own"]);
  const canDelete = can(actor, "activities", "delete");
  // "create"/"update" are always granted together in `activities`' own
  // permission matrix (owner/planner get both unscoped, engineer gets
  // neither unscoped — only `create_own`/`update_own`) — see
  // `getActivityFormContext` in `../actions.ts`, which this mirrors rather
  // than re-fetches.
  const canAssignOthers = can(actor, "activities", "create");

  // "+ Work order" (issue #87) — gated on the (separately-entitled) `planning`
  // module, same pattern `app/(app)/activities/page.tsx` already uses.
  const planningEnabled = await hasFeature(session.organization, "planning");
  const canAccessPlanning = planningEnabled && canAccessModule(actor, "planning");
  const canCreateWorkOrder = canAccessPlanning && can(actor, "planning", "create");
  // Work orders tab (issue #118) — only fetched/rendered for a caller who can
  // read the `planning` module at all.
  const canViewWorkOrders = canAccessPlanning && canAny(actor, "planning", ["read", "read_own"]);

  const [
    clientResult,
    assetResult,
    membersResult,
    typesResult,
    statusesResult,
    activitySubtypesResult,
    solutionSubtypesResult,
    clientsResult,
    workOrdersResult,
    notesResult,
    eventsResult,
    lastUsedTab,
  ] = await Promise.all([
    getClient(activity.client_id),
    activity.asset_id ? getAsset(activity.asset_id) : Promise.resolve(null),
    listOrgMembers("activities"),
    listReferenceItems("activity_type"),
    listReferenceItems("activity_status"),
    // Activity/Solution subtype trees (issues #134/#138) — fetched once
    // server-side, always for any caller who can view the activity.
    listActivitySubtypes(),
    listSolutionSubtypes(),
    // Client picker — skipped for a read-only viewer ("don't fetch what can't
    // render").
    canEdit ? listClients({ limit: 200 }) : Promise.resolve(null),
    canViewWorkOrders ? listWorkOrders({ sourceActivityId: activity.id }) : Promise.resolve(null),
    // Notes/history — always fetched for any caller who can view the activity
    // at all (the same gate `getActivity` above already enforces).
    listActivityNotes(activity.id),
    listActivityEvents(activity.id),
    preferencesStore.getLastUsedView(session.userId, ACTIVITY_DETAIL_VIEW_KEY),
  ]);

  const client = clientResult.data?.client ?? null;
  const asset = assetResult?.data?.asset ?? null;
  const members = membersResult.data?.members ?? [];
  const activityTypes = typesResult.data?.items ?? [];
  const activityStatuses = statusesResult.data?.items ?? [];
  const activitySubtypes = activitySubtypesResult.data?.subtypes ?? [];
  const solutionSubtypes = solutionSubtypesResult.data?.subtypes ?? [];
  const clients = clientsResult?.data?.clients ?? [];
  const linkedWorkOrders = canViewWorkOrders ? (workOrdersResult?.data?.workOrders ?? []) : undefined;
  const notes = notesResult.data?.notes ?? [];
  const events = eventsResult.data?.events ?? [];

  // `?tab=` (explicit deep link) beats the last-used-view cookie; either
  // falls back to Overview when that tab does not exist for this actor.
  const available = (tab: string | null | undefined): ActivityDetailTab | null => {
    if (!tab || !TAB_IDS.includes(tab as ActivityDetailTab)) return null;
    if (tab === "workorders") return linkedWorkOrders === undefined ? null : "workorders";
    if (tab === "notes") return canEdit || notes.length > 0 ? "notes" : null;
    return tab as ActivityDetailTab;
  };

  return (
    <ActivityScreen
      key={activity.updated_at}
      mode="edit"
      breadcrumbItems={[
        { label: "Activities", href: "/activities" },
        // Activities have no number: a short id fragment stands in (same
        // placeholder the linked work-order rows used before).
        { label: activity.activity_number, mono: true },
      ]}
      defaultTab={available(requestedTab) ?? available(lastUsedTab) ?? "overview"}
      activity={activity}
      client={client}
      asset={asset}
      readOnly={!canEdit}
      clients={clients}
      activityTypes={activityTypes}
      activityStatuses={activityStatuses}
      activitySubtypes={activitySubtypes}
      solutionSubtypes={solutionSubtypes}
      members={members}
      canAssignOthers={canAssignOthers}
      canDelete={canDelete}
      canCreateWorkOrder={canCreateWorkOrder}
      linkedWorkOrders={linkedWorkOrders}
      notes={notes}
      events={events}
    />
  );
}
