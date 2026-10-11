import type { ReactNode } from "react";
import Link from "next/link";
import { cx } from "../cx";
import { Card } from "./card";

export interface ChartPanelLink {
  label: string;
  href: string;
}

export interface ChartPanelProps {
  title: string;
  /** Muted one-liner under the title (a total, a delta, a definition). */
  subtitle?: ReactNode;
  /** Right-aligned header slot: legend, switcher, small actions. */
  actions?: ReactNode;
  /** Header link shown at the far right ("All clients"). */
  link?: ChartPanelLink;
  /** Link rendered at the bottom of the panel ("All overdue work orders"). */
  footerLink?: ChartPanelLink;
  children: ReactNode;
  className?: string;
}

/** Compact dashboard panel: ~15px semibold title, optional muted 12px
 * subtitle, legend/actions on the header's right, optional footer link. */
export function ChartPanel({ title, subtitle, actions, link, footerLink, children, className }: ChartPanelProps) {
  return (
    <Card className={cx("ui-chart-panel", className)}>
      <div className="ui-chart-panel-header">
        <div className="ui-chart-panel-heading">
          <h3 className="ui-chart-panel-title">{title}</h3>
          {subtitle ? <div className="ui-chart-panel-subtitle">{subtitle}</div> : null}
        </div>
        {actions || link ? (
          <div className="ui-chart-panel-actions">
            {actions}
            {link ? (
              <Link className="ui-chart-panel-link" href={link.href}>
                {link.label}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="ui-chart-panel-body">{children}</div>
      {footerLink ? (
        <Link className="ui-chart-panel-link ui-chart-panel-footer-link" href={footerLink.href}>
          {footerLink.label} &rarr;
        </Link>
      ) : null}
    </Card>
  );
}
