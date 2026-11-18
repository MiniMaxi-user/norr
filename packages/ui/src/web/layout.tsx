import type { HTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cx } from "../cx";

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
