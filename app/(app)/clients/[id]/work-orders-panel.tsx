"use client";

import { useRouter } from "next/navigation";
import { Badge, LinkedRecordsTable, SectionHeader, Stack } from "@yourorg/ui";
import { CalendarDays, ClipboardList } from "@yourorg/ui/icons";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { CreateWorkOrderButton } from "@/app/(app)/work-orders/components/create-work-order-button";
import { formatDateTime } from "@/lib/format/date";

export interface WorkOrdersPanelProps {
  clientId: string;
  workOrders: WorkOrderRecord[];
  /** Same `can(actor, "planning", "create")` gate `page.tsx` already
   * resolves for the Activiteiten tab's "Create work order" action
   * (`canCreateWorkOrder`) — reused here for this tab's own "+ Work order"
   * button rather than adding a second, parallel permission check. */
  canCreate: boolean;
}

/**
 * "Work Orders" tab on the Client detail page (docs/ARCHITECTURE.md
 * "Relational detail pages") — every job dispatched against this client,
 * across every one of its sites/assets, each row linking to the real Work
 * Orders module's detail page.
 *
 * "+ Work order" (issue #113 follow-up) opens the exact same
 * `NewWorkOrderPickerDialog` (Client/Site/Asset required, Contract optional)
 * the standalone Work Orders overview's "New work order" button already
 * uses (issue #106) — via `CreateWorkOrderButton`'s existing `clientId` prop,
 * which locks/pre-fills the picker's Client field to this client rather than
 * leaving it open. Confirming the picker still hands off to the real
 * `/work-orders/new` create page (docs/ARCHITECTURE.md "Popup vs. full
 * page" — Work Orders stays a top-level module's own record, never a
 * `Dialog` create/edit surface); this tab's own row list stays otherwise
 * read-only (no inline edit/delete) — those actions stay on
 * `/work-orders/[id]`.
 */
export function WorkOrdersPanel({ clientId, workOrders, canCreate }: WorkOrdersPanelProps) {
  const router = useRouter();

  return (
    <Stack gap="md">
      <SectionHeader
        icon={ClipboardList}
        title="Work Orders"
        actions={canCreate && <CreateWorkOrderButton clientId={clientId} label="+ Work order" size="sm" />}
      />

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
    </Stack>
  );
}
