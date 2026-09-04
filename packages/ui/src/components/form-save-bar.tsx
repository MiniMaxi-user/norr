import type { ReactNode } from "react";
import { cx } from "../cx";

export interface FormSaveBarProps {
  /** Left-aligned save-state line, e.g. "All changes saved" / "Unsaved
   * changes" / "Required: Client, Site, Type" — plain text/`Text`, this
   * component doesn't interpret it. */
  label: ReactNode;
  /** Right-aligned action buttons, e.g. Cancel + a primary Save. */
  actions: ReactNode;
  className?: string;
}

/**
 * A sticky bottom save bar for a full-page create/edit form — a save-state
 * label on the left, Cancel/Save actions on the right. First caller: the
 * Asset new/edit page (asset new/edit design handoff, "Asset New-Edit"
 * variant A) — deliberately generic (a label slot + an actions slot, nothing
 * asset-specific) so any future full-page record form (Contracts, Quotes,
 * Projects/Orders) can reuse it instead of hand-rolling its own footer `div`,
 * per CLAUDE.md rule 4 (no ad-hoc styling in the app repo) and the same
 * "generalize the first time a shape repeats" precedent `RecordHeroBand`/
 * `RelationCard` already set.
 *
 * Sticks to the bottom of whichever scrolling ancestor it lives in — inside
 * `AppShell` that's `.ui-app-layout-content` (see `.ui-toolbar`'s identical
 * `position: sticky` comment for the same mechanic used at the top of that
 * same scroll container) — and cancels that container's own bottom/side
 * inset padding the same way `.ui-record-hero-band` cancels the top/side
 * padding, so it reads as a flush, full-width bar rather than a floating
 * card.
 */
export function FormSaveBar({ label, actions, className }: FormSaveBarProps) {
  return (
    <div className={cx("ui-form-save-bar", className)}>
      <span className="ui-form-save-bar-label">{label}</span>
      <div className="ui-form-save-bar-actions">{actions}</div>
    </div>
  );
}
