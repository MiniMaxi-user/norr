"use client";

import { Button, IconButton, Text, ViewSwitcher, type ViewSwitcherOption } from "@yourorg/ui";
import { ChevronLeft, ChevronRight } from "@yourorg/ui/icons";
import { CreateActivityButton } from "@/app/(app)/activities/components/create-activity-button";
import { addDays, formatDayHeading, formatWeekHeading, isToday } from "../date-utils";
import type { PlanningGroup, PlanningView } from "../types";

const VIEW_OPTIONS: readonly ViewSwitcherOption<PlanningView>[] = [
  { value: "day", label: "Dag" },
  { value: "week", label: "Week" },
];

const GROUP_OPTIONS: readonly ViewSwitcherOption<PlanningGroup>[] = [
  { value: "region", label: "Per regio" },
  { value: "engineer", label: "Alle monteurs" },
];

export interface PlanningTopbarProps {
  date: Date;
  view: PlanningView;
  group: PlanningGroup;
  onDateChange: (next: Date) => void;
  onViewChange: (next: PlanningView) => void;
  onGroupChange: (next: PlanningGroup) => void;
}

/**
 * The dark control bar (issue #164): date nav (‹ / heading / ›), a
 * "Vandaag" shortcut, the static "08:00–18:00" visible-hours label, the
 * GROEPEREN (Per regio / Alle monteurs) and Dag/Week `ViewSwitcher`s, and
 * the "+ Melding" trigger — reuses the existing `CreateActivityButton`
 * (`app/(app)/activities/components/create-activity-button.tsx`) rather
 * than a bespoke Planning-only "new activity" trigger.
 */
export function PlanningTopbar({ date, view, group, onDateChange, onViewChange, onGroupChange }: PlanningTopbarProps) {
  const step = view === "week" ? 7 : 1;

  return (
    <div className="ui-planning-topbar">
      <div className="ui-planning-topbar-left">
        <IconButton
          aria-label={view === "week" ? "Vorige week" : "Vorige dag"}
          variant="ghost"
          onClick={() => onDateChange(addDays(date, -step))}
        >
          <ChevronLeft aria-hidden />
        </IconButton>
        <Text className="ui-planning-topbar-date">
          {view === "week" ? formatWeekHeading(date) : formatDayHeading(date)}
        </Text>
        <IconButton
          aria-label={view === "week" ? "Volgende week" : "Volgende dag"}
          variant="ghost"
          onClick={() => onDateChange(addDays(date, step))}
        >
          <ChevronRight aria-hidden />
        </IconButton>
        <Button variant="outline" size="sm" disabled={isToday(date)} onClick={() => onDateChange(new Date())}>
          Vandaag
        </Button>
        <Text tone="muted" className="ui-planning-topbar-hours">
          08:00 – 18:00
        </Text>
      </div>

      <div className="ui-planning-topbar-right">
        <Text className="ui-planning-topbar-label">Groeperen</Text>
        <ViewSwitcher aria-label="Groeperen op" value={group} options={GROUP_OPTIONS} onChange={onGroupChange} />
        <ViewSwitcher aria-label="Dag- of weekweergave" value={view} options={VIEW_OPTIONS} onChange={onViewChange} />
        <CreateActivityButton label="+ Melding" size="sm" />
      </div>
    </div>
  );
}
