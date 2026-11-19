"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  StatusText,
  WebDataTableCard,
  toneFromColor,
  type FilterOption,
  type WebColumn,
} from "@yourorg/ui/web-client";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import { formatDateTimeWeb } from "@/lib/format/web";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import type { WorkOrderRecord } from "../actions";
import { CreateWorkOrderButton } from "./create-work-order-button";
import { DeleteWorkOrderDialog } from "./delete-work-order-dialog";
import { WORK_ORDERS_DROPDOWN_IDS, WORK_ORDERS_PAGE_SIZE, WORK_ORDERS_STAGE_SEGMENT } from "./work-orders-query";

/** Client reference cell: a link in `text-link` (DS: clickable = coloured). */
function clientLink(clientId: string | null | undefined, name: string | undefined) {
  return clientId && name ? <Link href={`/clients/${clientId}`}>{name}</Link> : null;
}

export interface WorkOrdersTableCardProps {
  workOrders: WorkOrderRecord[];
  clientNameById: Map<string, string>;
  memberById: Map<string, OrgMemberRecord>;
  /** Filter choices. */
  statusOptions: FilterOption[];
  priorityOptions: FilterOption[];
  clientOptions: FilterOption[];
  assigneeOptions: FilterOption[];
  /** Clients for the "New work order" picker (empty-state link). */
  clients: ClientRecord[];
  total: number;
  unfilteredTotal?: number;
  page: number;
  canCreate: boolean;
  canDelete: boolean;
}

/**
 * Work Orders list table (list-page shell, issue #222): a `WebDataTableCard`
 * in server mode. `listWorkOrders` (driven by the URL params `q`, `status`,
 * `priority`, `client`, `assignee`, `seg`, `sort`, `dir`, `page`) returns the
 * filtered page; this component renders it. A row (or the Number link) opens
 * the work order's detail page, where editing happens inline. One ··· menu
 * per row: Open, and Delete (with delete rights, confirmed in
 * `DeleteWorkOrderDialog`).
 */
export function WorkOrdersTableCard({
  workOrders,
  clientNameById,
  memberById,
  statusOptions,
  priorityOptions,
  clientOptions,
  assigneeOptions,
  clients,
  total,
  unfilteredTotal,
  page,
  canCreate,
  canDelete,
}: WorkOrdersTableCardProps) {
  const [deletingWorkOrder, setDeletingWorkOrder] = useState<WorkOrderRecord | null>(null);

  const columns = useMemo<WebColumn<WorkOrderRecord>[]>(
    () => [
      { id: "number", header: "Number", primary: true, mono: true, sortable: true, render: (wo) => wo.work_order_number },
      { id: "reference", header: "External reference", render: (wo) => wo.external_reference },
      { id: "client", header: "Client", render: (wo) => clientLink(wo.client_id, clientNameById.get(wo.client_id)) },
      {
        id: "status",
        header: "Status",
        render: (wo) =>
          wo.work_order_status ? (
            <StatusText display="badge" tone={toneFromColor(wo.work_order_status.color)}>{wo.work_order_status.label}</StatusText>
          ) : null,
      },
      {
        id: "priority",
        header: "Priority",
        render: (wo) =>
          wo.work_order_priority ? (
            <StatusText display="auto" tone={toneFromColor(wo.work_order_priority.color)}>{wo.work_order_priority.label}</StatusText>
          ) : null,
      },
      {
        id: "assignee",
        header: "Assigned to",
        render: (wo) => (wo.assigned_to ? memberDisplayName(memberById.get(wo.assigned_to)) : "Unassigned"),
      },
      {
        id: "scheduled",
        header: "Scheduled",
        sortable: true,
        render: (wo) => (wo.scheduled_at ? formatDateTimeWeb(wo.scheduled_at) : null),
      },
    ],
    [clientNameById, memberById],
  );

  const dropdowns = useMemo(
    () => [
      { id: WORK_ORDERS_DROPDOWN_IDS.status, label: "Status", options: statusOptions },
      { id: WORK_ORDERS_DROPDOWN_IDS.priority, label: "Priority", options: priorityOptions },
      { id: WORK_ORDERS_DROPDOWN_IDS.client, label: "Client", options: clientOptions },
      { id: WORK_ORDERS_DROPDOWN_IDS.assignee, label: "Assigned to", options: assigneeOptions },
    ],
    [statusOptions, priorityOptions, clientOptions, assigneeOptions],
  );

  return (
    <>
      <WebDataTableCard<WorkOrderRecord>
        rows={workOrders}
        getRowKey={(wo) => wo.id}
        columns={columns}
        noun="work orders"
        dropdowns={dropdowns}
        segment={WORK_ORDERS_STAGE_SEGMENT}
        server={{ total, unfilteredTotal, page, pageSize: WORK_ORDERS_PAGE_SIZE }}
        defaultSort={{ columnId: "scheduled", direction: "asc" }}
        rowHref={(wo) => `/work-orders/${wo.id}`}
        rowLabel={(wo) => wo.work_order_number}
        rowActions={(wo) => [
          { key: "open", label: "Open", href: `/work-orders/${wo.id}` },
          ...(canDelete
            ? [
                { type: "separator" as const, key: "sep" },
                { key: "delete", label: "Delete…", danger: true, onSelect: () => setDeletingWorkOrder(wo) },
              ]
            : []),
        ]}
        emptyAction={canCreate ? <CreateWorkOrderButton webStyle="link" label="Create work order" clients={clients} /> : null}
      />
      {deletingWorkOrder ? (
        <DeleteWorkOrderDialog
          workOrder={deletingWorkOrder}
          open
          onOpenChange={(next) => !next && setDeletingWorkOrder(null)}
        />
      ) : null}
    </>
  );
}
