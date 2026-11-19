"use client";

import { useState, type DragEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { WebStatusBadge } from "@yourorg/ui/web";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { groupBacklogByRegion } from "../grouping";
import { formatDurationHours } from "../date-utils";
import { typeColorStyle } from "../type-colors";
import { highlight } from "./highlight";
import { workOrderTitle } from "../work-order-title";

export interface PlanningBacklogProps {
  workOrders: WorkOrderRecord[];
  regions: ReferenceListItemRecord[];
  siteRegionById: Record<string, string | null>;
  clientNameById: Record<string, string>;
  /** The header search — hits are highlighted, nothing is filtered by it. */
  query: string;
  selectedId: string | null;
  /** The work order whose floating detail card is open. */
  openId: string | null;
  onSelect: (workOrder: WorkOrderRecord) => void;
  /** Opens the floating detail card for a backlog item (its "Details" action). */
  onOpen: (workOrder: WorkOrderRecord, anchor: HTMLElement, viaKeyboard: boolean) => void;
  onDragStart: (workOrder: WorkOrderRecord) => void;
  onDragEnd: () => void;
  /** A currently-scheduled block (dragged from the grid) is being dragged
   * right now — enables this card as a drop target (unschedule). */
  draggingScheduledWorkOrder: WorkOrderRecord | null;
  onDropToBacklog: () => void;
}

/** A breakdown-type backlog item gets the red "n breakdown" badge in the
 * card head (DS 07 section 2). */
function isBreakdown(workOrder: WorkOrderRecord): boolean {
  const value = workOrder.work_order_type?.value;
  return value === "storing" || value === "breakdown";
}

/**
 * "Backlog" card (DS 07 section 2) — head with count/total hours and a red
 * breakdown badge, its own search field, items grouped by region (overline +
 * total duration), draggable. The list scrolls on its own
 * (`.web-plan-backlog-scroll`); the head, search and the one-line hint stay
 * put. An item is also click-to-select (visible `aria-pressed` state) — the
 * non-drag accessible fallback: select it here, then click a valid grid cell
 * to schedule it via the same `scheduleWorkOrder` action a drop would call.
 * Dropping a scheduled block here unschedules it.
 */
export function PlanningBacklog({
  workOrders,
  regions,
  siteRegionById,
  clientNameById,
  query,
  selectedId,
  openId,
  onSelect,
  onOpen,
  onDragStart,
  onDragEnd,
  draggingScheduledWorkOrder,
  onDropToBacklog,
}: PlanningBacklogProps) {
  const [localQuery, setLocalQuery] = useState("");
  const needle = localQuery.trim().toLowerCase();
  const visible = needle
    ? workOrders.filter((wo) => {
        const haystack = [
          wo.work_order_number,
          wo.external_reference,
          wo.description,
          clientNameById[wo.client_id],
          wo.asset?.name,
          wo.asset?.asset_model?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
    : workOrders;
  const groups = groupBacklogByRegion(visible, regions, siteRegionById);
  const highlightQuery = localQuery || query;

  const totalMinutes = visible.reduce((sum, wo) => sum + (wo.duration_minutes ?? 0), 0);
  const breakdownCount = visible.filter(isBreakdown).length;
  const acceptingDrop = draggingScheduledWorkOrder != null;

  return (
    <section
      className="web-card web-plan-backlog"
      aria-label="Backlog"
      data-drop={acceptingDrop ? "true" : undefined}
      onDragOver={(event) => {
        if (acceptingDrop) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!acceptingDrop) return;
        event.preventDefault();
        onDropToBacklog();
      }}
    >
      <header className="web-card-head">
        <h2 className="web-card-title">Backlog</h2>
        <span className="web-card-meta">
          {visible.length} · {formatDurationHours(totalMinutes)}
        </span>
        {breakdownCount > 0 ? (
          <span className="web-card-action">
            <WebStatusBadge tone="danger">{breakdownCount} breakdown</WebStatusBadge>
          </span>
        ) : null}
      </header>

      <div className="web-plan-backlog-search">
        <input
          type="search"
          value={localQuery}
          onChange={(event) => setLocalQuery(event.target.value)}
          placeholder={"Search backlog…"}
          aria-label="Search backlog"
        />
      </div>

      <div className="web-plan-backlog-scroll">
        {groups.length === 0 ? (
          <p className="web-plan-empty">No outstanding items.</p>
        ) : (
          groups.map((group) => (
            <div className="web-plan-group" key={group.key}>
              <div className="web-plan-group-head">
                <h3 className="web-overline">{group.label}</h3>
                <span className="web-plan-group-total">{formatDurationHours(group.totalMinutes)}</span>
              </div>
              <div className="web-plan-group-items">
                {group.workOrders.map((workOrder) => (
                  <BacklogItem
                    key={workOrder.id}
                    workOrder={workOrder}
                    clientName={clientNameById[workOrder.client_id] ?? "Unknown client"}
                    query={highlightQuery}
                    selected={selectedId === workOrder.id}
                    open={openId === workOrder.id}
                    onSelect={() => onSelect(workOrder)}
                    onOpen={(anchor, viaKeyboard) => onOpen(workOrder, anchor, viaKeyboard)}
                    onDragStart={() => onDragStart(workOrder)}
                    onDragEnd={onDragEnd}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <p className="web-plan-backlog-hint">
        Drag an item onto an engineer, or select it and click a slot. Drag a block back here to unschedule it.
      </p>
    </section>
  );
}

function BacklogItem({
  workOrder,
  clientName,
  query,
  selected,
  open,
  onSelect,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  workOrder: WorkOrderRecord;
  clientName: string;
  query: string;
  selected: boolean;
  open: boolean;
  onSelect: () => void;
  onOpen: (anchor: HTMLElement, viaKeyboard: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const schedulable = workOrder.duration_minutes != null;
  const assetLabel = workOrder.asset
    ? workOrder.asset.name + (workOrder.asset.asset_model?.name ? ` · ${workOrder.asset.asset_model.name}` : "")
    : null;
  const title = workOrderTitle(workOrder);

  function handleDragStart(event: DragEvent<HTMLElement>) {
    if (!schedulable) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", workOrder.id);
    event.dataTransfer.effectAllowed = "move";
    onDragStart();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (schedulable && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <article
      className="web-plan-item"
      style={typeColorStyle(workOrder.work_order_type?.color)}
      data-plan-anchor={workOrder.id}
      data-selected={selected ? "true" : undefined}
      data-open={open ? "true" : undefined}
      draggable={schedulable}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={schedulable ? onSelect : undefined}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={schedulable ? 0 : -1}
      aria-pressed={selected}
      aria-disabled={!schedulable || undefined}
    >
      <div className="web-plan-item-line">
        <Link
          href={`/work-orders/${workOrder.id}`}
          className="web-plan-id"
          draggable={false}
          onClick={(event) => event.stopPropagation()}
        >
          {highlight(workOrder.work_order_number, query)}
        </Link>
        {workOrder.work_order_type ? (
          <span className="web-plan-typebadge">{workOrder.work_order_type.label}</span>
        ) : null}
        <span className="web-plan-spacer" />
        {schedulable ? (
          <WebStatusBadge tone="neutral" size="table" className="web-plan-mono">
            {formatDurationHours(workOrder.duration_minutes!)}
          </WebStatusBadge>
        ) : null}
      </div>
      <div className="web-plan-item-title" title={title}>
        {highlight(title, query)}
      </div>
      <div className="web-plan-item-line">
        <span className="web-plan-item-meta">
          {highlight(clientName, query)}
          {assetLabel ? ` · ${assetLabel}` : ""}
        </span>
        <span className="web-plan-spacer" />
        <button
          type="button"
          className="web-plan-link"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(event.currentTarget.closest<HTMLElement>("[data-plan-anchor]") ?? event.currentTarget, false);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          Details
        </button>
      </div>
      {!schedulable ? <div className="web-plan-item-warn">No duration set</div> : null}
    </article>
  );
}
