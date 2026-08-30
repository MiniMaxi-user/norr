import type { ReactNode } from "react";
import { cx } from "../cx";

export interface SummaryRowItem {
  label: ReactNode;
  value: ReactNode;
  /** `"bold"` — same size, heavier weight (e.g. a Grand Total among plain
   * sub-totals). `"serif"` — a larger serif figure (e.g. a Material total's
   * currency amount), for the one figure on the row that deserves more
   * visual weight than the rest. Omit for a plain muted sub-total. */
  emphasis?: "bold" | "serif";
}

export interface SummaryRowProps {
  items: SummaryRowItem[];
  className?: string;
}

/**
 * A right-aligned totals line under a compact row-card list (issue #102:
 * "Travel 0:50 · Work 3:45 · Total 4:35" under Hours, "Total € 214.60" under
 * Material) — deliberately its own small component so the font-weight/size
 * treatment stays consistent everywhere a list of `RowCard`s needs a totals
 * footer, rather than every call site hand-rolling its own `Inline`.
 */
export function SummaryRow({ items, className }: SummaryRowProps) {
  return (
    <div className={cx("ui-summary-row", className)}>
      {items.map((item, index) => (
        <span key={index} className="ui-summary-row-item">
          <span className="ui-summary-row-label">{item.label}</span>
          <span
            className={cx(
              "ui-summary-row-value",
              item.emphasis === "bold" && "ui-summary-row-value-bold",
              item.emphasis === "serif" && "ui-summary-row-value-serif",
            )}
          >
            {item.value}
          </span>
        </span>
      ))}
    </div>
  );
}
