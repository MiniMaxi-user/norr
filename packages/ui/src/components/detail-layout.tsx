import { Fragment, type ReactNode } from "react";
import { cx } from "../cx";

export interface DetailLayoutProps {
  /** Main page content — typically a `<Tabs>` block. */
  children: ReactNode;
  /** Fixed-width (340px) column rendered alongside `children`, OUTSIDE
   * whatever `children` is (e.g. outside `Tabs`) so it stays visible across
   * every tab and stays sticky on scroll. Usually a handful of `Card`s. */
  rail: ReactNode;
  className?: string;
}

/**
 * Two-column detail-page layout: flexible-width main content (left) plus a
 * fixed 340px sticky rail (right) — see the "Detail layout" block in
 * styles.css (`.ui-detail-layout`/`.ui-detail-rail`) for the grid/sticky
 * mechanics. Collapses to a single column under ~1100px, with the rail
 * moving below the main content.
 *
 * Reference usage: `app/(app)/clients/[id]/client-detail.tsx` wraps its
 * `<Tabs>` in this, with the rail built from Company/Relationship/Platform/
 * Locations/Notes `Card`s — see `stories/ClientDetailPage.stories.tsx` for a
 * visual reference.
 */
export function DetailLayout({ rail, className, children }: DetailLayoutProps) {
  return (
    <div className={cx("ui-detail-layout", className)}>
      <div className="ui-detail-layout-main">{children}</div>
      <div className="ui-detail-rail">{rail}</div>
    </div>
  );
}

export interface DefinitionListItem {
  label: ReactNode;
  value: ReactNode;
}

export interface DefinitionListProps {
  items: DefinitionListItem[];
  className?: string;
}

/**
 * Label/value rows in a two-column grid (`.ui-def-list`) — e.g. a rail
 * card's KvK/VAT/IBAN/phone rows, or a "Client since" row. Renders as a
 * real `<dl>`/`<dt>`/`<dd>` list for semantics; `dt`/`dd` pairs are placed
 * directly as `dl` children (no wrapper element) so the CSS grid on `.ui-def-list`
 * can auto-place them into its two columns.
 */
export function DefinitionList({ items, className }: DefinitionListProps) {
  return (
    <dl className={cx("ui-def-list", className)}>
      {items.map((item, index) => (
        <Fragment key={index}>
          <dt className="ui-def-list-label">{item.label}</dt>
          <dd className="ui-def-list-value ui-text">{item.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
