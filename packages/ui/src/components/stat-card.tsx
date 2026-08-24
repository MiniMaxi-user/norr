import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import { Card } from "./card";
import { ArrowDown, ArrowUp, type Icon } from "../icons";

export interface StatCardTrend {
  /** Formatted delta, e.g. "+12%" or "-3". */
  value: string;
  direction: "up" | "down";
  /** Whether an "up" trend is good — flips the color for metrics like
   * "Overdue jobs" where up is bad. Defaults to "up". */
  positiveWhen?: "up" | "down";
}

export type StatCardTone = "default" | "highlight";

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  value: ReactNode;
  icon?: Icon;
  trend?: StatCardTrend;
  /** Text after the trend delta, e.g. "vs. last month". */
  hint?: string;
  /** `"highlight"` renders a hero KPI tile — a Fjord-to-Mässing gradient
   * fill with Snö-toned text, for the one metric on a page that deserves to
   * stand out (an "Overdue" balance with a CTA, e.g.). Defaults to
   * `"default"` (plain `Card`). */
  tone?: StatCardTone;
  /** Small action slot (typically a `Button variant="primary" size="sm"`)
   * rendered under the value/trend — e.g. a highlight card's CTA. On a
   * `tone="highlight"` card, use `variant="primary"` so the button reads as
   * brass-on-gradient instead of inheriting the (repointed, gradient) default
   * button surface. */
  action?: ReactNode;
}

/** KPI tile: label, big value, optional icon chip and trend delta. Generic
 * and data-agnostic — call sites decide what the metric means. Built on
 * `Card`, matching the norrdesign reference this was ported from. */
export function StatCard({ label, value, icon: IconComp, trend, hint, tone = "default", action, className, ...rest }: StatCardProps) {
  const positiveWhen = trend?.positiveWhen ?? "up";
  const isPositive = trend ? trend.direction === positiveWhen : true;
  const TrendIcon = trend?.direction === "down" ? ArrowDown : ArrowUp;

  return (
    <Card className={cx("ui-stat-card", tone === "highlight" && "ui-stat-card-highlight", className)} {...rest}>
      <div className="ui-stat-card-header">
        <span className="ui-stat-card-label">{label}</span>
        {IconComp ? (
          <span className="ui-stat-card-icon">
            <IconComp />
          </span>
        ) : null}
      </div>
      <p className="ui-stat-card-value">{value}</p>
      {trend ? (
        <div className="ui-stat-card-trend">
          <span
            className={cx(
              "ui-stat-card-trend-delta",
              isPositive ? "ui-stat-card-trend-up" : "ui-stat-card-trend-down",
            )}
          >
            <TrendIcon />
            {trend.value}
          </span>
          {hint ? <span className="ui-stat-card-hint">{hint}</span> : null}
        </div>
      ) : hint ? (
        <p className="ui-stat-card-hint">{hint}</p>
      ) : null}
      {action ? <div className="ui-stat-card-action">{action}</div> : null}
    </Card>
  );
}
