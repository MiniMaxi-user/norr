import type { ReactNode } from "react";
import { cx } from "../cx";

export interface DetailColumnsProps {
  /** The wider column — the record's own primary content. */
  left: ReactNode;
  /** The narrower column — secondary/related content. */
  right: ReactNode;
  /** `"balanced"` (default) — `minmax(0, 1.15fr) minmax(0, 1fr)`, two
   * roughly-equal content columns (Activity's Hours/Material-style pair).
   * `"rail"` — `minmax(0, 1.85fr) minmax(0, 1fr)`, a wide primary work
   * column beside a narrow facts rail (the Contract detail "1b" layout,
   * docs/designinstructieskanweg/"Contract detail 1b - implementatie.md":
   * line items/coverage/assets on the left, Client/Terms/Dates/Notes as a
   * narrow rail on the right). */
  ratio?: "balanced" | "rail";
  className?: string;
}

/**
 * The two-column BODY layout for a Pattern A detail page's own flat sections
 * (`docs/DESIGN-SYSTEM.md`'s "Column / rail layout") — `align-items: start`
 * so a short column doesn't stretch to match a taller sibling. Distinct from
 * `FormGrid` (equal-width form-field pairs inside a dialog/form, smaller
 * gap): this is for a page's own stacked `SectionHeader` sections sitting
 * side by side. First caller: the Activity detail redesign (issue #118); any
 * future Pattern A record page with two content columns (Quotes, Projects,
 * Orders) can reuse this rather than hand-rolling its own grid.
 */
export function DetailColumns({ left, right, ratio = "balanced", className }: DetailColumnsProps) {
  return (
    <div className={cx("ui-detail-columns", ratio === "rail" && "ui-detail-columns-rail", className)}>
      <div className="ui-detail-columns-left">{left}</div>
      <div className="ui-detail-columns-right">{right}</div>
    </div>
  );
}
