"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import { Avatar, Badge, Card, Inline, SchedulerGrid, Stack, Text, Timeline } from "@yourorg/ui";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { buildEngineerSections, type PlanningEngineer, type PlanningSection } from "../grouping";
import { isSlotValid, spanForDuration } from "../fit-check";
import {
  HOUR_LABELS,
  SLOTS_PER_HOUR,
  TOTAL_SLOTS,
  addDays,
  dateForSlot,
  formatShortWeekday,
  formatTimeLabel,
  slotIndexFor,
  startOfWeek,
} from "../date-utils";
import type { PlanningGroup, PlanningView } from "../types";

export interface PlanningGridProps {
  view: PlanningView;
  group: PlanningGroup;
  date: Date;
  regions: ReferenceListItemRecord[];
  engineers: PlanningEngineer[];
  scheduled: WorkOrderRecord[];
  backlog: WorkOrderRecord[];
  siteRegionById: Record<string, string | null>;
  clientNameById: Record<string, string>;
  draggingWorkOrder: WorkOrderRecord | null;
  selectedBacklogWorkOrder: WorkOrderRecord | null;
  onScheduleRequest: (workOrder: WorkOrderRecord, engineerId: string, scheduledAt: Date) => void;
  onUnschedule: (workOrder: WorkOrderRecord) => void;
  onBlockDragStart: (workOrder: WorkOrderRecord) => void;
  onBlockDragEnd: () => void;
}

interface HoverKey {
  engineerId: string;
  slot: number;
}

/**
 * The scheduler board's main area (issue #164) — one section per region (or
 * a single flat section for "Alle monteurs", per the confirmed grouping
 * decision), each rendering either the half-hour `SchedulerGrid` (Day view,
 * real drag/drop + click-to-select scheduling) or the simplified `Timeline`
 * (Week view — a compact per-day block list, no half-hour precision, no
 * drag-and-drop scheduling per the confirmed decision).
 */
export function PlanningGrid({
  view,
  group,
  date,
  regions,
  engineers,
  scheduled,
  backlog,
  siteRegionById,
  clientNameById,
  draggingWorkOrder,
  selectedBacklogWorkOrder,
  onScheduleRequest,
  onUnschedule,
  onBlockDragStart,
  onBlockDragEnd,
}: PlanningGridProps) {
  const [hoverKey, setHoverKey] = useState<HoverKey | null>(null);
  const sections = buildEngineerSections(group, regions, engineers);

  function backlogCountFor(section: PlanningSection): number | null {
    if (!regions.some((region) => region.id === section.key)) return null;
    return backlog.filter((wo) => (wo.site_id ? siteRegionById[wo.site_id] : null) === section.key).length;
  }

  return (
    <Stack gap="md">
      {sections.map((section) => (
        <Card key={section.key} className="ui-planning-section">
          <Stack gap="md">
            {section.label && (
              <Inline justify="between" align="center">
                <Inline gap="sm" align="center">
                  <span className="ui-planning-region-dot" aria-hidden />
                  <Text className="ui-planning-section-title">{section.label}</Text>
                  {section.subtitle && (
                    <Text tone="muted" className="ui-planning-section-subtitle">
                      {section.subtitle}
                    </Text>
                  )}
                </Inline>
                <Inline gap="sm">
                  <Badge variant="muted">{section.engineers.length} monteurs</Badge>
                  {backlogCountFor(section) !== null && (
                    <Badge color="amber">{backlogCountFor(section)} te plannen</Badge>
                  )}
                </Inline>
              </Inline>
            )}

            {section.engineers.length === 0 ? (
              <Text tone="muted">Geen monteurs toegewezen aan deze regio.</Text>
            ) : view === "day" ? (
              <DayGrid
                date={date}
                engineers={section.engineers}
                scheduled={scheduled}
                clientNameById={clientNameById}
                draggingWorkOrder={draggingWorkOrder}
                selectedBacklogWorkOrder={selectedBacklogWorkOrder}
                hoverKey={hoverKey}
                onHoverChange={setHoverKey}
                onScheduleRequest={onScheduleRequest}
                onUnschedule={onUnschedule}
                onBlockDragStart={onBlockDragStart}
                onBlockDragEnd={onBlockDragEnd}
              />
            ) : (
              <WeekTimeline
                date={date}
                engineers={section.engineers}
                scheduled={scheduled}
                onUnschedule={onUnschedule}
              />
            )}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

function DayGrid({
  date,
  engineers,
  scheduled,
  clientNameById,
  draggingWorkOrder,
  selectedBacklogWorkOrder,
  hoverKey,
  onHoverChange,
  onScheduleRequest,
  onUnschedule,
  onBlockDragStart,
  onBlockDragEnd,
}: {
  date: Date;
  engineers: PlanningEngineer[];
  scheduled: WorkOrderRecord[];
  clientNameById: Record<string, string>;
  draggingWorkOrder: WorkOrderRecord | null;
  selectedBacklogWorkOrder: WorkOrderRecord | null;
  hoverKey: HoverKey | null;
  onHoverChange: (key: HoverKey | null) => void;
  onScheduleRequest: (workOrder: WorkOrderRecord, engineerId: string, scheduledAt: Date) => void;
  onUnschedule: (workOrder: WorkOrderRecord) => void;
  onBlockDragStart: (workOrder: WorkOrderRecord) => void;
  onBlockDragEnd: () => void;
}) {
  return (
    <div className="ui-planning-grid-scroll">
      <SchedulerGrid columnLabels={HOUR_LABELS} slotsPerLabel={SLOTS_PER_HOUR}>
        {engineers.map((engineer) => (
          <SchedulerGrid.Row
            key={engineer.userId}
            label={
              <Inline gap="sm" align="center">
                <Avatar name={engineer.name} size="sm" photoUrl={engineer.avatarUrl} />
                <Text>{engineer.name}</Text>
              </Inline>
            }
            cells={buildDayCells({
              engineer,
              date,
              scheduled,
              clientNameById,
              draggingWorkOrder,
              selectedBacklogWorkOrder,
              hoverKey,
              onHoverChange,
              onScheduleRequest,
              onUnschedule,
              onBlockDragStart,
              onBlockDragEnd,
            })}
          />
        ))}
      </SchedulerGrid>
    </div>
  );
}

function buildDayCells({
  engineer,
  date,
  scheduled,
  clientNameById,
  draggingWorkOrder,
  selectedBacklogWorkOrder,
  hoverKey,
  onHoverChange,
  onScheduleRequest,
  onUnschedule,
  onBlockDragStart,
  onBlockDragEnd,
}: {
  engineer: PlanningEngineer;
  date: Date;
  scheduled: WorkOrderRecord[];
  clientNameById: Record<string, string>;
  draggingWorkOrder: WorkOrderRecord | null;
  selectedBacklogWorkOrder: WorkOrderRecord | null;
  hoverKey: HoverKey | null;
  onHoverChange: (key: HoverKey | null) => void;
  onScheduleRequest: (workOrder: WorkOrderRecord, engineerId: string, scheduledAt: Date) => void;
  onUnschedule: (workOrder: WorkOrderRecord) => void;
  onBlockDragStart: (workOrder: WorkOrderRecord) => void;
  onBlockDragEnd: () => void;
}): ReactNode[] {
  const items = scheduled
    .filter((wo) => wo.assigned_to === engineer.userId)
    .map((wo) => ({ wo, slot: wo.scheduled_at ? slotIndexFor(wo.scheduled_at, date) : null }))
    .filter((entry): entry is { wo: WorkOrderRecord; slot: number } => entry.slot !== null)
    .sort((a, b) => a.slot - b.slot);

  const pendingItem = draggingWorkOrder ?? selectedBacklogWorkOrder;
  const previewSpan =
    pendingItem?.duration_minutes != null ? spanForDuration(pendingItem.duration_minutes) : 1;

  function previewFor(slot: number): "valid" | "invalid" | undefined {
    if (!draggingWorkOrder || !hoverKey || hoverKey.engineerId !== engineer.userId) return undefined;
    if (slot < hoverKey.slot || slot >= hoverKey.slot + previewSpan) return undefined;
    if (draggingWorkOrder.duration_minutes == null) return "invalid";
    return isSlotValid(
      hoverKey.slot,
      draggingWorkOrder.duration_minutes,
      date,
      engineer.userId,
      scheduled,
      draggingWorkOrder.id,
    )
      ? "valid"
      : "invalid";
  }

  function disabledFor(slot: number): boolean {
    if (!selectedBacklogWorkOrder || selectedBacklogWorkOrder.duration_minutes == null) return false;
    return !isSlotValid(
      slot,
      selectedBacklogWorkOrder.duration_minutes,
      date,
      engineer.userId,
      scheduled,
      selectedBacklogWorkOrder.id,
    );
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, slot: number) {
    event.preventDefault();
    onHoverChange(null);
    if (!draggingWorkOrder) return;
    onScheduleRequest(draggingWorkOrder, engineer.userId, dateForSlot(date, slot));
  }

  function handleClick(slot: number) {
    if (!selectedBacklogWorkOrder || disabledFor(slot)) return;
    onScheduleRequest(selectedBacklogWorkOrder, engineer.userId, dateForSlot(date, slot));
  }

  /** `onClick` is only ever wired up when there's an active, valid selection
   * for this exact cell — see `SchedulerGrid.Cell`'s own doc comment on why
   * that's what makes it a real (focusable, Enter/Space-activatable)
   * keyboard target rather than an inert placeholder the rest of the time. */
  function renderCell(slot: number) {
    const disabled = disabledFor(slot);
    return (
      <SchedulerGrid.Cell
        key={`cell-${slot}`}
        disabled={disabled}
        preview={previewFor(slot)}
        onDragOver={(event) => {
          if (draggingWorkOrder) event.preventDefault();
        }}
        onDragEnter={() => {
          if (draggingWorkOrder) onHoverChange({ engineerId: engineer.userId, slot });
        }}
        onDrop={(event) => handleDrop(event, slot)}
        onClick={selectedBacklogWorkOrder && !disabled ? () => handleClick(slot) : undefined}
      />
    );
  }

  const cells: ReactNode[] = [];
  let slot = 0;
  for (const { wo, slot: itemSlot } of items) {
    while (slot < itemSlot && slot < TOTAL_SLOTS) {
      cells.push(renderCell(slot));
      slot += 1;
    }
    if (slot >= TOTAL_SLOTS) break;
    const span = Math.min(spanForDuration(wo.duration_minutes ?? 30), TOTAL_SLOTS - slot);
    cells.push(
      <SchedulerGrid.Block
        key={wo.id}
        span={span}
        color={wo.work_order_type?.color}
        title={wo.title}
        meta={`${formatTimeLabel(wo.scheduled_at!)} · ${clientNameById[wo.client_id] ?? ""}`}
        onClick={() => onUnschedule(wo)}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", wo.id);
          event.dataTransfer.effectAllowed = "move";
          onBlockDragStart(wo);
        }}
        onDragEnd={onBlockDragEnd}
      />,
    );
    slot += span;
  }
  while (slot < TOTAL_SLOTS) {
    cells.push(renderCell(slot));
    slot += 1;
  }
  return cells;
}

function WeekTimeline({
  date,
  engineers,
  scheduled,
  onUnschedule,
}: {
  date: Date;
  engineers: PlanningEngineer[];
  scheduled: WorkOrderRecord[];
  onUnschedule: (workOrder: WorkOrderRecord) => void;
}) {
  const monday = startOfWeek(date);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const dayLabels = weekDays.map((day) => formatShortWeekday(day));

  return (
    <div className="ui-planning-grid-scroll">
      <Timeline days={dayLabels}>
        {engineers.map((engineer) => (
          <Timeline.Row
            key={engineer.userId}
            label={
              <Inline gap="sm" align="center">
                <Avatar name={engineer.name} size="sm" photoUrl={engineer.avatarUrl} />
                <Text>{engineer.name}</Text>
              </Inline>
            }
            cells={weekDays.map((day) => {
              const dayItems = scheduled.filter(
                (wo) => wo.assigned_to === engineer.userId && wo.scheduled_at && isSameCalendarDay(wo.scheduled_at, day),
              );
              if (dayItems.length === 0) return null;
              return (
                <Stack gap="xs" key={day.toISOString()}>
                  {dayItems.map((wo) => (
                    <Timeline.Block
                      key={wo.id}
                      title={wo.title}
                      meta={formatTimeLabel(wo.scheduled_at!)}
                      variant={durationBadgeVariant(wo)}
                      onClick={() => onUnschedule(wo)}
                    />
                  ))}
                </Stack>
              );
            })}
          />
        ))}
      </Timeline>
    </div>
  );
}

function isSameCalendarDay(iso: string, day: Date): boolean {
  const d = new Date(iso);
  return d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
}

function durationBadgeVariant(workOrder: WorkOrderRecord): "muted" | "accent" | "success" | "danger" | "warning" {
  const color = workOrder.work_order_type?.color;
  if (color === "red") return "danger";
  if (color === "green") return "success";
  if (color === "amber" || color === "orange" || color === "yellow") return "warning";
  return "muted";
}
