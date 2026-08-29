import Link from "next/link";
import { Button, Card, EmptyState, Stack, Text, Toolbar } from "@yourorg/ui";
import { Bell } from "@yourorg/ui/icons";
import { listActivities } from "../actions";
import { listClients } from "@/app/(app)/clients/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { ActivitiesFilters } from "./activities-filters";
import { ActivitiesTable } from "./activities-table";
import { CreateActivityButton } from "./create-activity-button";

const LIST_PAGE_SIZE = 20;

export interface ActivitiesScreenProps {
  page: number;
  clientId?: string;
  statusId?: string;
  typeId?: string;
  actionHolderId?: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Threaded into `ActivitiesTable` -> `ActivityQuickViewDialog`'s "Create
   * work order" action (issue #87) — `hasFeature(org, "planning")` +
   * `canAccessModule`/`can(actor, "planning", "create")`, resolved once by
   * `app/(app)/activities/page.tsx`. */
  canCreateWorkOrder: boolean;
}

function buildPageHref(params: {
  page: number;
  clientId?: string;
  statusId?: string;
  typeId?: string;
  actionHolderId?: string;
}): string {
  const qs = new URLSearchParams();
  if (params.clientId) qs.set("clientId", params.clientId);
  if (params.statusId) qs.set("statusId", params.statusId);
  if (params.typeId) qs.set("typeId", params.typeId);
  if (params.actionHolderId) qs.set("actionHolderId", params.actionHolderId);
  if (params.page > 0) qs.set("page", String(params.page));
  const query = qs.toString();
  return query ? `/activities?${query}` : "/activities";
}

/**
 * The data-fetching heart of the Activities/"Meldingen" module — rendered
 * inside a `Suspense` boundary by `app/(app)/activities/page.tsx` so its
 * shaped skeleton shows while these `await`s resolve (route-level streaming,
 * per docs/ARCHITECTURE.md). Same plain paginated-list shape as
 * `WorkOrdersScreen` (no view switcher — this module has one view).
 *
 * For an engineer caller, `listActivities` already comes back scoped to
 * their own rows (`action_holder_id = auth.uid()`) via RLS — no extra
 * app-layer filter needed here, same note `WorkOrdersScreen` makes for
 * `listWorkOrders`.
 */
export async function ActivitiesScreen({
  page,
  clientId,
  statusId,
  typeId,
  actionHolderId,
  canCreate,
  canEdit,
  canDelete,
  canCreateWorkOrder,
}: ActivitiesScreenProps) {
  const offset = page * LIST_PAGE_SIZE;

  const [clientsResult, membersResult, typesResult, statusesResult, activitiesResult] = await Promise.all([
    listClients({ limit: 200 }),
    listOrgMembers(),
    listReferenceItems("activity_type"),
    listReferenceItems("activity_status"),
    listActivities({ clientId, statusId, typeId, actionHolderId, limit: LIST_PAGE_SIZE, offset }),
  ]);

  const clients = clientsResult.data?.clients ?? [];
  const members = membersResult.data?.members ?? [];
  const activityTypes = typesResult.data?.items ?? [];
  const activityStatuses = statusesResult.data?.items ?? [];

  const toolbar = (
    <Toolbar>
      <Toolbar.Section>
        <ActivitiesFilters
          clients={clients}
          members={members}
          activityTypes={activityTypes}
          activityStatuses={activityStatuses}
          selectedClientId={clientId}
          selectedActionHolderId={actionHolderId}
          selectedTypeId={typeId}
          selectedStatusId={statusId}
        />
      </Toolbar.Section>
      <Toolbar.Section align="end">{canCreate && <CreateActivityButton />}</Toolbar.Section>
    </Toolbar>
  );

  if (!activitiesResult.data) {
    return (
      <>
        {toolbar}
        <Card>
          <Text tone="danger">{activitiesResult.error ?? "Could not load activities."}</Text>
        </Card>
      </>
    );
  }

  const { activities, count } = activitiesResult.data;
  const hasFilters = Boolean(clientId || statusId || typeId || actionHolderId);

  if (activities.length === 0) {
    return (
      <>
        {toolbar}
        <EmptyState
          icon={<Bell />}
          heading={hasFilters ? "No activities match these filters" : "No activities yet"}
          text={
            hasFilters
              ? "Try a different status, type, client, or action holder filter."
              : "Log your first melding to start tracking it."
          }
          action={canCreate && !hasFilters ? <CreateActivityButton /> : undefined}
        />
      </>
    );
  }

  const hasPrev = offset > 0;
  const hasNext = offset + activities.length < count;

  return (
    <>
      {toolbar}
      <ActivitiesTable
        activities={activities}
        canEdit={canEdit}
        canDelete={canDelete}
        canCreateWorkOrder={canCreateWorkOrder}
      />
      <Stack gap="sm">
        <Text tone="muted">
          Showing {offset + 1}–{Math.min(offset + activities.length, count)} of {count}
        </Text>
        <span>
          {hasPrev ? (
            <Link href={buildPageHref({ page: page - 1, clientId, statusId, typeId, actionHolderId })}>
              <Button type="button" variant="outline" size="sm">
                Previous
              </Button>
            </Link>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled>
              Previous
            </Button>
          )}{" "}
          {hasNext ? (
            <Link href={buildPageHref({ page: page + 1, clientId, statusId, typeId, actionHolderId })}>
              <Button type="button" variant="outline" size="sm">
                Next
              </Button>
            </Link>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled>
              Next
            </Button>
          )}
        </span>
      </Stack>
    </>
  );
}
