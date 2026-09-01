import type { ReactNode } from "react";
import { cx } from "../cx";

export interface OverviewHeroBandProps {
  /** The page's own H1, e.g. "Customer overview" — same large serif
   * typography scale as `RecordHeroBand`'s title. */
  title: ReactNode;
  /** Optional line under the title. */
  subtitle?: ReactNode;
  /** Right-aligned inline KPI readout (e.g. "Klanten" / "Pipeline
   * potential"), rendered to the left of `actions`. Not the same thing as
   * `RecordHeroBand`'s `stats` (a full-width `StatStrip` tiled along the
   * band's bottom edge) — this is a small inline figure group sized to sit
   * next to a view toggle, not a full-bleed strip. */
  stats?: ReactNode;
  /** Right-aligned controls — typically a `ViewToggle` plus a primary
   * "Add …" button. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The dark "ink" header band for a top-level module's OVERVIEW/list page
 * (issue #116) — the same full-bleed `var(--ui-brand-fjord)` visual language
 * as `RecordHeroBand` (which is used on DETAIL pages), reshaped for a list
 * page's own content (page title, optional subtitle, an inline stat readout,
 * right-aligned view-toggle/primary-action controls) instead of a single
 * record's badges/meta/assignee/editable title. Deliberately a separate,
 * smaller component rather than reusing `RecordHeroBand` itself —
 * `RecordHeroBand`'s props (inline-editable title input, breadcrumb-style
 * `recordLabel`, badges, assignee, a full-width `StatStrip`) are shaped for
 * one record and don't fit a list page's needs. See
 * docs/ARCHITECTURE.md's "Overview-page header pattern" for the full
 * reasoning and current rollout status (Clients first; other modules follow
 * one at a time).
 *
 * Same full-bleed trick as `.ui-record-hero-band`: render this as the FIRST
 * element of a page's own content (a sibling BEFORE any `Card`, not nested
 * inside one) — its CSS cancels `--ui-page-inset-x/y` so it sits flush to the
 * sidebar/topbar/viewport edge. Content that wants the light "sheet" look
 * (e.g. search/filter controls) belongs in a normal `Card` sibling rendered
 * BELOW this band instead, back inside the page's normal padding — same
 * precedent `RecordHeroBand`'s own doc comment sets for the work order
 * relation cards. See `app/(app)/clients/components/clients-explorer.tsx` for
 * the reference usage.
 *
 * Fixed dark surface, not theme-toggle-aware — matches `RecordHeroBand` and
 * `.ui-sidebar`'s own permanent "ink" treatment.
 */
export function OverviewHeroBand({ title, subtitle, stats, actions, className }: OverviewHeroBandProps) {
  return (
    <div className={cx("ui-overview-hero-band", className)}>
      <div className="ui-overview-hero-band-main">
        <div className="ui-overview-hero-band-left">
          <h1 className="ui-overview-hero-band-title">{title}</h1>
          {subtitle && <div className="ui-overview-hero-band-subtitle">{subtitle}</div>}
        </div>
        {(stats || actions) && (
          <div className="ui-overview-hero-band-right">
            {stats && <div className="ui-overview-hero-band-stats">{stats}</div>}
            {actions && <div className="ui-overview-hero-band-actions">{actions}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
