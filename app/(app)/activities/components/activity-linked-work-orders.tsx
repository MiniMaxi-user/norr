"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, EmptyState, RowCard, SectionHeader, Stack, Text, toast } from "@yourorg/ui";
import { ClipboardList } from "@yourorg/ui/icons";
import type { ActivityRecord } from "../actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { createWorkOrderFromActivity } from "../create-work-order-actions";
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
 * hero, per the design handoff ("dit is de enige plek waar een werkorder
 * wordt aangemaakt"). Issue #152 changed what clicking it does: it used to
 * navigate to `/work-orders/new?clientId=...&assetId=...&activityId=...`,
 * which sometimes immediately redirected on to the new work order's own
 * detail page. Now it calls `createWorkOrderFromActivity`
 * (`../create-work-order-actions.ts`) directly and stays put — the new row
 * just appears in the list below, and the caller decides for themselves,
 * via that row's own Open/Plan buttons, what to do with it next.
 *
 * `WorkOrderRecord` has no human-readable order number/code column (see
 * `history-actions.ts`'s own `ShallowWorkOrderRecord` doc comment) — the
 * `WO-XXXXXXXX` shown per row is a short id-fragment placeholder, a judgment
 * call documented here rather than a real generated code; swap this out if/
 * when Work Orders ever grows a real one.
 */
export function ActivityLinkedWorkOrders({ activity, workOrders, canCreateWorkOrder }: ActivityLinkedWorkOrdersProps) {
  const router = useRouter();
  const [isCreating, startCreating] = useTransition();

  function handleCreateWorkOrder() {
    startCreating(async () => {
      const result = await createWorkOrderFromActivity(activity.id);
      if (!result.data) {
        toast({
          tone: "danger",
          title: "Could not create a work order",
          description: result.error ?? "Something went wrong.",
        });
        return;
      }
      toast({ tone: "success", title: "Work order created", description: result.data.workOrder.title });
      router.refresh();
    });
  }

  const addButton = canCreateWorkOrder && (
    <Button type="button" variant="primary" size="sm" onClick={handleCreateWorkOrder} disabled={isCreating}>
      {isCreating ? "Creating…" : "+ Work order"}
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
