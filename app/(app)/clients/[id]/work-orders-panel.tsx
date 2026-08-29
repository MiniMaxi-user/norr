"use client";

import { useRouter } from "next/navigation";
import { Badge, LinkedRecordsTable } from "@yourorg/ui";
import { CalendarDays } from "@yourorg/ui/icons";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { formatDateTime } from "./format-date";

export interface WorkOrdersPanelProps {
  workOrders: WorkOrderRecord[];
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

  return (
    <LinkedRecordsTable
      records={workOrders}
      getKey={(workOrder) => workOrder.id}
      onRowClick={(workOrder) => router.push(`/work-orders/${workOrder.id}`)}
      emptyIcon={<CalendarDays />}
      emptyHeading="No work orders yet"
      emptyText="Jobs dispatched for this client will show up here."
      columns={[
        { header: "Title", render: (workOrder) => workOrder.title },
        {
          header: "Status",
          align: "center",
          render: (workOrder) => (
            <Badge color={workOrder.work_order_status?.color} variant="muted">
              {workOrder.work_order_status?.label ?? "—"}
            </Badge>
          ),
        },
        { header: "Scheduled", render: (workOrder) => formatDateTime(workOrder.scheduled_at) },
      ]}
    />
  );
}
