"use client";

import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";

export interface WorkOrderQuickViewSite {
  address_line1: string | null;
  city: string | null;
}

export interface WorkOrderQuickViewProps {
  workOrder: WorkOrderRecord | null;
  clientName: string;
  site: WorkOrderQuickViewSite | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Small read-only popup (product feedback, 2026-09-17) shown when clicking a
 * work item on the Planning board — a scheduled block in `PlanningGrid`, or
 * a backlog card's info button in `PlanningBacklog` — so a planner can check
 * who/where/what without leaving the board. This replaces the grid's old
 * click-on-a-scheduled-block-to-unschedule behavior: a scheduled item is now
 * only ever moved back to the backlog by dragging it there (see
 * `planning-screen.tsx`'s `performUnschedule`).
 */
export function WorkOrderQuickView({ workOrder, clientName, site, onOpenChange }: WorkOrderQuickViewProps) {
  return (
    <Dialog open={workOrder != null} onOpenChange={onOpenChange} size="sm">
      {workOrder && (
        <>
          <Dialog.Header>
            <Heading level={3}>{workOrder.title}</Heading>
          </Dialog.Header>
          <Dialog.Body>
            <Stack gap="md">
              <Stack gap="xs">
                <Text tone="muted">Client</Text>
                <Text>{clientName}</Text>
              </Stack>
              <Stack gap="xs">
                <Text tone="muted">Site</Text>
                <Text>{formatSiteAddressShort(site) ?? "No site linked"}</Text>
              </Stack>
              <Stack gap="xs">
                <Text tone="muted">Asset</Text>
                <Text>
                  {workOrder.asset
                    ? workOrder.asset.name + (workOrder.asset.asset_model?.name ? ` · ${workOrder.asset.asset_model.name}` : "")
                    : "No asset linked"}
                </Text>
              </Stack>
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </Dialog.Footer>
        </>
      )}
    </Dialog>
  );
}
