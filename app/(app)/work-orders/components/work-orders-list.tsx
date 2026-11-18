import { WebCard, WebDataTableEmpty, WebListPage } from "@yourorg/ui/web";
import { listClients, type ClientRecord } from "@/app/(app)/clients/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listWorkOrders, type WorkOrderRecord } from "../actions";
import { COMPLETED_STATUS_VALUES } from "../tabs";
import { CreateWorkOrderButton } from "./create-work-order-button";
import { parseWorkOrdersQuery, type WorkOrdersSearchParams } from "./work-orders-query";
import { WorkOrdersTableCard } from "./work-orders-table-card";

/** Distinct `id`/`label` pairs of one embedded reference item over the given
 * rows: the fallback filter choices when the picklist itself cannot be read
 * (it needs settings access). */
function optionsFromRows(
  workOrders: WorkOrderRecord[],
  pick: (workOrder: WorkOrderRecord) => { id: string; label: string } | null,
) {
  const seen = new Map<string, string>();
  for (const workOrder of workOrders) {
    const item = pick(workOrder);
    if (item && !seen.has(item.id)) seen.set(item.id, item.label);
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }));
}

/**
 * Async Server Component of `/work-orders`: fetches, then renders the
 * list-page shell (`WebListPage`) with the server-driven table. Rendered
 * inside `page.tsx`'s `Suspense` (fallback `WebListSkeleton`), so the header
 * streams in before the data.
 *
 * `listWorkOrders` runs with the filters/sort/page from the URL. For an
 * engineer caller it already comes back scoped to their assigned rows via RLS
 * (see `../actions.ts`'s module comment) — no extra app-layer filter here.
 */
export async function WorkOrdersList({
  params,
  canCreate,
  canDelete,
}: {
  params: WorkOrdersSearchParams;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [statusResult, priorityResult, clientsResult, membersResult] = await Promise.all([
    listReferenceItems("work_order_status"),
    listReferenceItems("work_order_priority"),
    listClients({ limit: 200 }),
    listOrgMembers(),
  ]);

  const statusItems = statusResult.data?.items ?? [];
  const completedStatusIds = statusItems
    .filter((item) => (COMPLETED_STATUS_VALUES as readonly string[]).includes(item.value))
    .map((item) => item.id);

  const clients: ClientRecord[] = clientsResult.data?.clients ?? [];
  const clientNameById = new Map(clients.map((client) => [client.id, client.name]));
  const members = membersResult.data?.members ?? [];
  const memberById = new Map(members.map((member) => [member.id, member]));

  // Members are not queryable from the action, so assignee search resolves
  // the typed text to member ids here.
  const needle = params.q?.trim().toLowerCase() ?? "";
  const searchAssigneeIds = needle
    ? members
        .filter((member) => `${memberDisplayName(member)} ${member.email}`.toLowerCase().includes(needle))
        .map((member) => member.id)
    : [];

  const { page, options } = parseWorkOrdersQuery(params, completedStatusIds, searchAssigneeIds);
  const result = await listWorkOrders(options);

  const primary = canCreate ? <CreateWorkOrderButton webStyle="primary" clients={clients} /> : undefined;

  if (!result.data) {
    return (
      <WebListPage module="Work orders" title="Work orders" primary={primary}>
        <WebCard title="Work orders">
          <WebDataTableEmpty>{result.error ?? "Could not load work orders."}</WebDataTableEmpty>
        </WebCard>
      </WebListPage>
    );
  }

  const { workOrders, count, unfilteredCount } = result.data;

  const statusOptions = statusResult.data
    ? statusItems.map((item) => ({ value: item.id, label: item.label }))
    : optionsFromRows(workOrders, (wo) => (wo.work_order_status ? { id: wo.status_id, label: wo.work_order_status.label } : null));
  const priorityOptions = priorityResult.data
    ? priorityResult.data.items.map((item) => ({ value: item.id, label: item.label }))
    : optionsFromRows(workOrders, (wo) =>
        wo.work_order_priority && wo.priority_id ? { id: wo.priority_id, label: wo.work_order_priority.label } : null,
      );
  const clientOptions = clients.map((client) => ({ value: client.id, label: client.name }));
  const assigneeOptions = members.map((member) => ({ value: member.id, label: memberDisplayName(member) }));

  return (
    <WebListPage module="Work orders" title="Work orders" count={unfilteredCount ?? count} primary={primary}>
      <WorkOrdersTableCard
        workOrders={workOrders}
        clientNameById={clientNameById}
        memberById={memberById}
        statusOptions={statusOptions}
        priorityOptions={priorityOptions}
        clientOptions={clientOptions}
        assigneeOptions={assigneeOptions}
        clients={clients}
        total={count}
        unfilteredTotal={unfilteredCount}
        page={page}
        canCreate={canCreate}
        canDelete={canDelete}
      />
    </WebListPage>
  );
}
