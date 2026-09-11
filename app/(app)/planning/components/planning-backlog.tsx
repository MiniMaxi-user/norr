"use client";

import type { DragEvent } from "react";
import { Badge, Button, Card, Inline, Stack, Text, resolveColor } from "@yourorg/ui";
import { ClipboardList, type Icon } from "@yourorg/ui/icons";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { resolveActivityTypeIcon } from "@/app/(app)/activities/icon-map";
import { groupBacklogByRegion } from "../grouping";
import { formatDurationHours } from "../date-utils";

export interface PlanningBacklogProps {
  workOrders: WorkOrderRecord[];
  regions: ReferenceListItemRecord[];
  activityTypes: ReferenceListItemRecord[];
  siteRegionById: Record<string, string | null>;
  clientNameById: Record<string, string>;
  selectedId: string | null;
  onSelect: (workOrder: WorkOrderRecord) => void;
  onDragStart: (workOrder: WorkOrderRecord) => void;
  onDragEnd: () => void;
  /** Multi-select: which `activity_type` `value`s are currently checked. An
   * EMPTY set means "Alle" (no filter) — see `planning-screen.tsx`'s own
   * comment on `typeFilter`'s state shape for why there's no separate "all"
   * sentinel. */
  typeFilter: Set<string>;
  onToggleType: (value: string) => void;
  onClearTypeFilter: () => void;
  /** Whether a currently-scheduled block (dragged from the grid) is being
   * dragged right now — enables this panel as a drop target and drives its
   * `onDropToBacklog` accent. `null` while nothing/a backlog card itself is
   * being dragged (dropping an already-unscheduled card back onto its own
   * panel is a no-op, so the panel isn't a live drop target then). */
  draggingScheduledWorkOrder: WorkOrderRecord | null;
  onDropToBacklog: () => void;
}

/**
 * "Werkvoorraad" backlog panel (issue #164) — count badge, a MULTI-SELECT
 * type filter (`FilterPill` below) sourced from the org's own `activity_type`
 * reference items (not hardcoded to Storing/Onderhoud/Inspectie — a tenant
 * can configure more; those three are just the default-checked selection,
 * see `planning-screen.tsx`'s `DEFAULT_TYPE_FILTER`), grouped by region with
 * an hour total per group, draggable cards with a
 * colored left border matching the item's type color, and (if the linked
 * asset has a catalog model set) its model name — see `WorkOrderRecord.asset`'s
 * own comment. A card is also click-to-select
 * (visible `aria-pressed` state) — the non-drag accessible fallback
 * described in the module's build plan: select a card here, then click a
 * valid grid cell in `planning-grid.tsx` to schedule it via the same
 * `scheduleWorkOrder` action a drop would call.
 *
 * Header (title/count), the type filter, and the footer hint stay fixed;
 * only the grouped card list (`.ui-planning-backlog-scroll`) scrolls, and
 * independently of `PlanningGrid`'s own scroll — both panels are given a
 * fixed height by `.ui-planning-layout` (itself filling the remaining space
 * below the full-bleed topbar, see `.ui-planning-page`/`.ui-planning-topbar`
 * in `packages/ui/src/styles.css`), same "pinned header/footer, `flex: 1` +
 * `min-height: 0` + `overflow-y: auto` body" technique `.ui-dialog-body`
 * already establishes (see that rule's own doc comment for why the
 * `min-height: 0` is the actual fix).
 */
export function PlanningBacklog({
  workOrders,
  regions,
  activityTypes,
  siteRegionById,
  clientNameById,
  selectedId,
  onSelect,
  onDragStart,
  onDragEnd,
  typeFilter,
  onToggleType,
  onClearTypeFilter,
  draggingScheduledWorkOrder,
  onDropToBacklog,
}: PlanningBacklogProps) {
  const filtered =
    typeFilter.size === 0 ? workOrders : workOrders.filter((wo) => wo.work_order_type && typeFilter.has(wo.work_order_type.value));
  const groups = groupBacklogByRegion(filtered, regions, siteRegionById);

  const acceptingDrop = draggingScheduledWorkOrder != null;

  return (
    <Card
      className={acceptingDrop ? "ui-planning-backlog ui-planning-backlog-drop-target" : "ui-planning-backlog"}
      onDragOver={(event) => {
        if (acceptingDrop) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!acceptingDrop) return;
        event.preventDefault();
        onDropToBacklog();
      }}
    >
      <Stack gap="md" className="ui-planning-backlog-stack">
        <Inline justify="between" align="center">
          <Text className="ui-planning-backlog-title">Werkvoorraad</Text>
          <Badge variant="muted">{workOrders.length}</Badge>
        </Inline>

        <Inline gap="xs" wrap role="group" aria-label="Filter op type">
          <FilterPill
            active={typeFilter.size === 0}
            title="Alle"
            icon={ClipboardList}
            colorHex={null}
            onClick={onClearTypeFilter}
          />
          {activityTypes.map((type) => (
            <FilterPill
              key={type.value}
              active={typeFilter.has(type.value)}
              title={type.label}
              icon={resolveActivityTypeIcon(type.icon)}
              colorHex={resolveColor(type.color)}
              onClick={() => onToggleType(type.value)}
            />
          ))}
        </Inline>

        <div className="ui-planning-backlog-scroll">
          {groups.length === 0 ? (
            <Text tone="muted">Geen openstaande items.</Text>
          ) : (
            <Stack gap="md">
              {groups.map((group) => (
                <Stack gap="sm" key={group.key}>
                  <Inline justify="between" align="center">
                    <Text className="ui-planning-backlog-group-label">{group.label.toUpperCase()}</Text>
                    <Text tone="muted" className="ui-planning-backlog-group-total">
                      {formatDurationHours(group.totalMinutes)}
                    </Text>
                  </Inline>
                  <Stack gap="sm">
                    {group.workOrders.map((workOrder) => (
                      <BacklogCard
                        key={workOrder.id}
                        workOrder={workOrder}
                        clientName={clientNameById[workOrder.client_id] ?? "Onbekende klant"}
                        selected={selectedId === workOrder.id}
                        onSelect={() => onSelect(workOrder)}
                        onDragStart={() => onDragStart(workOrder)}
                        onDragEnd={onDragEnd}
                      />
                    ))}
                  </Stack>
                </Stack>
              ))}
            </Stack>
          )}
        </div>

        <Text tone="muted" className="ui-planning-backlog-hint">
          Sleep een item naar een monteur. Klik een gepland blok om het terug te zetten.
        </Text>
      </Stack>
    </Card>
  );
}

/** One multi-select type-filter toggle — icon-only (the icon is
 * `aria-hidden`, purely decorative once the button's accessible name comes
 * from the `.ui-visually-hidden` copy of `title` below), a native `title`
 * tooltip for sighted mouse users, and a colored left edge
 * (`.ui-planning-filter-pill`, same "resolved hex → CSS custom property"
 * technique `BacklogCard`'s own left border already uses) so each type
 * reads at a glance even collapsed to just its icon. `colorHex={null}`
 * (the "Alle" pill) falls back to a neutral `--ui-border-strong` edge,
 * deliberately never resolving to any real type's color, so "Alle" always
 * reads as "not a specific type" rather than looking like it belongs to
 * whichever type happens to be first. Not `ViewSwitcher`: this is a
 * multi-select toggle group (any number of pills can be active at once,
 * including "Alle" as its own independent "clear filter" action), not
 * ViewSwitcher's single-selection model — see `planning-screen.tsx`'s
 * `typeFilter`/`toggleTypeFilter`/`clearTypeFilter` for the state shape. */
function FilterPill({
  active,
  title,
  icon: IconComponent,
  colorHex,
  onClick,
}: {
  active: boolean;
  title: string;
  icon: Icon;
  colorHex: string | null;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "primary" : "outline"}
      size="sm"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className="ui-planning-filter-pill"
      style={{ borderLeftColor: colorHex ?? "var(--ui-border-strong)" }}
    >
      <IconComponent aria-hidden width={16} height={16} />
      <span className="ui-visually-hidden">{title}</span>
    </Button>
  );
}

function BacklogCard({
  workOrder,
  clientName,
  selected,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  workOrder: WorkOrderRecord;
  clientName: string;
  selected: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const schedulable = workOrder.duration_minutes != null;
  const hex = resolveColor(workOrder.work_order_type?.color);
  const assetModel = workOrder.asset?.asset_model?.name ?? null;

  function handleDragStart(event: DragEvent<HTMLElement>) {
    if (!schedulable) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", workOrder.id);
    event.dataTransfer.effectAllowed = "move";
    onDragStart();
  }

  return (
    <article
      className="ui-planning-backlog-card"
      style={{ borderLeftColor: hex ?? "var(--ui-border-strong)" }}
      draggable={schedulable}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={schedulable ? onSelect : undefined}
      role="button"
      tabIndex={schedulable ? 0 : -1}
      aria-pressed={selected}
      aria-disabled={!schedulable || undefined}
      onKeyDown={(event) => {
        if (schedulable && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onSelect();
        }
      }}
      data-selected={selected || undefined}
    >
      <Inline justify="between" align="start" gap="sm">
        <Text className="ui-planning-backlog-card-title">{workOrder.title}</Text>
        {workOrder.work_order_type && <Badge color={workOrder.work_order_type.color}>{workOrder.work_order_type.label}</Badge>}
      </Inline>
      <Text tone="muted" className="ui-planning-backlog-card-meta">
        {clientName}
        {assetModel ? ` · ${assetModel}` : ""}
      </Text>
      <Inline justify="end">
        {schedulable ? (
          <Badge variant="muted">{formatDurationHours(workOrder.duration_minutes!)}</Badge>
        ) : (
          <Text tone="danger" className="ui-planning-backlog-card-meta">
            Geen duur ingesteld
          </Text>
        )}
      </Inline>
    </article>
  );
}
