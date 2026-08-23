"use client";

import { useRouter } from "next/navigation";
import { Badge, EmptyState, Table } from "@yourorg/ui";
import { CalendarDays } from "@yourorg/ui/icons";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";

export interface WorkOrdersPanelProps {
  workOrders: WorkOrderRecord[];
}

function formatScheduledAt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Read-only "Work Orders" tab on the Client detail page
 * (docs/ARCHITECTURE.md "Relational detail pages") — every job dispatched
 * against this client, across every one of its sites/assets, each row
 * linking to the real Work Orders module's detail page.
 *
 * Deliberately flat and read-only, unlike the Assets tab (no per-site
 * `Disclosure` grouping, no create-in-context action here): this task's
 * scope is surfacing *visibility* of the relationship, not duplicating the
 * Work Orders module's own create/edit/delete affordances onto the Client
 * page — those stay on `/work-orders` and `/work-orders/[id]`.
 */
export function WorkOrdersPanel({ workOrders }: WorkOrdersPanelProps) {
  const router = useRouter();

  if (workOrders.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays />}
        heading="No work orders yet"
        text="Jobs dispatched for this client will show up here."
      />
    );
  }

  return (
    <Table>
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell>Title</Table.HeaderCell>
          <Table.HeaderCell align="center">Status</Table.HeaderCell>
          <Table.HeaderCell>Scheduled</Table.HeaderCell>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {workOrders.map((workOrder) => (
          <Table.Row key={workOrder.id} onClick={() => router.push(`/work-orders/${workOrder.id}`)}>
            <Table.Cell>{workOrder.title}</Table.Cell>
            <Table.Cell align="center">
              <Badge color={workOrder.work_order_status?.color} variant="muted">
                {workOrder.work_order_status?.label ?? "—"}
              </Badge>
            </Table.Cell>
            <Table.Cell>{formatScheduledAt(workOrder.scheduled_at)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}
