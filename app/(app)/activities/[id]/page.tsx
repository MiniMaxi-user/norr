import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, canAny, can, type PermissionActor } from "@/lib/rbac/permissions";
import { getActivity } from "../actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { getAsset } from "@/app/(app)/assets/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listWorkOrders } from "@/app/(app)/work-orders/actions";
import { listActivityNotes } from "../notes-actions";
import { listActivityEvents } from "../history-actions";
import { ActivityScreen } from "../components/activity-screen";

export const metadata = { title: "Activity" };

interface ActivityDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Activity detail page — renders the same shared `ActivityScreen`
 * (`../components/activity-screen.tsx`, `mode="edit"`) that `/activities/new`
 * renders with `mode="create"`, mirroring `app/(app)/work-orders/[id]/page.tsx`
 * exactly (issue #89's pattern, applied to Activities by issue #118). No
 * separate `/activities/[id]/edit` route — every field is inline-editable
 * directly here, through small section-scoped popups (`ActivityRelationsDialog`/
 * `ActivityStatusDialog`/the Assignment section's own dialog), same shape
 * `WorkOrderScreen` already established.
 *
 * Replaces the old `ActivityFormPanel` (`Dialog size="panel"`, deleted) —
 * see `docs/ARCHITECTURE.md`'s "Popup vs. full page" section for the full
 * history of why Activities carved out of, and issue #118 back into, the
 * standard top-level-module-gets-a-real-page rule.
 *
 * `readOnly` (exactly `!canEdit` below) hides every Edit affordance across
 * the hero/sections for a `finance`/`administratie` viewer (plain `read`) —
 * never a 404, never a disabled-but-technically-interactive control RLS
 * would just reject.
 */
export default async function ActivityDetailPage({ params }: ActivityDetailPageProps) {
  const { id } = await params;

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

  // "Create work order" call to action (issue #87) — gated on the
  // (separately-entitled) `planning` module, same pattern
  // `app/(app)/activities/page.tsx` already uses.
  const planningEnabled = await hasFeature(session.organization, "planning");
  const canAccessPlanning = planningEnabled && canAccessModule(actor, "planning");
  const canCreateWorkOrder = canAccessPlanning && can(actor, "planning", "create");
  // "Linked work orders" section (issue #118) — only fetched/rendered for a
  // caller who can read the `planning` module at all, same "don't
  // fetch/render what can't render" convention every other conditional
  // section in this app follows.
  const canViewWorkOrders = canAccessPlanning && canAny(actor, "planning", ["read", "read_own"]);

  const [
    clientResult,
    assetResult,
    membersResult,
    typesResult,
    statusesResult,
    clientsResult,
    workOrdersResult,
    notesResult,
    eventsResult,
  ] = await Promise.all([
    getClient(activity.client_id),
    activity.asset_id ? getAsset(activity.asset_id) : Promise.resolve(null),
    listOrgMembers("activities"),
    listReferenceItems("activity_type"),
    listReferenceItems("activity_status"),
    // Client picker — skipped for a read-only viewer, same "don't fetch
    // what can't render" reasoning `[id]/page.tsx`'s Work Orders sibling
    // already documents for its own `canEdit`-gated fetches.
    canEdit ? listClients({ limit: 200 }) : Promise.resolve(null),
    canViewWorkOrders ? listWorkOrders({ sourceActivityId: activity.id }) : Promise.resolve(null),
    // Notes/Historie (issue #118) — always fetched for any caller who can
    // view the activity at all (the same `canAny(actor, "activities",
    // ["read", "read_own"])` gate `getActivity` above already enforces),
    // unlike the `canEdit`/`canViewWorkOrders`-gated fetches above.
    listActivityNotes(activity.id),
    listActivityEvents(activity.id),
  ]);

  const client = clientResult.data?.client ?? null;
  const asset = assetResult?.data?.asset ?? null;
  const members = membersResult.data?.members ?? [];
  const activityTypes = typesResult.data?.items ?? [];
  const activityStatuses = statusesResult.data?.items ?? [];
  const clients = clientsResult?.data?.clients ?? [];
  const linkedWorkOrders = canViewWorkOrders ? (workOrdersResult?.data?.workOrders ?? []) : undefined;
  const notes = notesResult.data?.notes ?? [];
  const events = eventsResult.data?.events ?? [];

  return (
    <ActivityScreen
      key={activity.updated_at}
      mode="edit"
      breadcrumbItems={[{ label: "Meldingen", href: "/activities" }, { label: activity.activity_type?.label ?? "Activity" }]}
      activity={activity}
      client={client}
      asset={asset}
      readOnly={!canEdit}
      clients={clients}
      activityTypes={activityTypes}
      activityStatuses={activityStatuses}
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
