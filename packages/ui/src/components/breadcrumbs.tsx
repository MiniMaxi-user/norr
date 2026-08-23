import type { ReactNode } from "react";
import Link from "next/link";
import { cx } from "../cx";
import { ChevronRight } from "../icons";

export interface BreadcrumbItem {
  label: ReactNode;
  /** Omit on the current (last) item, or on an intermediate step that has
   * no page of its own — either way it renders as plain text instead of a
   * link. */
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

/**
 * Full-path breadcrumb trail — see docs/ARCHITECTURE.md's "Relational
 * detail pages" section. `BackLink` (single "&larr; Back to X" hop) stays
 * right for a page with exactly one obvious parent list; once a page sits
 * two or more levels deep in a real hierarchy (or the product simply wants
 * the fuller "Clients / Acme Corp" trail a detail page's title deserves —
 * see the reference dispatch/admin screens this was modeled on), use this
 * instead. The last item is always rendered as the current-page label
 * (never a link), regardless of whether it was given an `href`.
 */
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cx("ui-breadcrumbs", className)}>
      <ol className="ui-breadcrumbs-list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} className="ui-breadcrumbs-item">
              {item.href && !isLast ? (
                <Link href={item.href} className="ui-breadcrumbs-link">
                  {item.label}
                </Link>
              ) : (
                <span className={isLast ? "ui-breadcrumbs-current" : "ui-breadcrumbs-text"}>{item.label}</span>
              )}
              {!isLast && <ChevronRight className="ui-breadcrumbs-separator" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
