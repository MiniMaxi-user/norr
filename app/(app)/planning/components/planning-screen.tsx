"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Text } from "@yourorg/ui";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { scheduleWorkOrder, unscheduleWorkOrder } from "@/app/(app)/work-orders/planning-actions";
import { setLastUsedView } from "@/lib/preferences/actions";
import { PlanningTopbar } from "./planning-topbar";
import { PlanningBacklog } from "./planning-backlog";
import { PlanningGrid } from "./planning-grid";
import { formatDateParam, toOffsetIsoString } from "../date-utils";
import type { PlanningEngineer } from "../grouping";
import type { PlanningGroup, PlanningView } from "../types";

/** The Werkvoorraad type filter's default selection (issue #164 follow-up) —
 * `activity_type` `value`s, not labels (labels are tenant-editable text). */
const DEFAULT_TYPE_FILTER = new Set(["onderhoud", "inspectie", "storing"]);

export interface PlanningScreenProps {
  date: Date;
  view: PlanningView;
  group: PlanningGroup;
  regions: ReferenceListItemRecord[];
  activityTypes: ReferenceListItemRecord[];
  engineers: PlanningEngineer[];
  initialBacklog: WorkOrderRecord[];
  initialScheduled: WorkOrderRecord[];
  siteRegionById: Record<string, string | null>;
  clientNameById: Record<string, string>;
}

/**
 * Client shell for the Planning scheduler board (issue #164) — owns
 * date/view/group URL-param state and the shared drag/selection state, and
 * wires both the drag-and-drop handlers AND the non-drag click-to-select-
 * then-click-slot fallback to the SAME `scheduleWorkOrder`/
 * `unscheduleWorkOrder` Server Actions
 * (`app/(app)/work-orders/planning-actions.ts`).
 *
 * `backlogState`/`scheduledState` are optimistic local mirrors of the
 * server-fetched `initialBacklog`/`initialScheduled` props — same pattern
 * `app/(app)/clients/components/clients-kanban.tsx` established (move
 * immediately, revert on a failed server call, `router.refresh()` on
 * success to reconcile the Server Component's own data). A rejection from
 * either action (e.g. the server's authoritative overlap/half-hour-boundary
 * check catching something this component's own `../fit-check.ts` preview
 * missed) is always handled gracefully — reverted, surfaced as an inline
 * error — never assumed to have succeeded.
 */
export function PlanningScreen({
  date,
  view,
  group,
  regions,
  activityTypes,
  engineers,
  initialBacklog,
  initialScheduled,
  siteRegionById,
  clientNameById,
}: PlanningScreenProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [backlogState, setBacklogState] = useState(initialBacklog);
  const [scheduledState, setScheduledState] = useState(initialScheduled);
  useEffect(() => setBacklogState(initialBacklog), [initialBacklog]);
  useEffect(() => setScheduledState(initialScheduled), [initialScheduled]);

  const [draggingWorkOrder, setDraggingWorkOrder] = useState<WorkOrderRecord | null>(null);
  const [selectedBacklogWorkOrder, setSelectedBacklogWorkOrder] = useState<WorkOrderRecord | null>(null);
  // Multi-select: an EMPTY set means "Alle" (no filter, show every type,
  // including one a tenant adds later) — never a separate "all" sentinel
  // value. Defaults to Onderhoud/Inspectie/Storing (only the ones that
  // actually exist for this org, in case a tenant renamed/removed one),
  // matching the design's own 3 pill defaults — a tenant's other types
  // (Bel activiteit, Afspraak, ...) start unselected, one click away.
  const [typeFilter, setTypeFilter] = useState<Set<string>>(
    () => new Set(activityTypes.filter((type) => DEFAULT_TYPE_FILTER.has(type.value)).map((type) => type.value)),
  );
  const [error, setError] = useState<string | null>(null);

  function toggleTypeFilter(value: string) {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function clearTypeFilter() {
    setTypeFilter(new Set());
  }

  function pushParams(next: { date: Date; view: PlanningView; group: PlanningGroup }) {
    const params = new URLSearchParams();
    params.set("date", formatDateParam(next.date));
    params.set("view", next.view);
    params.set("group", next.group);
    router.push(`/planning?${params.toString()}`);
  }

  function handleDateChange(nextDate: Date) {
    pushParams({ date: nextDate, view, group });
  }

  function handleViewChange(nextView: PlanningView) {
    if (nextView === view) return;
    pushParams({ date, view: nextView, group });
    startTransition(() => {
      void setLastUsedView("planning-view", nextView);
    });
  }

  function handleGroupChange(nextGroup: PlanningGroup) {
    if (nextGroup === group) return;
    pushParams({ date, view, group: nextGroup });
    startTransition(() => {
      void setLastUsedView("planning-group", nextGroup);
    });
  }

  function handleSelectBacklog(workOrder: WorkOrderRecord) {
    setSelectedBacklogWorkOrder((prev) => (prev?.id === workOrder.id ? null : workOrder));
  }

  async function performSchedule(workOrder: WorkOrderRecord, engineerId: string, scheduledAt: Date) {
    const scheduledAtIso = toOffsetIsoString(scheduledAt);
    const previousBacklog = backlogState;
    const previousScheduled = scheduledState;
    const optimistic: WorkOrderRecord = { ...workOrder, assigned_to: engineerId, scheduled_at: scheduledAtIso };

    setError(null);
    setDraggingWorkOrder(null);
    setSelectedBacklogWorkOrder(null);
    setBacklogState((prev) => prev.filter((wo) => wo.id !== workOrder.id));
    setScheduledState((prev) => [...prev.filter((wo) => wo.id !== workOrder.id), optimistic]);

    const result = await scheduleWorkOrder(workOrder.id, { assignedTo: engineerId, scheduledAt: scheduledAtIso });
    if (result.error || !result.data) {
      setBacklogState(previousBacklog);
      setScheduledState(previousScheduled);
      setError(result.error ?? "Kon dit item niet inplannen.");
      return;
    }
    router.refresh();
  }

  function handleDropToBacklog() {
    if (draggingWorkOrder && draggingWorkOrder.scheduled_at != null) {
      void performUnschedule(draggingWorkOrder);
    }
    setDraggingWorkOrder(null);
  }

  async function performUnschedule(workOrder: WorkOrderRecord) {
    const previousBacklog = backlogState;
    const previousScheduled = scheduledState;
    const optimistic: WorkOrderRecord = { ...workOrder, assigned_to: null, scheduled_at: null };

    setError(null);
    setScheduledState((prev) => prev.filter((wo) => wo.id !== workOrder.id));
    setBacklogState((prev) => [optimistic, ...prev]);

    const result = await unscheduleWorkOrder(workOrder.id);
    if (result.error || !result.data) {
      setBacklogState(previousBacklog);
      setScheduledState(previousScheduled);
      setError(result.error ?? "Kon dit item niet terugzetten naar de werkvoorraad.");
      return;
    }
    router.refresh();
  }

  return (
    <>
      <PlanningTopbar
        date={date}
        view={view}
        group={group}
        onDateChange={handleDateChange}
        onViewChange={handleViewChange}
        onGroupChange={handleGroupChange}
      />

      {error && (
        <Card>
          <Text tone="danger">{error}</Text>
        </Card>
      )}

      <div className="ui-planning-layout">
        <PlanningBacklog
          workOrders={backlogState}
          regions={regions}
          activityTypes={activityTypes}
          siteRegionById={siteRegionById}
          clientNameById={clientNameById}
          selectedId={selectedBacklogWorkOrder?.id ?? null}
          onSelect={handleSelectBacklog}
          onDragStart={setDraggingWorkOrder}
          onDragEnd={() => setDraggingWorkOrder(null)}
          typeFilter={typeFilter}
          onToggleType={toggleTypeFilter}
          onClearTypeFilter={clearTypeFilter}
          draggingScheduledWorkOrder={draggingWorkOrder && draggingWorkOrder.scheduled_at != null ? draggingWorkOrder : null}
          onDropToBacklog={handleDropToBacklog}
        />

        <PlanningGrid
          view={view}
          group={group}
          date={date}
          regions={regions}
          engineers={engineers}
          scheduled={scheduledState}
          backlog={backlogState}
          siteRegionById={siteRegionById}
          clientNameById={clientNameById}
          draggingWorkOrder={draggingWorkOrder}
          selectedBacklogWorkOrder={selectedBacklogWorkOrder}
          onScheduleRequest={performSchedule}
          onUnschedule={performUnschedule}
          onBlockDragStart={setDraggingWorkOrder}
          onBlockDragEnd={() => setDraggingWorkOrder(null)}
        />
      </div>
    </>
  );
}
