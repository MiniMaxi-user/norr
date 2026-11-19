"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast, useToast } from "@yourorg/ui";
import { WebPage } from "@yourorg/ui/web";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { scheduleWorkOrder, unscheduleWorkOrder } from "@/app/(app)/work-orders/planning-actions";
import { setLastUsedView } from "@/lib/preferences/actions";
import { PlanningHeader } from "./planning-header";
import { PlanningBacklog } from "./planning-backlog";
import { PlanningGrid } from "./planning-grid";
import { PlanningDetailCard, type PlanningDetailSite } from "./planning-detail-card";
import {
  formatDateParam,
  formatWeekdayTime,
  toOffsetIsoString,
  workingHoursKey,
  type WorkingHours,
} from "../date-utils";
import type { PlanningEngineer } from "../grouping";
import type { PlanningGroup, PlanningView } from "../types";
import { typeBaseColor } from "../type-colors";

/** Only used when the `planning_default` column is missing from the data at
 * runtime (it is a new column) — otherwise each tenant's own flags decide. */
const LEGACY_DEFAULT_TYPES = new Set(["onderhoud", "inspectie", "storing"]);

const TYPE_SETTINGS_HREF = "/settings/reference-lists/activity_type";

function defaultTypeValues(activityTypes: ReferenceListItemRecord[]): string[] {
  const hasFlag = activityTypes.some((type) => typeof type.planning_default === "boolean");
  return activityTypes
    .filter((type) => (hasFlag ? type.planning_default : LEGACY_DEFAULT_TYPES.has(type.value)))
    .map((type) => type.value);
}

function serializeTypes(selected: ReadonlySet<string>): string {
  return selected.size === 0 ? "none" : Array.from(selected).sort().join(",");
}

interface ScheduleSnapshot {
  assignedTo: string | null;
  scheduledAt: string | null;
}

export interface PlanningScreenProps {
  date: Date;
  view: PlanningView;
  group: PlanningGroup;
  initialHours: WorkingHours;
  /** `activity_type` values from the URL / remembered preference. */
  initialTypes: string[] | undefined;
  canOpenTypeSettings: boolean;
  regions: ReferenceListItemRecord[];
  activityTypes: ReferenceListItemRecord[];
  engineers: PlanningEngineer[];
  initialBacklog: WorkOrderRecord[];
  initialScheduled: WorkOrderRecord[];
  siteRegionById: Record<string, string | null>;
  siteById: Record<string, PlanningDetailSite>;
  clientNameById: Record<string, string>;
}

/**
 * Client shell for the Planning scheduler board (issue #164, restyled to DS 07
 * in issue #222) — owns date/view/group URL-param state, the working hours,
 * the Type filter and the shared drag/selection state, and wires both the
 * drag-and-drop handlers AND the non-drag click-to-select-then-click-slot
 * fallback to the SAME `scheduleWorkOrder`/`unscheduleWorkOrder` Server
 * Actions (`app/(app)/work-orders/planning-actions.ts`).
 *
 * `backlogState`/`scheduledState` are optimistic local mirrors of the
 * server-fetched `initialBacklog`/`initialScheduled` props — same pattern
 * `app/(app)/clients/components/clients-kanban.tsx` established (move
 * immediately, revert on a failed server call, `router.refresh()` on
 * success to reconcile the Server Component's own data). A rejection from
 * either action (e.g. the server's authoritative overlap/half-hour-boundary
 * check catching something this component's own `../fit-check.ts` preview
 * missed) is always handled gracefully — reverted, surfaced as an inline
 * error — never assumed to have succeeded. Every successful change raises a
 * toast with "Undo", which runs the inverse through the same actions.
 *
 * Working hours and the Type filter are pure client state (instant, no server
 * round trip): they are mirrored into the URL with `history.replaceState` and
 * remembered per user with `setLastUsedView`.
 */
export function PlanningScreen({
  date,
  view,
  group,
  initialHours,
  initialTypes,
  canOpenTypeSettings,
  regions,
  activityTypes,
  engineers,
  initialBacklog,
  initialScheduled,
  siteRegionById,
  siteById,
  clientNameById,
}: PlanningScreenProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { dismiss } = useToast();

  const [backlogState, setBacklogState] = useState(initialBacklog);
  const [scheduledState, setScheduledState] = useState(initialScheduled);
  useEffect(() => setBacklogState(initialBacklog), [initialBacklog]);
  useEffect(() => setScheduledState(initialScheduled), [initialScheduled]);

  const [draggingWorkOrder, setDraggingWorkOrder] = useState<WorkOrderRecord | null>(null);
  const [selectedBacklogWorkOrder, setSelectedBacklogWorkOrder] = useState<WorkOrderRecord | null>(null);
  const [card, setCard] = useState<{ workOrderId: string; anchor: HTMLElement } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hours, setHours] = useState(initialHours);

  const defaultTypes = useMemo(() => defaultTypeValues(activityTypes), [activityTypes]);
  const [typeFilter, setTypeFilter] = useState<Set<string>>(() => {
    const known = new Set(activityTypes.map((type) => type.value));
    const fromUrl = initialTypes?.filter((value) => known.has(value));
    // An explicit "none" is `[]`; values that no longer exist fall back to the defaults.
    if (initialTypes && initialTypes.length === 0) return new Set();
    return new Set(fromUrl && fromUrl.length > 0 ? fromUrl : defaultTypes);
  });

  const engineerById = useMemo(() => new Map(engineers.map((engineer) => [engineer.userId, engineer])), [engineers]);

  /* ---- Type filter ---------------------------------------------------- */

  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const wo of [...scheduledState, ...backlogState]) {
      const value = wo.work_order_type?.value;
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return activityTypes
      .filter((type) => type.is_active || (counts.get(type.value) ?? 0) > 0)
      .map((type) => ({
        value: type.value,
        label: type.label,
        color: typeBaseColor(type.color),
        count: counts.get(type.value) ?? 0,
      }));
  }, [activityTypes, scheduledState, backlogState]);

  const visibleBacklog = useMemo(
    () => backlogState.filter((wo) => !wo.work_order_type || typeFilter.has(wo.work_order_type.value)),
    [backlogState, typeFilter],
  );
  const visibleScheduled = useMemo(
    () => scheduledState.filter((wo) => !wo.work_order_type || typeFilter.has(wo.work_order_type.value)),
    [scheduledState, typeFilter],
  );

  function buildParams(next: {
    date: Date;
    view: PlanningView;
    group: PlanningGroup;
    hours: WorkingHours;
    types: ReadonlySet<string>;
  }): string {
    const params = new URLSearchParams();
    params.set("date", formatDateParam(next.date));
    params.set("view", next.view);
    params.set("group", next.group);
    params.set("hours", workingHoursKey(next.hours));
    params.set("types", serializeTypes(next.types));
    return params.toString();
  }

  function replaceUrl(next: { hours?: WorkingHours; types?: ReadonlySet<string> }) {
    const qs = buildParams({ date, view, group, hours: next.hours ?? hours, types: next.types ?? typeFilter });
    window.history.replaceState(window.history.state, "", `/planning?${qs}`);
  }

  function handleTypesChange(next: Set<string>) {
    setTypeFilter(next);
    replaceUrl({ types: next });
    startTransition(() => {
      void setLastUsedView("planning-types", serializeTypes(next));
    });
  }

  function handleHoursChange(next: WorkingHours) {
    setHours(next);
    replaceUrl({ hours: next });
    startTransition(() => {
      void setLastUsedView("planning-hours", workingHoursKey(next));
    });
  }

  /* ---- Navigation ----------------------------------------------------- */

  function pushParams(next: { date: Date; view: PlanningView; group: PlanningGroup }) {
    router.push(`/planning?${buildParams({ ...next, hours, types: typeFilter })}`);
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

  /* ---- Selection + detail card --------------------------------------- */

  function handleSelectBacklog(workOrder: WorkOrderRecord) {
    setSelectedBacklogWorkOrder((prev) => (prev?.id === workOrder.id ? null : workOrder));
  }

  function handleOpenCard(workOrder: WorkOrderRecord, anchor: HTMLElement) {
    setCard((prev) => (prev?.workOrderId === workOrder.id ? null : { workOrderId: workOrder.id, anchor }));
  }

  /* ---- Schedule / unschedule (optimistic, with Undo) ------------------ */

  function snapshotOf(workOrder: WorkOrderRecord): ScheduleSnapshot {
    return { assignedTo: workOrder.assigned_to, scheduledAt: workOrder.scheduled_at };
  }

  async function performSchedule(
    workOrder: WorkOrderRecord,
    engineerId: string,
    scheduledAt: Date,
    options?: { quiet?: boolean },
  ) {
    const scheduledAtIso = toOffsetIsoString(scheduledAt);
    const previous = snapshotOf(workOrder);
    const previousBacklog = backlogState;
    const previousScheduled = scheduledState;
    const optimistic: WorkOrderRecord = { ...workOrder, assigned_to: engineerId, scheduled_at: scheduledAtIso };

    setError(null);
    setCard(null);
    setDraggingWorkOrder(null);
    setSelectedBacklogWorkOrder(null);
    setBacklogState((prev) => prev.filter((wo) => wo.id !== workOrder.id));
    setScheduledState((prev) => [...prev.filter((wo) => wo.id !== workOrder.id), optimistic]);

    const result = await scheduleWorkOrder(workOrder.id, { assignedTo: engineerId, scheduledAt: scheduledAtIso });
    if (result.error || !result.data) {
      setBacklogState(previousBacklog);
      setScheduledState(previousScheduled);
      setError(result.error ?? "Couldn't schedule this item.");
      return;
    }
    router.refresh();

    if (!options?.quiet) {
      const engineerName = engineerById.get(engineerId)?.name ?? "engineer";
      let toastId = "";
      toastId = toast({
        description: `${workOrder.work_order_number} scheduled for ${engineerName}, ${formatWeekdayTime(scheduledAtIso)}`,
        action: {
          label: "Undo",
          onClick: () => {
            dismiss(toastId);
            void undoSchedule(optimistic, previous);
          },
        },
      });
    }
  }

  async function performUnschedule(workOrder: WorkOrderRecord, options?: { quiet?: boolean }) {
    const previous = snapshotOf(workOrder);
    const previousBacklog = backlogState;
    const previousScheduled = scheduledState;
    const optimistic: WorkOrderRecord = { ...workOrder, assigned_to: null, scheduled_at: null };

    setError(null);
    setCard(null);
    setScheduledState((prev) => prev.filter((wo) => wo.id !== workOrder.id));
    setBacklogState((prev) => [optimistic, ...prev.filter((wo) => wo.id !== workOrder.id)]);

    const result = await unscheduleWorkOrder(workOrder.id);
    if (result.error || !result.data) {
      setBacklogState(previousBacklog);
      setScheduledState(previousScheduled);
      setError(result.error ?? "Couldn't move this item back to the backlog.");
      return;
    }
    router.refresh();

    if (!options?.quiet) {
      let toastId = "";
      toastId = toast({
        description: `${workOrder.work_order_number} moved back to the backlog`,
        action: {
          label: "Undo",
          onClick: () => {
            dismiss(toastId);
            if (previous.assignedTo && previous.scheduledAt) {
              void actionsRef.current.performSchedule(
                optimistic,
                previous.assignedTo,
                new Date(previous.scheduledAt),
                { quiet: true },
              );
            }
          },
        },
      });
    }
  }

  /** Reverts a schedule through the same actions: back to the previous slot,
   * or back to the backlog when it was unscheduled before. */
  async function undoSchedule(updated: WorkOrderRecord, previous: ScheduleSnapshot) {
    if (previous.assignedTo && previous.scheduledAt) {
      await actionsRef.current.performSchedule(updated, previous.assignedTo, new Date(previous.scheduledAt), { quiet: true });
    } else {
      await actionsRef.current.performUnschedule(updated, { quiet: true });
    }
  }

  // The Undo closures above outlive the render that created them; they always
  // call the latest handlers (which see the latest optimistic state).
  const actionsRef = useRef({ performSchedule, performUnschedule });
  useEffect(() => {
    actionsRef.current = { performSchedule, performUnschedule };
  });

  function handleDropToBacklog() {
    if (draggingWorkOrder && draggingWorkOrder.scheduled_at != null) {
      void performUnschedule(draggingWorkOrder);
    }
    setDraggingWorkOrder(null);
  }

  const cardWorkOrder = card
    ? ([...scheduledState, ...backlogState].find((wo) => wo.id === card.workOrderId) ?? null)
    : null;

  return (
    <WebPage>
      <PlanningHeader
        date={date}
        view={view}
        group={group}
        hours={hours}
        query={query}
        typeOptions={typeOptions}
        selectedTypes={typeFilter}
        typeSettingsHref={canOpenTypeSettings ? TYPE_SETTINGS_HREF : null}
        onDateChange={handleDateChange}
        onViewChange={handleViewChange}
        onGroupChange={handleGroupChange}
        onHoursChange={handleHoursChange}
        onQueryChange={setQuery}
        onTypesChange={handleTypesChange}
        onTypesAll={() => handleTypesChange(new Set(typeOptions.map((option) => option.value)))}
        onTypesDefault={() => handleTypesChange(new Set(defaultTypes))}
      />

      {error ? (
        <p className="web-plan-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="web-plan-main" data-web-main="">
        <PlanningBacklog
          workOrders={visibleBacklog}
          regions={regions}
          siteRegionById={siteRegionById}
          clientNameById={clientNameById}
          query={query}
          selectedId={selectedBacklogWorkOrder?.id ?? null}
          openId={card?.workOrderId ?? null}
          onSelect={handleSelectBacklog}
          onOpen={handleOpenCard}
          onDragStart={setDraggingWorkOrder}
          onDragEnd={() => setDraggingWorkOrder(null)}
          draggingScheduledWorkOrder={draggingWorkOrder && draggingWorkOrder.scheduled_at != null ? draggingWorkOrder : null}
          onDropToBacklog={handleDropToBacklog}
        />

        <PlanningGrid
          view={view}
          group={group}
          date={date}
          hours={hours}
          regions={regions}
          engineers={engineers}
          scheduled={visibleScheduled}
          backlog={visibleBacklog}
          siteRegionById={siteRegionById}
          clientNameById={clientNameById}
          query={query}
          draggingWorkOrder={draggingWorkOrder}
          selectedBacklogWorkOrder={selectedBacklogWorkOrder}
          openId={card?.workOrderId ?? null}
          onScheduleRequest={performSchedule}
          onOpen={handleOpenCard}
          onBlockDragStart={setDraggingWorkOrder}
          onBlockDragEnd={() => setDraggingWorkOrder(null)}
        />
      </div>

      {card && cardWorkOrder ? (
        <PlanningDetailCard
          workOrder={cardWorkOrder}
          anchor={card.anchor}
          engineerName={cardWorkOrder.assigned_to ? (engineerById.get(cardWorkOrder.assigned_to)?.name ?? null) : null}
          clientName={clientNameById[cardWorkOrder.client_id] ?? "Unknown client"}
          site={cardWorkOrder.site_id ? (siteById[cardWorkOrder.site_id] ?? null) : null}
          onClose={() => setCard(null)}
          onUnschedule={(workOrder) => void performUnschedule(workOrder)}
        />
      ) : null}
    </WebPage>
  );
}
