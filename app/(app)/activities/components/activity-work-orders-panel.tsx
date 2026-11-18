"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { StatusText, WebDataTableCard, toneFromColor, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { workOrderLabel } from "@/lib/format/work-order-label";
import { formatDateTimeWeb } from "@/lib/format/web";
import { createWorkOrderFromActivity } from "../create-work-order-actions";

export interface ActivityWorkOrdersPanelProps {
  activityId: string;
  workOrders: WorkOrderRecord[];
  /** `can(actor, "planning", "create")`, already gated behind `planning` being
   * entitled/accessible — gates "+ Work order". */
  canCreate: boolean;
}

const CLOSED_STATUS_VALUES = ["completed", "invoiced"];
const isClosed = (order: WorkOrderRecord) => CLOSED_STATUS_VALUES.includes(order.work_order_status?.value ?? "");

/**
 * Work orders tab of the Activity page (design system table pattern, issue
 * #222) — the jobs dispatched from this activity: one card with a FilterBar
 * (Type / Status dropdowns, Open · Done · All, default All so a fresh job is
 * never hidden). "+ Work order" creates a work order from this activity in
 * place (existing `createWorkOrderFromActivity`: you stay here and the new row
 * appears); a row opens the work order page. Never rendered for a caller who
 * cannot read the planning module.
 */
export function ActivityWorkOrdersPanel({ activityId, workOrders, canCreate }: ActivityWorkOrdersPanelProps) {
  const router = useRouter();
  const [creating, startCreating] = useTransition();

  function createWorkOrder() {
    startCreating(async () => {
      const result = await createWorkOrderFromActivity(activityId);
      if (!result.data) {
        toast({ tone: "danger", title: "Could not create a work order", description: result.error ?? "Something went wrong." });
        return;
      }
      toast({ tone: "success", title: "Work order created", description: result.data.workOrder.work_order_number });
      router.refresh();
    });
  }

  const columns = useMemo<WebColumn<WorkOrderRecord>[]>(
    () => [
      {
        id: "number",
        header: "Number",
        primary: true,
        mono: true,
        sortValue: (order) => order.work_order_number,
        render: (order) => workOrderLabel(order),
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
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show work orders",
      defaultValue: "all",
      options: [
        { value: "open", label: "Open", match: (order: WorkOrderRecord) => !isClosed(order) },
        { value: "done", label: "Done", match: isClosed },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  const rowActions = (order: WorkOrderRecord): WebMenuItem[] => [
    { key: "open", label: "Open work order", href: `/work-orders/${order.id}` },
  ];

  return (
    <div className="web-tab-stack">
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
        rowActions={rowActions}
        rowLabel={(order) => order.work_order_number}
        add={
          canCreate ? (
            <WebButton size="filter" onClick={createWorkOrder} loading={creating}>
              + Work order
            </WebButton>
          ) : undefined
        }
        emptyAction={canCreate ? "Use + Work order to dispatch the first job from this activity." : undefined}
      />
    </div>
  );
}
