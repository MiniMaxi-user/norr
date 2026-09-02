"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, EmptyState, RowCard, SectionHeader, Stack, Text } from "@yourorg/ui";
import { ClipboardList } from "@yourorg/ui/icons";
import type { ActivityRecord } from "../actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { formatDateTime } from "@/lib/format/date";

export interface ActivityLinkedWorkOrdersProps {
  activity: ActivityRecord;
  workOrders: WorkOrderRecord[];
  /** `can(actor, "planning", "create")`, already gated behind `planning`
   * being entitled/accessible at all — same prop `ActivityScreen`/
   * `[id]/page.tsx` already threaded through pre-#118, just consumed here
   * now instead of by the deleted standalone `CreateWorkOrderCallout`. */
  canCreateWorkOrder?: boolean;
}

/**
 * "Linked work orders" section (`.design-handoff/melding_detail/README.md`)
 * — a plain `SectionHeader` + `RowCard` list, no `Card` frame (same flat-
 * section convention every other Pattern A section on this page uses).
 * Never rendered at all (not merely empty) for a caller who can't read the
 * `planning` module, per `[id]/page.tsx`'s own "don't fetch/pass what can't
 * render" gate — see `ActivityScreen`'s own render site.
 *
 * The header's own "+ Work order" button (issue #118) REPLACES the old
 * standalone `CreateWorkOrderCallout` card that used to sit right below the
 * hero — same exact navigation (`clientId`/`assetId`/`activityId` query
 * params into `/work-orders/new`), just moved here per the design handoff
 * ("dit is de enige plek waar een werkorder wordt aangemaakt").
 *
 * `WorkOrderRecord` has no human-readable order number/code column (see
 * `history-actions.ts`'s own `ShallowWorkOrderRecord` doc comment) — the
 * `WO-XXXXXXXX` shown per row is a short id-fragment placeholder, a judgment
 * call documented here rather than a real generated code; swap this out if/
 * when Work Orders ever grows a real one.
 */
export function ActivityLinkedWorkOrders({ activity, workOrders, canCreateWorkOrder }: ActivityLinkedWorkOrdersProps) {
  const router = useRouter();

  function handleCreateWorkOrder() {
    const params = new URLSearchParams();
    params.set("clientId", activity.client_id);
    if (activity.asset_id) params.set("assetId", activity.asset_id);
    params.set("activityId", activity.id);
    router.push(`/work-orders/new?${params.toString()}`);
  }

  const addButton = canCreateWorkOrder && (
    <Button type="button" variant="primary" size="sm" onClick={handleCreateWorkOrder}>
      + Work order
    </Button>
  );

  return (
    <Stack gap="md">
      <SectionHeader
        icon={ClipboardList}
        title={`Linked work orders${workOrders.length > 0 ? ` (${workOrders.length})` : ""}`}
        actions={addButton}
      />

      {workOrders.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          heading="No work orders yet"
          text="Nothing has been scheduled from this activity yet."
          action={addButton || undefined}
        />
      ) : (
        <Stack gap="xs">
          {workOrders.map((workOrder) => (
            <RowCard key={workOrder.id}>
              <Badge color={workOrder.work_order_status?.color} variant="muted">
                {workOrder.work_order_status?.label ?? "—"}
              </Badge>
              <div className="ui-row-main">
                <Stack gap="xs">
                  <Link href={`/work-orders/${workOrder.id}`} className="ui-row-title">
                    {workOrder.title}
                  </Link>
                  <Text tone="muted">
                    {`WO-${workOrder.id.slice(0, 8).toUpperCase()}`} ·{" "}
                    {workOrder.scheduled_at ? formatDateTime(workOrder.scheduled_at, { month: "long" }) : "Not scheduled"}
                  </Text>
                </Stack>
              </div>
              {/* No dedicated "quick-schedule" entry point exists yet
                  anywhere in the app (no Planning board route, no
                  deep-link query param on `/work-orders/[id]`) — both
                  buttons point at the work order's own detail page for now,
                  a known gap, not a new scheduling UI invented for this
                  page (out of scope for issue #118). */}
              <Button type="button" variant="outline" size="sm" onClick={() => router.push(`/work-orders/${workOrder.id}`)}>
                Plan
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => router.push(`/work-orders/${workOrder.id}`)}>
                Open
              </Button>
            </RowCard>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
