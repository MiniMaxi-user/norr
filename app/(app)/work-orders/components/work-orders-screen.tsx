import Link from "next/link";
import { Button, Card, EmptyState, Stack, Text, Toolbar } from "@yourorg/ui";
import { CalendarDays } from "@yourorg/ui/icons";
import { listWorkOrders } from "../actions";
import { listClients, type ClientRecord } from "@/app/(app)/clients/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { CreateWorkOrderButton } from "./create-work-order-button";
import { WorkOrdersTable } from "./work-orders-table";

const LIST_PAGE_SIZE = 20;

export interface WorkOrdersScreenProps {
  page: number;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

function buildPageHref(page: number): string {
  const qs = new URLSearchParams();
  if (page > 0) qs.set("page", String(page));
  const query = qs.toString();
  return query ? `/work-orders?${query}` : "/work-orders";
}

/**
 * The data-fetching heart of the Work Orders module — rendered inside a
 * `Suspense` boundary by `app/(app)/work-orders/page.tsx` so its shaped
 * skeleton shows while these `await`s resolve (route-level streaming, per
 * docs/ARCHITECTURE.md). A plain paginated list, deliberately no view
 * switcher (per this task's scope — the calendar/kanban/drag-and-drop
 * Planning/Dispatch board is separate, larger, follow-on work, see
 * docs/ROADMAP.md).
 *
 * For an engineer caller, `listWorkOrders` already comes back scoped to
 * their assigned rows via RLS (see `app/(app)/work-orders/actions.ts`'s
 * module comment) — no extra app-layer filter needed here.
 */
export async function WorkOrdersScreen({ page, canCreate, canEdit, canDelete }: WorkOrdersScreenProps) {
  const offset = page * LIST_PAGE_SIZE;

  const [clientsResult, workOrdersResult, membersResult] = await Promise.all([
    listClients({ limit: 200 }),
    listWorkOrders({ limit: LIST_PAGE_SIZE, offset }),
    listOrgMembers(),
  ]);

  const clients: ClientRecord[] = clientsResult.data?.clients ?? [];
  const clientNameById = new Map(clients.map((client) => [client.id, client.name]));
  const members = membersResult.data?.members ?? [];
  const memberById = new Map(members.map((member) => [member.id, member]));

  const toolbar = (
    <Toolbar>
      <Toolbar.Section>
        <Text tone="muted">
          {workOrdersResult.data ? `${workOrdersResult.data.count} work order${workOrdersResult.data.count === 1 ? "" : "s"}` : ""}
        </Text>
      </Toolbar.Section>
      <Toolbar.Section align="end">{canCreate && <CreateWorkOrderButton clients={clients} />}</Toolbar.Section>
    </Toolbar>
  );

  if (!workOrdersResult.data) {
    return (
      <>
        {toolbar}
        <Card>
          <Text tone="danger">{workOrdersResult.error ?? "Could not load work orders."}</Text>
        </Card>
      </>
    );
  }

  const { workOrders, count } = workOrdersResult.data;

  if (workOrders.length === 0) {
    return (
      <>
        {toolbar}
        <EmptyState
          icon={<CalendarDays />}
          heading="No work orders yet"
          text="Create your first job to start dispatching work to your team."
          action={canCreate ? <CreateWorkOrderButton /> : undefined}
        />
      </>
    );
  }

  const hasPrev = offset > 0;
  const hasNext = offset + workOrders.length < count;

  return (
    <>
      {toolbar}
      <WorkOrdersTable
        workOrders={workOrders}
        clientNameById={clientNameById}
        memberById={memberById}
        canEdit={canEdit}
        canDelete={canDelete}
      />
      <Stack gap="sm">
        <Text tone="muted">
          Showing {offset + 1}–{Math.min(offset + workOrders.length, count)} of {count}
        </Text>
        <span>
          {hasPrev ? (
            <Link href={buildPageHref(page - 1)}>
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
            <Link href={buildPageHref(page + 1)}>
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
