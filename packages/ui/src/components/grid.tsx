import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type GridColumns = 1 | 2 | 3 | 4 | "2-1" | "1-2" | "2-1-1";

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /** Column layout; collapses on narrower viewports. `"2-1"` / `"1-2"` are a
   * wide + narrow pair (e.g. a trend chart beside a donut). Defaults to 2. */
  columns?: GridColumns;
  children?: ReactNode;
}

/** Responsive dashboard grid: equal columns (or a wide/narrow pair) that
 * collapse to fewer columns, then one, as the viewport narrows. */
export function Grid({ columns = 2, className, children, ...rest }: GridProps) {
  return (
    <div className={cx("ui-grid", `ui-grid-${columns}`, className)} {...rest}>
      {children}
    </div>
  );
}
