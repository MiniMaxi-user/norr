"use client";

import {
  WebMenu,
  WebMultiSelectFilter,
  WebViewSwitcher,
  type WebMenuItem,
  type WebMultiSelectOption,
} from "@yourorg/ui/web-client";
import { WebLinkButton } from "@yourorg/ui/web";
import {
  WORKING_HOURS_PRESETS,
  addDays,
  formatDayHeading,
  formatWeekHeading,
  formatWorkingHours,
  startOfWeek,
  workingHoursKey,
  type WorkingHours,
} from "../date-utils";
import type { PlanningGroup, PlanningView } from "../types";

const GROUP_OPTIONS = [
  { value: "region", label: "By region" },
  { value: "engineer", label: "All engineers" },
] as const;

const VIEW_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
] as const;

export interface PlanningHeaderProps {
  date: Date;
  view: PlanningView;
  group: PlanningGroup;
  hours: WorkingHours;
  query: string;
  typeOptions: readonly WebMultiSelectOption[];
  selectedTypes: ReadonlySet<string>;
  typeSettingsHref: string | null;
  onDateChange: (next: Date) => void;
  onViewChange: (next: PlanningView) => void;
  onGroupChange: (next: PlanningGroup) => void;
  onHoursChange: (next: WorkingHours) => void;
  onQueryChange: (next: string) => void;
  onTypesChange: (next: Set<string>) => void;
  onTypesAll: () => void;
  onTypesDefault: () => void;
}

function isCurrentPeriod(date: Date, view: PlanningView): boolean {
  const now = new Date();
  if (view === "week") return startOfWeek(date).getTime() === startOfWeek(new Date(now.getFullYear(), now.getMonth(), now.getDate())).getTime();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

/**
 * Dark page header of the Planning page (DS 07 section 1): every control lives
 * here — there is no separate FilterBar. Left to right: title, date
 * navigation + Today + Working hours, then (right-aligned) search, Type
 * multiselect, grouping switch, period switch and the gold "New activity"
 * button.
 */
export function PlanningHeader({
  date,
  view,
  group,
  hours,
  query,
  typeOptions,
  selectedTypes,
  typeSettingsHref,
  onDateChange,
  onViewChange,
  onGroupChange,
  onHoursChange,
  onQueryChange,
  onTypesChange,
  onTypesAll,
  onTypesDefault,
}: PlanningHeaderProps) {
  const step = view === "week" ? 7 : 1;
  const currentKey = workingHoursKey(hours);
  const hoursLabel = formatWorkingHours(hours);

  const hourItems: WebMenuItem[] = [...WORKING_HOURS_PRESETS].map((preset) => {
    const active = workingHoursKey(preset) === currentKey;
    return {
      key: workingHoursKey(preset),
      label: (
        <span aria-current={active ? "true" : undefined}>
          {formatWorkingHours(preset)}
          {active ? " ✓" : ""}
        </span>
      ),
      onSelect: () => onHoursChange(preset),
    };
  });
  // A window from a shared link that is not one of the presets stays visible.
  if (!WORKING_HOURS_PRESETS.some((preset) => workingHoursKey(preset) === currentKey)) {
    hourItems.unshift({
      key: currentKey,
      label: <span aria-current="true">{hoursLabel} {"✓"}</span>,
      onSelect: () => onHoursChange(hours),
    });
  }

  return (
    <header className="web-page-header" data-kind="planning" aria-label="Planning">
      <div className="web-plan-header">
        <h1 className="web-page-title">Planning</h1>

        <button
          type="button"
          className="web-plan-ctl"
          data-square="true"
          aria-label={view === "week" ? "Previous week" : "Previous day"}
          onClick={() => onDateChange(addDays(date, -step))}
        >
          {"‹"}
        </button>
        <span className="web-plan-date" aria-live="polite">
          {view === "week" ? formatWeekHeading(date) : formatDayHeading(date)}
        </span>
        <button
          type="button"
          className="web-plan-ctl"
          data-square="true"
          aria-label={view === "week" ? "Next week" : "Next day"}
          onClick={() => onDateChange(addDays(date, step))}
        >
          {"›"}
        </button>
        <button
          type="button"
          className="web-plan-ctl"
          disabled={isCurrentPeriod(date, view)}
          onClick={() => onDateChange(new Date())}
        >
          Today
        </button>
        <WebMenu
          label={`Working hours ${hoursLabel}`}
          align="start"
          triggerClassName="web-plan-ctl"
          trigger={
            <>
              <span className="web-plan-ctl-label">Working hours</span>
              <span>{hoursLabel}</span>
              <span className="web-plan-chevron" aria-hidden="true">
                {"▾"}
              </span>
            </>
          }
          items={hourItems}
        />

        <div className="web-plan-header-end">
          <div className="web-plan-search">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={"Search work order or engineer…"}
              aria-label="Search work order or engineer"
            />
          </div>

          <WebMultiSelectFilter
            label="Type"
            panelTitle="Activity type"
            options={typeOptions}
            selected={selectedTypes}
            onChange={onTypesChange}
            onSelectAll={onTypesAll}
            onSelectDefault={onTypesDefault}
            settingsLink={typeSettingsHref ? { href: typeSettingsHref, label: "Settings › Activity types" } : undefined}
          />

          <WebViewSwitcher
            label="Group by"
            options={GROUP_OPTIONS}
            value={group}
            onChange={(value) => onGroupChange(value as PlanningGroup)}
          />
          <WebViewSwitcher
            label="Period"
            options={VIEW_OPTIONS}
            value={view}
            onChange={(value) => onViewChange(value as PlanningView)}
          />

          <WebLinkButton variant="primary" size="filter" href="/activities/new">
            New activity
          </WebLinkButton>
        </div>
      </div>
    </header>
  );
}
