import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import type { BadgeVariant } from "./badge";

export interface TimelineProps extends HTMLAttributes<HTMLDivElement> {
  /** Column headers — one per day/slot (e.g. `["Mon 24", "Tue 25", ...]`). */
  days: string[];
  children?: ReactNode;
}

/**
 * Timeline — a day-by-resource scheduling grid (dispatch/planning board):
 * one label column plus one column per `days` entry, one row per resource.
 * A single CSS Grid container, not nested per-row grids — `Timeline.Row`
 * renders a `Fragment` of grid items (a label cell + one cell per day) so
 * every row's cells land in the same column tracks as the header, exactly
 * the flat-grid-with-Fragment-rows technique the original hand-rolled
 * Planning story used inline; this just makes it a real, reusable
 * `@yourorg/ui` primitive with real CSS (`.ui-timeline-*`) instead of inline
 * styles. Column count is data-driven — passed through as the
 * `--ui-timeline-days` custom property and consumed by `repeat(var(...), ...)`
 * in `styles.css`, so the grid doesn't need a fixed day count baked in.
 *
 * ```tsx
 * <Timeline days={weekDays}>
 *   {technicians.map((tech) => (
 *     <Timeline.Row
 *       key={tech.id}
 *       label={<Inline gap="sm"><Avatar name={tech.name} size="sm" />{tech.name}</Inline>}
 *       cells={weekDays.map((_, i) => {
 *         const block = scheduleBlocks.find((b) => b.techId === tech.id && b.day === i);
 *         return block && <Timeline.Block key={block.jobId} title={block.title} variant={jobStatusVariant(block.status)} />;
 *       })}
 *     />
 *   ))}
 * </Timeline>
 * ```
 */
export function Timeline({ days, className, style, children, ...rest }: TimelineProps) {
  const gridStyle = { ...style, "--ui-timeline-days": days.length } as CSSProperties;
  return (
    <div className={cx("ui-timeline", className)} style={gridStyle} {...rest}>
      <div className="ui-timeline-header-cell ui-timeline-corner" aria-hidden />
      {days.map((day) => (
        <div key={day} className="ui-timeline-header-cell">
          {day}
        </div>
      ))}
      {children}
    </div>
  );
}

export interface TimelineRowProps {
  /** Resource identity for the row's label column — typically an
   * `Inline`-wrapped `Avatar` + name. */
  label: ReactNode;
  /** One entry per `Timeline`'s `days` column, in order — a `Timeline.Block`
   * for a scheduled slot, or `null`/`undefined`/`false` for an empty one. */
  cells: ReactNode[];
}

/** Renders as a flat run of grid items (no wrapping element) — see the
 * `Timeline` doc comment for why. */
function TimelineRow({ label, cells }: TimelineRowProps) {
  return (
    <>
      <div className="ui-timeline-row-label">{label}</div>
      {cells.map((cell, index) => (
        <div key={index} className="ui-timeline-cell">
          {cell}
        </div>
      ))}
    </>
  );
}

export interface TimelineBlockProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  /** Small secondary line under the title — a status `Badge`, a time range, … */
  meta?: ReactNode;
  /** Color, from the same tone vocabulary `Badge` uses — a left accent bar
   * plus a tinted fill, so a block's status reads at a glance across a busy
   * board. */
  variant?: BadgeVariant;
  onClick?: () => void;
}

/** A single scheduled job slot within a `Timeline.Row`'s day cell. */
function TimelineBlock({ title, meta, variant = "muted", className, onClick, ...rest }: TimelineBlockProps) {
  const interactive = Boolean(onClick);
  return (
    <div
      className={cx(
        "ui-timeline-block",
        `ui-timeline-block-${variant}`,
        interactive && "ui-timeline-block-clickable",
        className,
      )}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      {...rest}
    >
      <span className="ui-timeline-block-title">{title}</span>
      {meta ? <span className="ui-timeline-block-meta">{meta}</span> : null}
    </div>
  );
}

Timeline.Row = TimelineRow;
Timeline.Block = TimelineBlock;
