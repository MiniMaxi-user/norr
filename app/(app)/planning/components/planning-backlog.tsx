"use client";

import type { DragEvent } from "react";
import { Badge, Card, Inline, Stack, Text, ViewSwitcher, resolveColor, type ViewSwitcherOption } from "@yourorg/ui";
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
  typeFilter: string | null;
  onTypeFilterChange: (value: string | null) => void;
  /** Whether a currently-scheduled block (dragged from the grid) is being
   * dragged right now — enables this panel as a drop target and drives its
   * `onDropToBacklog` accent. `null` while nothing/a backlog card itself is
   * being dragged (dropping an already-unscheduled card back onto its own
   * panel is a no-op, so the panel isn't a live drop target then). */
  draggingScheduledWorkOrder: WorkOrderRecord | null;
  onDropToBacklog: () => void;
}

/**
 * "Werkvoorraad" backlog panel (issue #164) — count badge, type filter
 * pills sourced from the org's own `activity_type` reference items (not
 * hardcoded to Storing/Onderhoud/Inspectie — a tenant can configure more),
 * grouped by region with an hour total per group, draggable cards with a
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
  onTypeFilterChange,
  draggingScheduledWorkOrder,
  onDropToBacklog,
}: PlanningBacklogProps) {
  const filterOptions: ViewSwitcherOption<string>[] = [
    { value: "all", title: "Alle", label: <FilterIcon icon={ClipboardList} label="Alle" /> },
    ...activityTypes.map((type) => ({
      value: type.value,
      title: type.label,
      label: <FilterIcon icon={resolveActivityTypeIcon(type.icon)} label={type.label} />,
    })),
  ];

  const filtered = typeFilter ? workOrders.filter((wo) => wo.work_order_type?.value === typeFilter) : workOrders;
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

        <ViewSwitcher
          aria-label="Filter op type"
          value={typeFilter ?? "all"}
          options={filterOptions}
          onChange={(value) => onTypeFilterChange(value === "all" ? null : value)}
        />

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

/** Icon-only filter pill content: the icon is `aria-hidden` (purely
 * decorative once the pill's accessible name comes from elsewhere) plus a
 * `.ui-visually-hidden` copy of `label` so the button still has a real
 * accessible name for screen readers — `ViewSwitcher`'s own `title` prop
 * (see `filterOptions` above) covers the sighted-mouse-user case. */
function FilterIcon({ icon: IconComponent, label }: { icon: Icon; label: string }) {
  return (
    <>
      <IconComponent aria-hidden width={16} height={16} />
      <span className="ui-visually-hidden">{label}</span>
    </>
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
