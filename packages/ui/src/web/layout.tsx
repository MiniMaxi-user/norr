import type { HTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cx } from "../cx";
import { WebBadge, WebBreadcrumb } from "./primitives";

/**
 * Detail-page skeleton (issue #222): `WebPage` (full-bleed canvas),
 * `WebDetailLayout` (main + 340px rail with a mandatory timeline), rail
 * sections and the timeline. Hook-free / server-safe.
 */

/** Full-bleed page canvas: cancels `.ui-app-layout-content`'s own padding so
 * the white header band and the rail touch the viewport edges. Used as the
 * root of every detail page. */
export function WebPage({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("web-page", className)} {...rest}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * Rail sections
 * ---------------------------------------------------------------------- */

export interface SidebarSectionProps {
  /** Rendered as a mono uppercase overline. */
  title: string;
  /** At most one link on the title line ("All", "Open map", "Manage"). */
  link?: { label: string; href?: string; onClick?: () => void };
  children?: ReactNode;
}

/** One rail section: overline title, optional single link, free content
 * (usually `SidebarRows`). The rail is never editable. */
export function SidebarSection({ title, link, children }: SidebarSectionProps) {
  return (
    <section className="web-rail-section" aria-label={title}>
      <div className="web-rail-section-head">
        <h2 className="web-overline">{title}</h2>
        {link ? (
          link.href ? (
            <Link href={link.href} className="web-rail-link">
              {link.label}
            </Link>
          ) : (
            <button type="button" className="web-rail-link" onClick={link.onClick}>
              {link.label}
            </button>
          )
        ) : null}
      </div>
      {children}
    </section>
  );
}

export interface SidebarRow {
  label: string;
  value: ReactNode;
}

/** `label ......... value` rows (13px). */
export function SidebarRows({ rows }: { rows: SidebarRow[] }) {
  return (
    <dl className="web-rail-rows">
      {rows.map((row) => (
        <div className="web-rail-row" key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Thin progress bar for a rail section (warranty remaining, checklist…). */
export function SidebarProgress({
  value,
  label,
  tone,
}: {
  /** 0–100. */
  value: number;
  label: string;
  tone?: "success" | "warning" | "danger";
}) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      className="web-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      data-tone={tone}
    >
      <span className="web-progress-fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}

/** One gold callout per section for something that needs action. */
export function SidebarNotice({ children }: { children: ReactNode }) {
  return <p className="web-rail-notice">{children}</p>;
}

/* ---------------------------------------------------------------------- *
 * Timeline
 * ---------------------------------------------------------------------- */

export type TimelineStatus = "latest" | "default" | "planned";

export interface TimelineItem {
  id: string;
  /** Title; a record reference should be a link. */
  title: ReactNode;
  /** Already-formatted timestamp (`17 Nov 2026, 23:34`, Europe/Amsterdam)
   * — never an ISO string. */
  at: string | null;
  actor?: string | null;
  /** latest = gold dot (newest / running), default = grey, planned = open
   * gold ring (in the future). */
  status?: TimelineStatus;
}

export interface TimelineProps {
  items: TimelineItem[];
  /** "All" link to the full history, when one exists. */
  allHref?: string;
  /** Empty state (one muted line). */
  emptyText?: string;
}

/** Newest first, 5–8 items. Always the LAST section of a rail. */
export function Timeline({ items, allHref, emptyText = "No activity yet." }: TimelineProps) {
  return (
    <SidebarSection title="Timeline" link={allHref ? { label: "All", href: allHref } : undefined}>
      {items.length === 0 ? (
        <p className="web-rail-empty">{emptyText}</p>
      ) : (
        <ol className="web-timeline">
          {items.map((item) => {
            const meta = [item.at ?? "—", item.actor].filter(Boolean).join(" · ");
            return (
              <li key={item.id} className="web-timeline-item" data-status={item.status ?? "default"}>
                <span className="web-timeline-dot" aria-hidden="true" />
                <div>
                  <div className="web-timeline-title">{item.title}</div>
                  <div className="web-timeline-meta">{meta}</div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </SidebarSection>
  );
}

/* ---------------------------------------------------------------------- *
 * DetailLayout
 * ---------------------------------------------------------------------- */

export interface WebDetailLayoutProps {
  /** The page header (`PageHeader`), rendered above the grid. */
  header: ReactNode;
  /** Centre column: cards, or a tab's panel. The only editable area. */
  children: ReactNode;
  /** 1–3 context sections ABOVE the timeline (`SidebarSection`s). */
  rail?: ReactNode;
  /**
   * REQUIRED — a detail page without a timeline does not type-check. The
   * layout renders it as the rail's last section, whatever `rail` contains.
   */
  timeline: TimelineProps;
  /** Edit/new mode: rail shows "Read-only while editing", content at .5
   * opacity and unclickable (`aria-disabled`). */
  locked?: boolean;
  /** Set `id`/`aria-labelledby`-style hooks for the active tab panel. */
  mainProps?: HTMLAttributes<HTMLDivElement>;
}

export function WebDetailLayout({ header, children, rail, timeline, locked, mainProps }: WebDetailLayoutProps) {
  const { className: mainClassName, ...mainRest } = mainProps ?? {};
  return (
    <>
      {header}
      <div className="web-detail">
        <div className={cx("web-detail-main", mainClassName)} data-web-main="" {...mainRest}>
          {children}
        </div>
        <aside className="web-detail-rail" aria-label="Context">
          {locked ? <div className="web-detail-rail-lock">Read-only while editing</div> : null}
          <div
            className="web-detail-rail-content"
            role={locked ? "group" : undefined}
            aria-label={locked ? "Context, read-only while editing" : undefined}
            aria-disabled={locked ? "true" : undefined}
            inert={locked ? true : undefined}
          >
            {rail}
            <Timeline {...timeline} />
          </div>
        </aside>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------- *
 * List page
 * ---------------------------------------------------------------------- */

export interface WebListPageProps {
  /** Module name: the single breadcrumb level ("Clients"). */
  module: string;
  /** The H1 (usually the same as `module`, or a longer name). */
  title: string;
  /** Total number of records, shown as a mono count badge next to the title.
   * Omit while it is unknown. */
  count?: number | null;
  /** Secondary actions, left of the primary one: `[Export]`, a
   * `WebViewSwitcher`. Only add what really exists. */
  actions?: ReactNode;
  /** The ONE navy primary button: `<WebLinkButton variant="primary"
   * href="/clients/new">New client</WebLinkButton>`. Omit when the user may
   * not create. */
  primary?: ReactNode;
  /** The page body: normally ONE `WebDataTableCard` (FilterBar + table), or
   * a different view of the same data (board, map). No tabs, no rail. */
  children: ReactNode;
}

function ListHeader({
  module,
  title,
  count,
  actions,
  primary,
}: Omit<WebListPageProps, "children">) {
  return (
    <header className="web-page-header" data-mode="read" data-kind="list">
      <WebBreadcrumb items={[{ label: module }]} />
      <div className="web-page-header-row">
        <div className="web-page-header-left">
          <div className="web-page-header-text">
            <h1 className="web-page-title" title={title}>
              {title}
            </h1>
          </div>
          {typeof count === "number" ? (
            <WebBadge variant="mono" aria-label={`${count} records`}>
              {count}
            </WebBadge>
          ) : null}
        </div>
        {actions || primary ? (
          <div className="web-page-header-actions">
            <div className="web-page-header-buttons">
              {actions}
              {primary}
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}

/**
 * Skeleton of the list-page shell of the web design system (issue #222),
 * for lists of every module. Use it as the whole page of a module list:
 *
 * ```tsx
 * // page.tsx (Server Component) — resolve session / hasFeature / RBAC first
 * <Suspense fallback={<WebListSkeleton module="Clients" title="Clients" />}>
 *   <ClientsList searchParams={...} />   // async: fetches, then renders
 * </Suspense>
 *
 * // ClientsList
 * <WebListPage module="Clients" title="Clients" count={total}
 *   primary={canCreate ? <WebLinkButton variant="primary" href="/clients/new">New client</WebLinkButton> : undefined}>
 *   <ClientsTable ... />   // a `WebDataTableCard` in server mode
 * </WebListPage>
 * ```
 *
 * Layout: the topbar, a white page header (breadcrumb with the module name,
 * H1, optional count badge, `[actions] [primary]` on the right), and below
 * it one full-width scroll area holding the card. The browser page never
 * scrolls; the FilterBar and the column headers stay stuck to the top of that
 * area. No tabs, no right rail.
 *
 * Do NOT key the `Suspense` on the filter params: `WebDataTableCard` (server
 * mode) changes the URL inside a transition, so the table stays on screen
 * (dimmed) while the new page streams in, and the search box keeps focus.
 */
export function WebListPage({ children, ...header }: WebListPageProps) {
  return (
    <WebPage>
      <ListHeader {...header} />
      <div className="web-list-main" data-web-main="">
        {children}
      </div>
    </WebPage>
  );
}

export interface WebListSkeletonProps {
  module: string;
  title: string;
  /** Rows of the placeholder table (default 8). */
  rows?: number;
  /** Placeholder columns (default 5). */
  columns?: number;
}

/** Suspense / `loading.tsx` fallback shaped like `WebListPage`: the real
 * header (so the H1 paints at once), a FilterBar and a table of skeleton
 * bars. Never a bare spinner. */
export function WebListSkeleton({ module, title, rows = 8, columns = 5 }: WebListSkeletonProps) {
  return (
    <WebPage aria-busy="true">
      <ListHeader module={module} title={title} />
      <div className="web-list-main" data-web-main="">
        <section className="web-card" aria-hidden="true">
          <div className="web-filterbar">
            <span className="web-skeleton-bar" style={{ width: 260, height: 30 }} />
            <span className="web-skeleton-bar" style={{ width: 120, height: 30 }} />
            <span className="web-skeleton-bar" style={{ width: 120, height: 30 }} />
          </div>
          <div className="web-table-wrap">
            <table className="web-table">
              <thead>
                <tr>
                  {Array.from({ length: columns }).map((_, index) => (
                    <th key={index} scope="col">
                      <span className="web-skeleton-bar" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }).map((_, row) => (
                  <tr key={row}>
                    {Array.from({ length: columns }).map((__, cell) => (
                      <td key={cell}>
                        <span className="web-skeleton-bar" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </WebPage>
  );
}
