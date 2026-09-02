import type { ReactNode } from "react";
import Link from "next/link";
import { cx } from "../cx";

export interface RecordHeroBandProps {
  /** Breadcrumb-style top-left line, e.g. "Work Orders / WO-2026-0148" —
   * `recordLabel` links to the list, `recordCode` (monospace, current-page
   * styling) is omitted while the record doesn't exist yet (create mode).
   * Omit `recordLabel` entirely (along with `topRight`) when the page's own
   * `Breadcrumbs` (rendered in the Topbar via `usePageHeader`) already say
   * the same thing — issue #103 removed work orders' redundant second
   * "Work Orders" label repeated inside this band; the whole top row then
   * doesn't render at all rather than leaving an empty strip. */
  recordLabel?: ReactNode;
  recordHref?: string;
  recordCode?: ReactNode;
  /** Top-right of that same line, e.g. "Created 24 Aug · Marijke Vos" —
   * omitted in create mode (nothing saved yet to have been created), and
   * generally better suited to living in the page's own Assignment/metadata
   * section instead of this band (issue #103: work orders moved their
   * "Created …" line out of here for that reason). */
  topRight?: ReactNode;
  /** Status/priority/type pills, rendered above the title. */
  badges?: ReactNode;
  /** The record's own title — large serif heading. Pass a plain heading for
   * a read-only render, or an `<input>` styled to match (`ui-record-hero-band-title-input`)
   * for an inline-editable one. */
  title: ReactNode;
  /** Icon+text facts under the title (client name, site, scheduled date…),
   * rendered left-to-right with even spacing (no separator — each item
   * already carries its own icon). */
  meta?: ReactNode[];
  /** Top-right action buttons (Save, Create Quote, Mark done…). */
  actions?: ReactNode;
  /** Assignee block under the actions — an avatar + name/role. */
  assignee?: ReactNode;
  /** The KPI tile strip baked into the bottom of the band — typically a
   * `<StatStrip>`. */
  stats?: ReactNode;
  /** Adds the bottom padding a `stats` strip's own flat edge would otherwise
   * provide (issue #118's Activity redesign — the first page to render this
   * band with no `stats` at all). Omit whenever `stats` IS passed; the two
   * are mutually exclusive in practice, nothing needs both. */
  noStats?: boolean;
  className?: string;
}

/**
 * The dark "ink" header band for a top-level record's detail page (issue
 * #102's work order redesign is the first caller: badges-above-title, a
 * large serif title, an icon+text meta row, right-aligned actions + assignee,
 * and a stat-tile strip baked into the bottom) — deliberately its own
 * component rather than a dark variant of `DetailHero`: the two have almost
 * no shape in common (badges before the title vs. after, no avatar-mark, an
 * assignee block, a stats strip) beyond both being "the header of a detail
 * page".
 *
 * *** Issue #103 *** made this a full-bleed strip: render it as the very
 * FIRST element of a page's own content (a sibling BEFORE any `Card`, not
 * nested inside one) — its own CSS cancels `.ui-app-layout-content`'s padding
 * so it sits flush to the sidebar/topbar/viewport edge and ends in a straight
 * horizontal line, rather than issue #102's original "first child of a
 * `Card className=\"ui-card-flush-xl\"`" sheet (a rounded card can't also be
 * flush to the viewport edge — the two asks are mutually exclusive). Content
 * that still wants the light "sheet" look (e.g. work orders' Client/Site/
 * Asset/Contract relation cards) belongs in a normal `Card` sibling rendered
 * BELOW this band instead — see
 * `app/(app)/work-orders/components/work-order-hero.tsx` for the reference
 * usage.
 *
 * Fixed dark surface, not theme-toggle-aware (matches `.ui-sidebar`'s own
 * permanent "ink" treatment) — product feedback on the approved mockup was
 * explicit that this band stays dark regardless of the page's light/dark
 * theme.
 */
export function RecordHeroBand({
  recordLabel,
  recordHref,
  recordCode,
  topRight,
  badges,
  title,
  meta = [],
  actions,
  assignee,
  stats,
  noStats,
  className,
}: RecordHeroBandProps) {
  return (
    <div className={cx("ui-record-hero-band", noStats && "ui-record-hero-band-no-stats", className)}>
      {(recordLabel || topRight) && (
        <div className="ui-record-hero-band-top">
          {recordLabel && (
            <div className="ui-record-hero-band-breadcrumb">
              {recordHref ? <Link href={recordHref}>{recordLabel}</Link> : <span>{recordLabel}</span>}
              {recordCode && (
                <>
                  <span className="ui-record-hero-band-breadcrumb-sep">/</span>
                  <span className="ui-record-hero-band-code">{recordCode}</span>
                </>
              )}
            </div>
          )}
          {topRight && <span>{topRight}</span>}
        </div>
      )}

      <div className="ui-record-hero-band-main">
        <div className="ui-record-hero-band-left">
          {badges && <div className="ui-record-hero-band-badges">{badges}</div>}
          {title}
          {meta.length > 0 && (
            <div className="ui-record-hero-band-meta">
              {meta.map((item, index) => (
                <span className="ui-record-hero-band-meta-item" key={index}>
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>
        {(actions || assignee) && (
          <div className="ui-record-hero-band-right">
            {actions && <div className="ui-record-hero-band-actions">{actions}</div>}
            {assignee && <div className="ui-record-hero-band-assignee">{assignee}</div>}
          </div>
        )}
      </div>

      {stats && <div className="ui-record-hero-band-stats">{stats}</div>}
    </div>
  );
}
