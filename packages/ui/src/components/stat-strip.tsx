import type { ReactNode } from "react";
import { cx } from "../cx";

export interface StatStripTrend {
  /** Formatted delta, e.g. "+12%". */
  value: string;
  direction: "up" | "down";
  /** Whether an "up" trend is good; flips the color for "bad when up" metrics. Defaults to "up". */
  positiveWhen?: "up" | "down";
}

export interface StatStripItem {
  label: string;
  value: ReactNode;
  /** Small line under the value — a plain muted hint (e.g. "3 articles") or,
   * when `hintTone: "accent"`, an amber-toned callout (e.g. "Timer running
   * since 12:30"). */
  hint?: ReactNode;
  hintTone?: "muted" | "accent";
  /** 0–100 — renders a thin progress bar instead of `hint` (mutually
   * exclusive; `hint` is ignored when this is set). For a "5 / 7" style
   * completion tile. */
  progress?: number;
  /** Delta shown before the hint, colored success/danger with on-dark variants. */
  trend?: StatStripTrend;
  /** Tiny trend line (polyline, ~64x22) rendered right of the value. */
  spark?: number[];
  /** Group caption ("Finance"). Set it on every item of a group; a caption
   * and a stronger divider appear where the group changes. */
  group?: string;
}

export interface StatStripProps {
  items: StatStripItem[];
  /** Denser tiles with a ~22px value and a responsive auto-fit grid
   * (`minmax(150px, 1fr)`) that wraps on narrow screens. */
  compact?: boolean;
  className?: string;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const width = 64;
  const height = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * (width - 2) + 1;
      const y = height - 2 - ((value - min) / span) * (height - 4) + 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="ui-stat-strip-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

/**
 * A row of KPI tiles baked into a dark record-hero band (`RecordHeroBand`) —
 * e.g. a work order's Hours/Material/Checklist/To invoice strip (issue
 * #102). Deliberately its own component rather than reusing `StatCard`:
 * `StatCard`'s `tone="highlight"` is a single stand-out tile among plain
 * ones on an otherwise light page, where this is the opposite shape — every
 * tile in the strip is uniformly dark, sitting inside an already-dark hero
 * band, tiled edge-to-edge with hairline dividers rather than each being an
 * independent bordered `Card`. Fixed dark surface (not theme-toggle-aware),
 * matching `RecordHeroBand`'s own always-dark-ink treatment.
 *
 * Optional per item: `trend`, `spark` and `group` (dashboard KPI strip).
 */
export function StatStrip({ items, compact, className }: StatStripProps) {
  const hasGroups = items.some((item) => item.group);
  return (
    <div className={cx("ui-stat-strip", compact && "ui-stat-strip-compact", className)}>
      {items.map((item, index) => {
        const groupStart = Boolean(item.group) && item.group !== items[index - 1]?.group;
        const positiveWhen = item.trend?.positiveWhen ?? "up";
        const good = item.trend ? item.trend.direction === positiveWhen : true;
        return (
          <div className={cx("ui-stat-strip-tile", groupStart && index > 0 && "ui-stat-strip-tile-group-start")} key={index}>
            {hasGroups ? <span className="ui-stat-strip-group">{groupStart ? item.group : " "}</span> : null}
            <span className="ui-stat-strip-label">{item.label}</span>
            <span className="ui-stat-strip-value-row">
              <span className="ui-stat-strip-value">{item.value}</span>
              {item.spark ? <Sparkline values={item.spark} /> : null}
            </span>
            {item.progress !== undefined ? (
              <div className="ui-stat-strip-progress">
                <div
                  className="ui-stat-strip-progress-indicator"
                  style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }}
                />
              </div>
            ) : item.trend || item.hint ? (
              <span
                className={cx(
                  "ui-stat-strip-hint",
                  item.hintTone === "accent" && "ui-stat-strip-hint-accent",
                )}
              >
                {item.trend ? (
                  <span className={cx("ui-stat-strip-trend", good ? "ui-stat-strip-trend-good" : "ui-stat-strip-trend-bad")}>
                    {item.trend.direction === "up" ? "▲" : "▼"} {item.trend.value}
                  </span>
                ) : null}
                {item.trend && item.hint ? " " : null}
                {item.hint}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
