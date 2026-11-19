"use client";

import { useEffect, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { WebStatusBadge } from "@yourorg/ui/web";
import { Lock } from "@yourorg/ui/icons";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { buildEngineerSections, type PlanningEngineer, type PlanningSection } from "../grouping";
import { slotConflict, spanForDuration, type SlotConflict } from "../fit-check";
import {
  SLOTS_PER_HOUR,
  addDays,
  dateForSlot,
  formatEndTime,
  formatTimeLabel,
  formatWeekdayOverline,
  hourLabels,
  isSameLocalDay,
  isToday,
  isWeekend,
  minutesFromWindowStart,
  startOfWeek,
  totalSlots,
  type WorkingHours,
} from "../date-utils";
import { typeColorStyle } from "../type-colors";
import type { PlanningGroup, PlanningView } from "../types";
import { highlight } from "./highlight";

export interface PlanningGridProps {
  view: PlanningView;
  group: PlanningGroup;
  date: Date;
  hours: WorkingHours;
  regions: ReferenceListItemRecord[];
  engineers: PlanningEngineer[];
  scheduled: WorkOrderRecord[];
  backlog: WorkOrderRecord[];
  siteRegionById: Record<string, string | null>;
  clientNameById: Record<string, string>;
  /** The header search — hits are highlighted. */
  query: string;
  draggingWorkOrder: WorkOrderRecord | null;
  /** The work order whose floating detail card is open (ring on its block). */
  openId: string | null;
  onScheduleRequest: (workOrder: WorkOrderRecord, engineerId: string, scheduledAt: Date) => void;
  /** Opens the floating detail card under a block (click, or Enter on a
   * focused block). Clicking a block never unschedules — a scheduled item
   * only returns to the backlog by dragging it there or via the card. */
  onOpen: (workOrder: WorkOrderRecord, anchor: HTMLElement, viaKeyboard: boolean) => void;
  onBlockDragStart: (workOrder: WorkOrderRecord) => void;
  onBlockDragEnd: () => void;
}

interface HoverKey {
  engineerId: string;
  slot: number;
}

/** Display-only "already checked out (or further along) by the engineer's
 * PWA" heuristic (issue #203) — every work order reaching this grid already
 * has `scheduled_at` set, so any status other than `"scheduled"` here means
 * `checkout`/`en_route`/`in_progress`/`completed`/`invoiced` in practice. The
 * real enforcement is server-side (`isWorkOrderCheckedOutOrLater`, compared
 * by `sort_order`, in `app/(app)/work-orders/checkout-lock.ts`) — this is
 * purely the glanceable lock icon on the block ("Locked", DS 07), so a
 * planner sees why a drag will be rejected before even attempting it. */
export function isLockedWorkOrder(workOrder: WorkOrderRecord): boolean {
  return workOrder.work_order_status?.value !== "scheduled";
}

function useNow(enabled: boolean): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return enabled ? now : null;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/**
 * The scheduler board's main area (DS 07 section 2) — one card per region (or
 * a single "All engineers" card, per the confirmed grouping decision), each
 * rendering either the half-hour day grid (real drag/drop + click-to-select
 * scheduling) or the week grid (a compact per-day block stack, no drag-and-drop
 * scheduling per the confirmed decision). `.web-plan-area` is its own scroll
 * area, independent of the backlog's; the scale / day headers stay stuck to
 * the top while it scrolls.
 */
export function PlanningGrid({
  view,
  group,
  date,
  hours,
  regions,
  engineers,
  scheduled,
  backlog,
  siteRegionById,
  clientNameById,
  query,
  draggingWorkOrder,
  openId,
  onScheduleRequest,
  onOpen,
  onBlockDragStart,
  onBlockDragEnd,
}: PlanningGridProps) {
  const [hoverKey, setHoverKey] = useState<HoverKey | null>(null);
  const now = useNow(view === "day" && isToday(date));
  const sections = buildEngineerSections(group, regions, engineers);
  const regionNameById = new Map(regions.map((region) => [region.id, region.label]));

  function backlogCountFor(section: PlanningSection): number | null {
    if (!regions.some((region) => region.id === section.key)) return null;
    return backlog.filter((wo) => (wo.site_id ? siteRegionById[wo.site_id] : null) === section.key).length;
  }

  return (
    <div className="web-plan-area">
      {sections.map((section) => {
        const toPlan = group === "region" ? backlogCountFor(section) : null;
        return (
          <section key={section.key} className="web-card web-plan-card" data-view={view} aria-label={section.label ?? "All engineers"}>
            <header className="web-card-head">
              <h2 className="web-card-title">{section.label ?? "All engineers"}</h2>
              {section.subtitle ? <span className="web-plan-card-sub">{section.subtitle}</span> : null}
              <span className="web-plan-card-badges">
                <WebStatusBadge tone="neutral">
                  {section.engineers.length} {section.engineers.length === 1 ? "engineer" : "engineers"}
                </WebStatusBadge>
                {toPlan !== null ? (
                  <WebStatusBadge tone={toPlan > 0 ? "warning" : "neutral"}>{toPlan} to plan</WebStatusBadge>
                ) : null}
              </span>
            </header>

            {section.engineers.length === 0 ? (
              <p className="web-plan-empty-row">No engineers assigned to this region.</p>
            ) : view === "day" ? (
              <DayGrid
                date={date}
                hours={hours}
                now={now}
                engineers={section.engineers}
                showRegion={group === "engineer"}
                regionNameById={regionNameById}
                scheduled={scheduled}
                clientNameById={clientNameById}
                query={query}
                draggingWorkOrder={draggingWorkOrder}
                openId={openId}
                hoverKey={hoverKey}
                onHoverChange={setHoverKey}
                onScheduleRequest={onScheduleRequest}
                onOpen={onOpen}
                onBlockDragStart={onBlockDragStart}
                onBlockDragEnd={onBlockDragEnd}
              />
            ) : (
              <WeekGrid
                date={date}
                engineers={section.engineers}
                showRegion={group === "engineer"}
                regionNameById={regionNameById}
                scheduled={scheduled}
                clientNameById={clientNameById}
                query={query}
                openId={openId}
                onOpen={onOpen}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * Shared pieces
 * ---------------------------------------------------------------------- */

function WhoCell({
  engineer,
  regionName,
  query,
}: {
  engineer: PlanningEngineer;
  regionName: string | null;
  query: string;
}) {
  return (
    <div className="web-plan-who">
      <span className="web-plan-avatar" aria-hidden="true">
        {engineer.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={engineer.avatarUrl} alt="" />
        ) : (
          initialsOf(engineer.name)
        )}
      </span>
      <span className="web-plan-who-text">
        <Link href={`/settings/team/${engineer.userId}`} className="web-plan-who-name">
          {highlight(engineer.name, query)}
        </Link>
        {regionName ? <span className="web-plan-who-region">{regionName}</span> : null}
      </span>
    </div>
  );
}

function PlanBlock({
  workOrder,
  view,
  clientName,
  query,
  open,
  position,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  workOrder: WorkOrderRecord;
  view: PlanningView;
  clientName: string;
  query: string;
  open: boolean;
  position?: CSSProperties;
  onOpen: (workOrder: WorkOrderRecord, anchor: HTMLElement, viaKeyboard: boolean) => void;
  onDragStart?: (workOrder: WorkOrderRecord) => void;
  onDragEnd?: () => void;
}) {
  const locked = isLockedWorkOrder(workOrder);
  const scheduledAt = workOrder.scheduled_at!;
  const duration = workOrder.duration_minutes ?? 30;
  const range = `${formatTimeLabel(scheduledAt)}–${formatEndTime(scheduledAt, duration)}`;
  const typeLabel = workOrder.work_order_type?.label ?? "";
  const label = [workOrder.work_order_number, typeLabel, range, clientName].filter(Boolean).join(", ");
  const idText = highlight(workOrder.work_order_number, query);
  const lock = locked ? (
    <span className="web-plan-lock" role="img" aria-label="Locked">
      <Lock aria-hidden />
    </span>
  ) : null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(workOrder, event.currentTarget, true);
    }
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData("text/plain", workOrder.id);
    event.dataTransfer.effectAllowed = "move";
    onDragStart?.(workOrder);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="web-plan-block"
      data-view={view}
      data-open={open ? "true" : undefined}
      data-plan-anchor={workOrder.id}
      style={{ ...typeColorStyle(workOrder.work_order_type?.color), ...position }}
      title={`${label}${locked ? " (locked)" : ""}`}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      draggable={view === "day" && !locked}
      onClick={(event) => onOpen(workOrder, event.currentTarget, false)}
      onKeyDown={handleKeyDown}
      onDragStart={view === "day" && !locked ? handleDragStart : undefined}
      onDragEnd={view === "day" ? onDragEnd : undefined}
    >
      {view === "day" ? (
        <>
          <div className="web-plan-block-line">
            <span className="web-plan-dot" aria-hidden="true" />
            <span className="web-plan-id">{idText}</span>
            <span className="web-plan-block-type">{typeLabel}</span>
            {lock}
          </div>
          <div className="web-plan-block-line">
            <span className="web-plan-time">{range}</span>
            <span className="web-plan-block-client">{highlight(clientName, query)}</span>
          </div>
        </>
      ) : (
        <>
          <div className="web-plan-block-line">
            <span className="web-plan-dot" aria-hidden="true" />
            <span className="web-plan-time">{formatTimeLabel(scheduledAt)}</span>
            <span className="web-plan-id">{idText}</span>
            {lock}
          </div>
          <div className="web-plan-block-line">
            <span className="web-plan-block-type">{typeLabel}</span>
            <span className="web-plan-block-client">{highlight(clientName, query)}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * Day view
 * ---------------------------------------------------------------------- */

interface DayGridProps {
  date: Date;
  hours: WorkingHours;
  now: Date | null;
  engineers: PlanningEngineer[];
  showRegion: boolean;
  regionNameById: Map<string, string>;
  scheduled: WorkOrderRecord[];
  clientNameById: Record<string, string>;
  query: string;
  draggingWorkOrder: WorkOrderRecord | null;
  openId: string | null;
  hoverKey: HoverKey | null;
  onHoverChange: (key: HoverKey | null) => void;
  onScheduleRequest: (workOrder: WorkOrderRecord, engineerId: string, scheduledAt: Date) => void;
  onOpen: (workOrder: WorkOrderRecord, anchor: HTMLElement, viaKeyboard: boolean) => void;
  onBlockDragStart: (workOrder: WorkOrderRecord) => void;
  onBlockDragEnd: () => void;
}

const CONFLICT_MESSAGE: Record<Exclude<SlotConflict, "none"> | "duration", string> = {
  overlap: "Overlaps another block",
  outside: "Outside working hours",
  duration: "No duration set",
};

function DayGrid({
  date,
  hours,
  now,
  engineers,
  showRegion,
  regionNameById,
  scheduled,
  clientNameById,
  query,
  draggingWorkOrder,
  openId,
  hoverKey,
  onHoverChange,
  onScheduleRequest,
  onOpen,
  onBlockDragStart,
  onBlockDragEnd,
}: DayGridProps) {
  const slots = totalSlots(hours);
  const windowMinutes = (hours.end - hours.start) * 60;
  const labels = hourLabels(hours);

  const nowMinutes = now ? now.getHours() * 60 + now.getMinutes() - hours.start * 60 : null;
  const showNow = nowMinutes !== null && nowMinutes >= 0 && nowMinutes <= windowMinutes;
  const nowPercent = showNow ? (nowMinutes / windowMinutes) * 100 : 0;

  return (
    <div>
      <div className="web-plan-scale">
        <div className="web-plan-scale-who">Engineer</div>
        <div
          className="web-plan-axis"
          data-now={showNow ? "true" : undefined}
          style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}
        >
          {labels.map((label) => (
            <div key={label} className="web-plan-axis-hour">
              {label}
            </div>
          ))}
          {showNow && now ? (
            <span className="web-plan-now-pill" style={{ left: `${nowPercent}%` }}>
              {formatTimeLabel(now.toISOString())}
            </span>
          ) : null}
        </div>
      </div>

      {engineers.map((engineer) => {
        const items = scheduled
          .filter((wo) => wo.assigned_to === engineer.userId && wo.scheduled_at)
          .map((wo) => ({ wo, start: minutesFromWindowStart(wo.scheduled_at!, date, hours) }))
          .filter((entry): entry is { wo: WorkOrderRecord; start: number } => entry.start !== null)
          .sort((a, b) => a.start - b.start);

        const pendingSpan = draggingWorkOrder?.duration_minutes != null ? spanForDuration(draggingWorkOrder.duration_minutes) : 1;

        function conflictFor(slot: number, workOrder: WorkOrderRecord): SlotConflict | "duration" {
          if (workOrder.duration_minutes == null) return "duration";
          return slotConflict(slot, workOrder.duration_minutes, date, hours, engineer.userId, scheduled, workOrder.id);
        }

        /** While dragging: a start slot where the dragged item fits (shown light green). */
        function availableFor(slot: number): boolean {
          if (!draggingWorkOrder) return false;
          return conflictFor(slot, draggingWorkOrder) === "none";
        }

        function handleDrop(event: DragEvent<HTMLDivElement>, slot: number) {
          event.preventDefault();
          onHoverChange(null);
          if (!draggingWorkOrder) return;
          onScheduleRequest(draggingWorkOrder, engineer.userId, dateForSlot(date, slot, hours));
        }

        const hovering = draggingWorkOrder && hoverKey && hoverKey.engineerId === engineer.userId ? hoverKey : null;
        const hoverConflict = hovering && draggingWorkOrder ? conflictFor(hovering.slot, draggingWorkOrder) : null;
        const hoverSpan = Math.max(1, Math.min(pendingSpan, slots - (hovering?.slot ?? 0)));

        return (
          <div className="web-plan-row" key={engineer.userId}>
            <WhoCell
              engineer={engineer}
              regionName={showRegion && engineer.regionId ? (regionNameById.get(engineer.regionId) ?? null) : null}
              query={query}
            />
            <div
              className="web-plan-lane"
              style={{ "--slots": slots } as CSSProperties}
              data-dragging={draggingWorkOrder ? "true" : undefined}
            >
              {Array.from({ length: slots }, (_, slot) => {
                return (
                  <div
                    key={slot}
                    className="web-plan-cell"
                    data-hour={slot % SLOTS_PER_HOUR === 0 ? "true" : undefined}
                    data-first={slot === 0 ? "true" : undefined}
                    data-available={availableFor(slot) ? "true" : undefined}
                    onDragOver={(event) => {
                      if (draggingWorkOrder) event.preventDefault();
                    }}
                    onDragEnter={() => {
                      if (draggingWorkOrder) onHoverChange({ engineerId: engineer.userId, slot });
                    }}
                    onDrop={(event) => handleDrop(event, slot)}
                  />
                );
              })}

              {hovering && draggingWorkOrder && hoverConflict ? (
                <div
                  className="web-plan-drop"
                  data-state={hoverConflict === "none" ? "valid" : "conflict"}
                  style={{
                    left: `${(hovering.slot / slots) * 100}%`,
                    width: `${(hoverSpan / slots) * 100}%`,
                  }}
                  role={hoverConflict === "none" ? undefined : "alert"}
                >
                  {hoverConflict === "none"
                    ? (() => {
                        const start = dateForSlot(date, hovering.slot, hours).toISOString();
                        return `${formatTimeLabel(start)}–${formatEndTime(start, draggingWorkOrder.duration_minutes ?? 30)}`;
                      })()
                    : CONFLICT_MESSAGE[hoverConflict]}
                </div>
              ) : null}

              {showNow ? <div className="web-plan-now-line" style={{ left: `${nowPercent}%` }} aria-hidden="true" /> : null}

              {items.map(({ wo, start }) => {
                const duration = wo.duration_minutes ?? 30;
                const from = Math.max(0, start);
                const to = Math.min(windowMinutes, start + duration);
                if (to <= 0 || from >= windowMinutes || to <= from) return null;
                return (
                  <PlanBlock
                    key={wo.id}
                    workOrder={wo}
                    view="day"
                    clientName={clientNameById[wo.client_id] ?? ""}
                    query={query}
                    open={openId === wo.id}
                    position={{
                      left: `calc(${(from / windowMinutes) * 100}% + 1px)`,
                      width: `calc(${((to - from) / windowMinutes) * 100}% - 2px)`,
                    }}
                    onOpen={onOpen}
                    onDragStart={onBlockDragStart}
                    onDragEnd={onBlockDragEnd}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * Week view
 * ---------------------------------------------------------------------- */

function WeekGrid({
  date,
  engineers,
  showRegion,
  regionNameById,
  scheduled,
  clientNameById,
  query,
  openId,
  onOpen,
}: {
  date: Date;
  engineers: PlanningEngineer[];
  showRegion: boolean;
  regionNameById: Map<string, string>;
  scheduled: WorkOrderRecord[];
  clientNameById: Record<string, string>;
  query: string;
  openId: string | null;
  onOpen: (workOrder: WorkOrderRecord, anchor: HTMLElement, viaKeyboard: boolean) => void;
}): ReactNode {
  const monday = startOfWeek(date);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  return (
    <div>
      <div className="web-plan-scale" data-view="week">
        <div className="web-plan-scale-who">Engineer</div>
        {weekDays.map((day) => {
          const today = isToday(day);
          return (
            <div
              key={day.toISOString()}
              className="web-plan-dayhead"
              data-today={today ? "true" : undefined}
              data-weekend={isWeekend(day) ? "true" : undefined}
            >
              {formatWeekdayOverline(day)}
              {today ? <span className="web-plan-today-pill">today</span> : null}
            </div>
          );
        })}
      </div>

      {engineers.map((engineer) => (
        <div className="web-plan-row" data-view="week" key={engineer.userId}>
          <WhoCell
            engineer={engineer}
            regionName={showRegion && engineer.regionId ? (regionNameById.get(engineer.regionId) ?? null) : null}
            query={query}
          />
          {weekDays.map((day) => {
            const dayItems = scheduled
              .filter((wo) => wo.assigned_to === engineer.userId && wo.scheduled_at && isSameLocalDay(wo.scheduled_at, day))
              .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
            return (
              <div
                key={day.toISOString()}
                className="web-plan-daycell"
                data-today={isToday(day) ? "true" : undefined}
                data-weekend={isWeekend(day) ? "true" : undefined}
              >
                {dayItems.map((wo) => (
                  <PlanBlock
                    key={wo.id}
                    workOrder={wo}
                    view="week"
                    clientName={clientNameById[wo.client_id] ?? ""}
                    query={query}
                    open={openId === wo.id}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
