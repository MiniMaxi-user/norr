import type { ReactNode } from "react";
import Link from "next/link";
import { cx } from "../cx";

export interface RecordListItem {
  key: string;
  title: string;
  subtitle?: string;
  /** Right-aligned short text (a date, an age). */
  meta?: string;
  metaTone?: "default" | "danger" | "warning";
  /** Optional leading badge/chip. */
  badge?: ReactNode;
  /** When set the row links to the record. */
  href?: string;
}

export interface RecordListProps {
  items: RecordListItem[];
  ariaLabel: string;
  /** Shown when `items` is empty. */
  emptyLabel?: string;
  /** Link under the list ("All overdue work orders"). */
  footerLink?: { label: string; href: string };
  className?: string;
}

/** Compact "most important records" list: title + subtitle on the left,
 * a short meta value on the right, each row optionally a link. */
export function RecordList({
  items,
  ariaLabel,
  emptyLabel = "Nothing to show",
  footerLink,
  className,
}: RecordListProps) {
  const footer = footerLink ? (
    <Link className="ui-record-list-footer-link" href={footerLink.href}>
      {footerLink.label} &rarr;
    </Link>
  ) : null;
  if (items.length === 0)
    return (
      <div className="ui-record-list-wrap">
        <p className="ui-record-list-empty">{emptyLabel}</p>
        {footer}
      </div>
    );
  return (
    <div className="ui-record-list-wrap">
      <ul className={cx("ui-record-list", className)} aria-label={ariaLabel}>
        {items.map((item) => {
          const body = (
            <>
              {item.badge ? (
                <span className="ui-record-list-badge">{item.badge}</span>
              ) : null}
              <span className="ui-record-list-text">
                <span className="ui-record-list-title">{item.title}</span>
                {item.subtitle ? (
                  <span className="ui-record-list-subtitle">
                    {item.subtitle}
                  </span>
                ) : null}
              </span>
              {item.meta ? (
                <span
                  className={cx(
                    "ui-record-list-meta",
                    item.metaTone &&
                      item.metaTone !== "default" &&
                      `ui-record-list-meta-${item.metaTone}`,
                  )}
                >
                  {item.meta}
                </span>
              ) : null}
            </>
          );
          return (
            <li key={item.key} className="ui-record-list-item">
              {item.href ? (
                <Link
                  className="ui-record-list-row ui-record-list-row-link"
                  href={item.href}
                >
                  {body}
                </Link>
              ) : (
                <div className="ui-record-list-row">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {footer}
    </div>
  );
}
