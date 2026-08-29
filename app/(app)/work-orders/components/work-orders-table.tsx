"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Stack, Table, Text } from "@yourorg/ui";
import type { WorkOrderRecord } from "../actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { DeleteWorkOrderDialog } from "./delete-work-order-dialog";
import { formatDateTime } from "@/lib/format/date";

export interface WorkOrdersTableProps {
  workOrders: WorkOrderRecord[];
  clientNameById: Map<string, string>;
  memberById: Map<string, OrgMemberRecord>;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * List view table for Work Orders — same shape as
 * `app/(app)/assets/components/assets-table.tsx`: client-side search over
 * the current page, row click navigates to the detail page, row-level Edit
 * navigates to a real page (`/work-orders/[id]/edit`, docs/ARCHITECTURE.md
 * "Popup vs. full page"), Delete stays a lightweight confirm `Dialog`.
 */
export function WorkOrdersTable({ workOrders, clientNameById, memberById, canEdit, canDelete }: WorkOrdersTableProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [deletingWorkOrder, setDeletingWorkOrder] = useState<WorkOrderRecord | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workOrders;
    return workOrders.filter((workOrder) =>
      [
        workOrder.title,
        clientNameById.get(workOrder.client_id),
        workOrder.work_order_status?.label,
        workOrder.work_order_priority?.label,
        workOrder.assigned_to ? memberDisplayName(memberById.get(workOrder.assigned_to)) : undefined,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(q)),
    );
  }, [workOrders, query, clientNameById, memberById]);

  const showActionsColumn = canEdit || canDelete;

  return (
    <>
      <Stack gap="md">
        <Input
          aria-label="Search work orders on this page"
          placeholder="Search by title, client, status, assignee…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <Table stickyHeader maxHeight="65vh">
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Title</Table.HeaderCell>
              <Table.HeaderCell>Client</Table.HeaderCell>
              <Table.HeaderCell align="center">Status</Table.HeaderCell>
              <Table.HeaderCell align="center">Priority</Table.HeaderCell>
              <Table.HeaderCell>Assigned to</Table.HeaderCell>
              <Table.HeaderCell>Scheduled</Table.HeaderCell>
              {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {filtered.map((workOrder) => (
              <Table.Row key={workOrder.id} onClick={() => router.push(`/work-orders/${workOrder.id}`)}>
                <Table.Cell>{workOrder.title}</Table.Cell>
                <Table.Cell>{clientNameById.get(workOrder.client_id) ?? "—"}</Table.Cell>
                <Table.Cell align="center">
                  <Badge color={workOrder.work_order_status?.color} variant="muted">
                    {workOrder.work_order_status?.label ?? "—"}
                  </Badge>
                </Table.Cell>
                <Table.Cell align="center">
                  {workOrder.work_order_priority ? (
                    <Badge color={workOrder.work_order_priority.color} variant="muted">
                      {workOrder.work_order_priority.label}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </Table.Cell>
                <Table.Cell>
                  {workOrder.assigned_to ? memberDisplayName(memberById.get(workOrder.assigned_to)) : "Unassigned"}
                </Table.Cell>
                <Table.Cell>{formatDateTime(workOrder.scheduled_at)}</Table.Cell>
                {showActionsColumn && (
                  <Table.Cell align="center">
                    <span className="ui-row-actions" onClick={(event) => event.stopPropagation()}>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/work-orders/${workOrder.id}/edit`)}
                        >
                          Edit
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => setDeletingWorkOrder(workOrder)}
                        >
                          Delete
                        </Button>
                      )}
                    </span>
                  </Table.Cell>
                )}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>

        {filtered.length === 0 && <Text tone="muted">No work orders match &ldquo;{query}&rdquo;.</Text>}
      </Stack>

      {deletingWorkOrder && (
        <DeleteWorkOrderDialog
          workOrder={deletingWorkOrder}
          open
          onOpenChange={(next) => !next && setDeletingWorkOrder(null)}
        />
      )}
    </>
  );
}
