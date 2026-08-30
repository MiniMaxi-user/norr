import type { ReactNode } from "react";
import { cx } from "../cx";

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
}

export interface StatStripProps {
  items: StatStripItem[];
  className?: string;
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
 */
export function StatStrip({ items, className }: StatStripProps) {
  return (
    <div className={cx("ui-stat-strip", className)}>
      {items.map((item, index) => (
        <div className="ui-stat-strip-tile" key={index}>
          <span className="ui-stat-strip-label">{item.label}</span>
          <span className="ui-stat-strip-value">{item.value}</span>
          {item.progress !== undefined ? (
            <div className="ui-stat-strip-progress">
              <div
                className="ui-stat-strip-progress-indicator"
                style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }}
              />
            </div>
          ) : item.hint ? (
            <span
              className={cx(
                "ui-stat-strip-hint",
                item.hintTone === "accent" && "ui-stat-strip-hint-accent",
              )}
            >
              {item.hint}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
