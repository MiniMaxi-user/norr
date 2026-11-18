"use client";

import { useMemo, type ReactNode } from "react";
import { StatusText, WebDataTableCard, toneFromColor, type WebColumn } from "@yourorg/ui/web-client";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { CreateWorkOrderButton } from "@/app/(app)/work-orders/components/create-work-order-button";
import { formatDateTimeWeb } from "@/lib/format/web";
import { CLOSED_WORK_ORDER_STATUS_VALUES } from "./client-timeline";

export interface WorkOrdersPanelProps {
  /** Client tab: the "+ Work order" picker is pre-scoped to this client. */
  clientId?: string;
  workOrders: WorkOrderRecord[];
  /** `can(actor, "planning", "create")` resolved once by `page.tsx` — gates
   * this tab's own "+ Work order" button. */
  canCreate: boolean;
  /** Replaces the default "+ Work order" button (the asset page links to the
   * create page with the asset pre-filled). */
  add?: ReactNode;
  /** URL param namespace (default "workorders"). */
  urlPrefix?: string;
  /** Overview preview: max 5 rows, "Show all" in the card head, no add. */
  preview?: { onShowAll: () => void };
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
export function WorkOrdersPanel({
  clientId,
  workOrders,
  canCreate,
  add,
  urlPrefix = "workorders",
  preview,
}: WorkOrdersPanelProps) {
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
      title={preview ? "Recent work orders" : "Work orders"}
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
      urlPrefix={urlPrefix}
      maxRows={preview ? 5 : undefined}
      headerAction={
        preview ? (
          <button type="button" className="web-rail-link" onClick={preview.onShowAll}>
            Show all
          </button>
        ) : undefined
      }
      searchShortcut={preview ? false : undefined}
      defaultSort={{ columnId: "scheduled", direction: "desc" }}
      rowHref={(order) => `/work-orders/${order.id}`}
      rowLabel={(order) => order.work_order_number}
      isAttention={(order) => order.work_order_status?.value === "in_progress"}
      add={
        preview
          ? undefined
          : (add ??
            (canCreate && clientId ? <CreateWorkOrderButton clientId={clientId} label="+ Work order" filterBar /> : undefined))
      }
      emptyAction={canCreate && !preview ? "Use + Work order to dispatch the first job." : undefined}
    />
  );
}
