import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import { resolveColor } from "./badge";

/**
 * SchedulerGrid — half-hour-precision, day-by-resource dispatch board (issue
 * #164, Planning module's Day view). Sibling of `Timeline`
 * (`./timeline.tsx`, a day-by-resource grid where each cell holds exactly
 * one whole-day block) rather than an extension of it: Planning's Day view
 * needs a scheduled block to SPAN a variable number of half-hour columns
 * (`duration_minutes / 30`) and needs empty, individually
 * interactive/droppable slot cells underneath — different enough from
 * Timeline's "one block per day cell" contract that widening Timeline's own
 * props risked breaking its existing "day columns" semantics for its
 * existing consumer (`app/(app)/assets/components/asset-recent-activities.tsx`).
 * Week view (Planning's simplified, non-drag summary) reuses `Timeline`
 * itself instead of this component — see that module for why.
 *
 * Same "one flat CSS Grid, `Row` contributes items rather than a nested grid
 * of its own" technique `Timeline` established (see that file's doc
 * comment), generalized so one item (`SchedulerGrid.Block`) can span
 * multiple column tracks: CSS Grid's implicit auto-placement algorithm
 * (`grid-auto-flow: row`, the default) places each item in the next
 * available track regardless of how many tracks it consumes, then wraps to
 * the next row once a row's tracks are full — so a caller building one
 * `Row`'s `cells` array purely needs to supply, in left-to-right order,
 * either a `SchedulerGrid.Cell` (1 track) or a `SchedulerGrid.Block` (`span`
 * tracks) for every slot, with no manual `grid-column`/`grid-row` line-number
 * bookkeeping required.
 *
 * Deliberately hook-free, matching this package's established convention for
 * every compound component reachable from the main `dist/index.js` entry
 * (`Board`, `Timeline`, `DropdownMenu`, ...) — see `board.tsx`'s own doc
 * comment for why. Drag-and-drop STATE (which item is being dragged, live
 * fit/overlap preview, optimistic scheduling) and EVENT HANDLERS belong
 * entirely to the "use client" call site
 * (`app/(app)/planning/components/planning-grid.tsx`) — this file only
 * renders boxes and forwards whatever `onDragOver`/`onDrop`/`onClick`/
 * `onKeyDown` props the caller passes down (all covered by `HTMLAttributes`).
 *
 * ```tsx
 * <SchedulerGrid columnLabels={["08:00", "09:00", ...]} slotsPerLabel={2}>
 *   {engineers.map((engineer) => (
 *     <SchedulerGrid.Row
 *       key={engineer.id}
 *       label={<Inline gap="sm"><Avatar name={engineer.name} size="sm" />{engineer.name}</Inline>}
 *       cells={buildRowCells(engineer)}
 *     />
 *   ))}
 * </SchedulerGrid>
 * ```
 */
export interface SchedulerGridProps extends HTMLAttributes<HTMLDivElement> {
  /** Header labels shown once per `slotsPerLabel` underlying grid column
   * tracks — e.g. hour ticks (`"08:00".."17:00"`) over a half-hour-precision
   * grid (`slotsPerLabel={2}`). */
  columnLabels: string[];
  /** How many underlying grid column tracks each `columnLabels` entry spans. */
  slotsPerLabel: number;
  children?: ReactNode;
}

export function SchedulerGrid({
  columnLabels,
  slotsPerLabel,
  className,
  style,
  children,
  ...rest
}: SchedulerGridProps) {
  const totalSlots = columnLabels.length * slotsPerLabel;
  const gridStyle = { ...style, "--ui-scheduler-grid-slots": totalSlots } as CSSProperties;
  return (
    <div className={cx("ui-scheduler-grid", className)} style={gridStyle} {...rest}>
      <div className="ui-scheduler-grid-header-cell ui-scheduler-grid-corner" aria-hidden />
      {columnLabels.map((label) => (
        <div
          key={label}
          className="ui-scheduler-grid-header-cell"
          style={{ gridColumn: `span ${slotsPerLabel}` }}
        >
          {label}
        </div>
      ))}
      {children}
    </div>
  );
}

export interface SchedulerGridRowProps {
  /** Resource identity for the row's label column — typically an
   * `Inline`-wrapped `Avatar` + name. */
  label: ReactNode;
  /** One entry per rendered grid item in this row, left to right — a plain
   * `SchedulerGrid.Cell` (one track) or a `SchedulerGrid.Block` (`span`
   * tracks). The caller is responsible for supplying entries that together
   * account for every underlying slot (accounting for each block's own
   * `span`) — see this file's doc comment for why no explicit grid-line
   * placement is needed beyond that. */
  cells: ReactNode[];
}

/** Renders as a flat run of grid items (no wrapping element) — see the
 * `SchedulerGrid` doc comment for why. */
function SchedulerGridRow({ label, cells }: SchedulerGridRowProps) {
  return (
    <>
      <div className="ui-scheduler-grid-row-label">{label}</div>
      {cells}
    </>
  );
}

export interface SchedulerGridCellProps extends HTMLAttributes<HTMLDivElement> {
  /** Not a valid drop/click target right now — rendered `aria-disabled` with
   * a muted visual treatment, but stays present (not hidden) so a keyboard/
   * click-fallback actor can still see the whole row's shape. Distinct from
   * `preview` below: `disabled` is for the non-drag click-to-schedule
   * fallback (every invalid cell disabled at once while something is
   * selected); `preview` is for the live drag-hover accent (one candidate
   * slot at a time). */
  disabled?: boolean;
  /** Live drag-hover accent — `"valid"` (green) while dragging a fitting
   * item over this cell, `"invalid"` (red) while dragging a non-fitting one.
   * The call site computes fit/overlap against already-loaded data (a
   * preview of the same rule `scheduleWorkOrder` enforces authoritatively
   * server-side — see that action's own doc comment). */
  preview?: "valid" | "invalid";
}

/** Same keyboard-operability pattern `Board.Card` established (see
 * `board.tsx`'s own doc comment): a cell only becomes a focusable/
 * Enter-Space-activatable `role="button"` when the caller actually passes
 * `onClick` — i.e. only while it's a live, valid target for the non-drag
 * click-to-select-then-click-slot fallback (`planning-grid.tsx` omits
 * `onClick` entirely for every cell when nothing is selected, or for a
 * `disabled` cell, so the grid isn't a wall of empty tab stops the rest of
 * the time). */
function SchedulerGridCell({ className, disabled, preview, onClick, onKeyDown, tabIndex, role, ...rest }: SchedulerGridCellProps) {
  const interactive = Boolean(onClick) && !disabled;
  return (
    <div
      className={cx(
        "ui-scheduler-grid-cell",
        disabled && "ui-scheduler-grid-cell-disabled",
        preview && `ui-scheduler-grid-cell-${preview}`,
        className,
      )}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      role={role ?? (interactive ? "button" : undefined)}
      tabIndex={tabIndex ?? (interactive ? 0 : undefined)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (interactive && !event.defaultPrevented && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick?.(event as unknown as Parameters<NonNullable<typeof onClick>>[0]);
        }
      }}
      {...rest}
    />
  );
}

export interface SchedulerGridBlockProps extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "color"> {
  title: ReactNode;
  /** Small secondary line under the title — a client/location name, a time
   * range, ... */
  meta?: ReactNode;
  /** Tenant-configurable color (named swatch or hex) — same `Badge`/
   * `resolveColor` contract as everywhere else this codebase surfaces a
   * reference-list item's color. `null`/unset falls back to a neutral
   * treatment. */
  color?: string | null;
  /** How many underlying grid column tracks this block spans — e.g.
   * `duration_minutes / 30` on a half-hour grid. */
  span: number;
  onClick?: () => void;
}

/** A single scheduled item within a `SchedulerGrid.Row`, spanning `span`
 * column tracks starting at its position in document order (see the file
 * doc comment on why no explicit grid-column start is needed). */
function SchedulerGridBlock({
  title,
  meta,
  color,
  span,
  className,
  style,
  onClick,
  onKeyDown,
  ...rest
}: SchedulerGridBlockProps) {
  const hex = resolveColor(color);
  const interactive = Boolean(onClick);
  const blockStyle: CSSProperties = {
    gridColumn: `span ${span}`,
    ...(hex ? { backgroundColor: `${hex}22`, borderLeftColor: hex } : {}),
    ...style,
  };
  return (
    <div
      className={cx("ui-scheduler-grid-block", interactive && "ui-scheduler-grid-block-clickable", className)}
      style={blockStyle}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (interactive && !event.defaultPrevented && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick?.();
        }
      }}
      {...rest}
    >
      <span className="ui-scheduler-grid-block-title">{title}</span>
      {meta ? <span className="ui-scheduler-grid-block-meta">{meta}</span> : null}
    </div>
  );
}

SchedulerGrid.Row = SchedulerGridRow;
SchedulerGrid.Cell = SchedulerGridCell;
SchedulerGrid.Block = SchedulerGridBlock;
