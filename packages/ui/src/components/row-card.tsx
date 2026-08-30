import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type RowCardTone = "default" | "highlight" | "dashed";

export interface RowCardProps extends HTMLAttributes<HTMLDivElement> {
  /** `"highlight"` — an amber/in-progress row (e.g. a running time entry).
   * `"dashed"` — a muted, not-yet-done row (e.g. an open checklist item).
   * Defaults to a plain bordered row. */
  tone?: RowCardTone;
  children?: ReactNode;
}

/**
 * A compact list row — flex row of caller-supplied children (a badge/icon,
 * flexible main text, a trailing value/action), replacing a `<Table>` for a
 * short, glanceable sub-list (issue #102: a work order's Hours/Material/
 * Checklist rows). Deliberately unopinionated about its children's shape —
 * each of those three lists needs a different internal composition, only
 * the row chrome (border/radius/padding/tone) is shared.
 */
export function RowCard({ tone = "default", className, children, ...rest }: RowCardProps) {
  return (
    <div
      className={cx("ui-row-card", tone !== "default" && `ui-row-card-${tone}`, className)}
      {...rest}
    >
      {children}
    </div>
  );
}
