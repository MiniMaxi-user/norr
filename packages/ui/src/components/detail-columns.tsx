import type { ReactNode } from "react";
import { cx } from "../cx";

export interface DetailColumnsProps {
  /** Slightly wider column (`1.15fr`) — the record's own primary content. */
  left: ReactNode;
  /** `1fr` — secondary/related content. */
  right: ReactNode;
  className?: string;
}

/**
 * The two-column BODY layout for a Pattern A detail page's own flat sections
 * (`docs/DESIGN-SYSTEM.md`'s "Column / rail layout") — a slightly wider left
 * column than the right, `align-items: start` so a short column doesn't
 * stretch to match a taller sibling. Distinct from `FormGrid` (equal-width
 * form-field pairs inside a dialog/form, smaller gap): this is for a page's
 * own stacked `SectionHeader` sections sitting side by side. First caller:
 * the Activity detail redesign (issue #118); any future Pattern A record page
 * with two content columns (Quotes, Projects, Orders) can reuse this rather
 * than hand-rolling its own grid.
 */
export function DetailColumns({ left, right, className }: DetailColumnsProps) {
  return (
    <div className={cx("ui-detail-columns", className)}>
      <div className="ui-detail-columns-left">{left}</div>
      <div className="ui-detail-columns-right">{right}</div>
    </div>
  );
}
