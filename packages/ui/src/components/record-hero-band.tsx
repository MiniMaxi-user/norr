import type { ReactNode } from "react";
import Link from "next/link";
import { cx } from "../cx";

export interface RecordHeroBandProps {
  /** Breadcrumb-style top-left line, e.g. "Work Orders / WO-2026-0148" —
   * `recordLabel` links to the list, `recordCode` (monospace, current-page
   * styling) is omitted while the record doesn't exist yet (create mode). */
  recordLabel: ReactNode;
  recordHref?: string;
  recordCode?: ReactNode;
  /** Top-right of that same line, e.g. "Created 24 Aug · Marijke Vos" —
   * omitted in create mode (nothing saved yet to have been created). */
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
  className?: string;
}

/**
 * The dark "ink" header band for a top-level record's detail page (issue
 * #102's work order redesign is the first caller: breadcrumb + created-by
 * line, badges-above-title, a large serif title, an icon+text meta row,
 * right-aligned actions + assignee, and a stat-tile strip baked into the
 * bottom) — deliberately its own component rather than a dark variant of
 * `DetailHero`: the two have almost no shape in common (badges before the
 * title vs. after, no avatar-mark, an assignee block, a stats strip) beyond
 * both being "the header of a detail page". Render this as the first child
 * of a `Card` with `className="ui-card-flush-xl"` (zero padding, `16px`
 * radius, `overflow: hidden`) so this band's own dark background meets the
 * card's rounded top corners and the light body content below it shares the
 * same sheet — see `app/(app)/work-orders/components/work-order-hero.tsx`
 * for the reference usage.
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
  className,
}: RecordHeroBandProps) {
  return (
    <div className={cx("ui-record-hero-band", className)}>
      <div className="ui-record-hero-band-top">
        <div className="ui-record-hero-band-breadcrumb">
          {recordHref ? <Link href={recordHref}>{recordLabel}</Link> : <span>{recordLabel}</span>}
          {recordCode && (
            <>
              <span className="ui-record-hero-band-breadcrumb-sep">/</span>
              <span className="ui-record-hero-band-code">{recordCode}</span>
            </>
          )}
        </div>
        {topRight && <span>{topRight}</span>}
      </div>

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
