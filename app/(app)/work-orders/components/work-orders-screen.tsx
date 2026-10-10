import Link from "next/link";
import { Button, Card, EmptyState, Stack, Text, Toolbar } from "@yourorg/ui";
import { CalendarDays } from "@yourorg/ui/icons";
import { listWorkOrders, type ListWorkOrdersOptions } from "../actions";
import { COMPLETED_STATUS_VALUES, REVIEW_STATUS_VALUES, WORK_ORDERS_TABS, type WorkOrdersTab } from "../tabs";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listClients, type ClientRecord } from "@/app/(app)/clients/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { CreateWorkOrderButton } from "./create-work-order-button";
import { WorkOrdersTable } from "./work-orders-table";
import { WorkOrdersTabs } from "./work-orders-tabs";

const LIST_PAGE_SIZE = 20;

const EMPTY_HEADINGS: Record<WorkOrdersTab, string> = {
  review: "No work orders to review",
  orders: "No open work orders",
  completed: "No completed work orders yet",
};

export interface WorkOrdersScreenProps {
  tab: WorkOrdersTab;
  page: number;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

function buildPageHref(tab: WorkOrdersTab, page: number): string {
  const qs = new URLSearchParams({ tab });
  if (page > 0) qs.set("page", String(page));
  const query = qs.toString();
  return query ? `/work-orders?${query}` : "/work-orders";
}

/** Status filter per overview tab (issue #207), resolved from the org's
 * `work_order_status` list by its fixed item values. */
function buildTabFilters(statusIdsByValue: Map<string, string>): Record<WorkOrdersTab, ListWorkOrdersOptions> {
  const idsFor = (values: readonly string[]) =>
    values.flatMap((value) => {
      const id = statusIdsByValue.get(value);
      return id ? [id] : [];
    });
  const reviewIds = idsFor(REVIEW_STATUS_VALUES);
  const completedIds = idsFor(COMPLETED_STATUS_VALUES);
  return {
    review: { statusIds: reviewIds },
    orders: { excludeStatusIds: [...reviewIds, ...completedIds] },
    completed: { statusIds: completedIds },
  };
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
export async function WorkOrdersScreen({ tab, page, canCreate, canEdit, canDelete }: WorkOrdersScreenProps) {
  const offset = page * LIST_PAGE_SIZE;

  const statusResult = await listReferenceItems("work_order_status");
  const statusIdsByValue = new Map((statusResult.data?.items ?? []).map((item) => [item.value, item.id]));
  const tabFilters = buildTabFilters(statusIdsByValue);
  const otherTabs = WORK_ORDERS_TABS.filter((other) => other !== tab);

  const [clientsResult, workOrdersResult, membersResult, ...otherTabResults] = await Promise.all([
    listClients({ limit: 200 }),
    listWorkOrders({ ...tabFilters[tab], limit: LIST_PAGE_SIZE, offset }),
    listOrgMembers(),
    ...otherTabs.map((other) => listWorkOrders({ ...tabFilters[other], limit: 1 })),
  ]);

  const counts: Partial<Record<WorkOrdersTab, number>> = { [tab]: workOrdersResult.data?.count };
  otherTabs.forEach((other, index) => {
    counts[other] = otherTabResults[index]?.data?.count;
  });

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
      <WorkOrdersTabs tab={tab} counts={counts}>
        {toolbar}
        <Card>
          <Text tone="danger">{workOrdersResult.error ?? "Could not load work orders."}</Text>
        </Card>
      </WorkOrdersTabs>
    );
  }

  const { workOrders, count } = workOrdersResult.data;

  if (workOrders.length === 0) {
    return (
      <WorkOrdersTabs tab={tab} counts={counts}>
        {toolbar}
        <EmptyState
          icon={<CalendarDays />}
          heading={EMPTY_HEADINGS[tab]}
          text={tab === "orders" ? "Create your first job to start dispatching work to your team." : undefined}
          action={canCreate && tab === "orders" ? <CreateWorkOrderButton /> : undefined}
        />
      </WorkOrdersTabs>
    );
  }

  const hasPrev = offset > 0;
  const hasNext = offset + workOrders.length < count;

  return (
    <WorkOrdersTabs tab={tab} counts={counts}>
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
            <Link href={buildPageHref(tab, page - 1)}>
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
            <Link href={buildPageHref(tab, page + 1)}>
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
    </WorkOrdersTabs>
  );
}
