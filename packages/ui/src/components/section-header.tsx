import type { ReactNode } from "react";
import { cx } from "../cx";
import type { Icon } from "../icons";

export interface SectionHeaderProps {
  icon: Icon;
  title: ReactNode;
  /** Small action buttons (e.g. "+ Travel"/"+ Work") rendered after the
   * divider, right-aligned on the same line as the icon/title. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Icon + serif title + a horizontal divider filling the remaining width +
 * trailing actions, all on one line — the "Hours"/"Material"/"Checklist"/
 * "Assignment" section header pattern from the work order detail redesign
 * (issue #102), promoted here since any future record detail page with
 * several stacked sub-sections (Quotes, Projects, Orders) will want the same
 * shape rather than a one-off per module. The divider is a real element
 * (not a `border-bottom` on the whole row) so it sits at title-baseline
 * height between the title and the actions, matching the approved mockup
 * exactly.
 */
export function SectionHeader({ icon: IconComp, title, actions, className }: SectionHeaderProps) {
  return (
    <div className={cx("ui-section-header", className)}>
      <span className="ui-section-header-icon">
        <IconComp />
      </span>
      <h3 className="ui-section-header-title">{title}</h3>
      <span className="ui-section-header-divider" aria-hidden="true" />
      {actions && <div className="ui-section-header-actions">{actions}</div>}
    </div>
  );
}
