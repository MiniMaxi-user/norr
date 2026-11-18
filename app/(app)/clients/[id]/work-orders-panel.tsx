"use client";

import { useMemo } from "react";
import { StatusText, WebDataTableCard, toneFromColor, type WebColumn } from "@yourorg/ui/web-client";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { CreateWorkOrderButton } from "@/app/(app)/work-orders/components/create-work-order-button";
import { formatDateTimeWeb } from "@/lib/format/web";
import { CLOSED_WORK_ORDER_STATUS_VALUES } from "./client-timeline";

export interface WorkOrdersPanelProps {
  clientId: string;
  workOrders: WorkOrderRecord[];
  /** `can(actor, "planning", "create")` resolved once by `page.tsx` — gates
   * this tab's own "+ Work order" button. */
  canCreate: boolean;
}

const isClosed = (order: WorkOrderRecord) =>
  CLOSED_WORK_ORDER_STATUS_VALUES.includes(order.work_order_status?.value ?? "");

/**
 * Work Orders tab (docs/ARCHITECTURE.md "Relational detail pages"; design-
 * system table pattern, issue #222) — every job dispatched against this
 * client, one card with a FilterBar: Type / Status / Priority dropdowns and
 * Open · Done · All (default Open). Rows link to the Work Orders module's
 * detail page; running jobs get the attention background. "+ Work order" opens
 * the same relation picker as before, client pre-filled.
 */
export function WorkOrdersPanel({ clientId, workOrders, canCreate }: WorkOrdersPanelProps) {
  const columns = useMemo<WebColumn<WorkOrderRecord>[]>(
    () => [
      {
        id: "number",
        header: "Number",
        primary: true,
        mono: true,
        sortValue: (order) => order.work_order_number,
        render: (order) => order.work_order_number,
      },
      {
        id: "reference",
        header: "External reference",
        sortValue: (order) => order.external_reference ?? "",
        render: (order) => order.external_reference ?? "—",
      },
      {
        id: "type",
        header: "Type",
        sortValue: (order) => order.work_order_type?.label ?? "",
        render: (order) => order.work_order_type?.label ?? "—",
      },
      {
        id: "status",
        header: "Status",
        sortValue: (order) => order.work_order_status?.label ?? "",
        render: (order) =>
          order.work_order_status ? (
            <StatusText tone={toneFromColor(order.work_order_status.color)}>{order.work_order_status.label}</StatusText>
          ) : (
            "—"
          ),
      },
      {
        id: "scheduled",
        header: "Scheduled",
        sortValue: (order) => order.scheduled_at,
        render: (order) => formatDateTimeWeb(order.scheduled_at),
      },
    ],
    [],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "type",
        label: "Type",
        getOptions: (order: WorkOrderRecord) =>
          order.work_order_type ? [{ value: order.work_order_type.value, label: order.work_order_type.label }] : [],
      },
      {
        id: "status",
        label: "Status",
        getOptions: (order: WorkOrderRecord) =>
          order.work_order_status
            ? [{ value: order.work_order_status.value, label: order.work_order_status.label }]
            : [],
      },
      {
        id: "priority",
        label: "Priority",
        getOptions: (order: WorkOrderRecord) =>
          order.work_order_priority
            ? [{ value: order.work_order_priority.value, label: order.work_order_priority.label }]
            : [],
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show work orders",
      defaultValue: "open",
      options: [
        { value: "open", label: "Open", match: (order: WorkOrderRecord) => !isClosed(order) },
        { value: "done", label: "Done", match: isClosed },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  return (
    <WebDataTableCard
      title="Work orders"
      meta={`${workOrders.length} · ${workOrders.filter((order) => !isClosed(order)).length} open`}
      rows={workOrders}
      getRowKey={(order) => order.id}
      columns={columns}
      searchText={(order) =>
        [
          order.work_order_number,
          order.external_reference,
          order.description,
          order.work_order_type?.label,
          order.work_order_status?.label,
        ]
          .filter(Boolean)
          .join(" ")
      }
      noun="work orders"
      dropdowns={dropdowns}
      segment={segment}
      urlPrefix="workorders"
      defaultSort={{ columnId: "scheduled", direction: "desc" }}
      rowHref={(order) => `/work-orders/${order.id}`}
      rowLabel={(order) => order.work_order_number}
      isAttention={(order) => order.work_order_status?.value === "in_progress"}
      add={canCreate ? <CreateWorkOrderButton clientId={clientId} label="+ Work order" filterBar /> : undefined}
      emptyAction={canCreate ? "Use + Work order to dispatch the first job." : undefined}
    />
  );
}
