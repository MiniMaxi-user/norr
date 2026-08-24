import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import Link from "next/link";
import { cx } from "../cx";

export interface NavListProps {
  children?: ReactNode;
  "aria-label"?: string;
}

export function NavList({ children, ...rest }: NavListProps) {
  return (
    <nav {...rest}>
      <ul className="ui-nav-list">{children}</ul>
    </nav>
  );
}

export interface NavItemProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Marks this as the current route's nav entry — renders as a solid
   * filled pill (the Mässing/brass accent) instead of the default muted
   * label, the one deliberate, contained dose of accent color the sidebar
   * gets (see styles.css's brand comment: never a broad wash). Computing
   * *which* item is active needs `usePathname()`, so callers resolve this
   * from a small client wrapper (see components/shell/active-nav-item.tsx)
   * — this component itself stays hook-free/server-safe. */
  active?: boolean;
  trailing?: ReactNode;
  children?: ReactNode;
}

export function NavItem({ href, icon, disabled, active, trailing, className, children, ...rest }: NavItemProps) {
  const content = (
    <>
      {icon && <span className="ui-nav-item-icon">{icon}</span>}
      <span className="ui-nav-item-label">{children}</span>
      {trailing && <span className="ui-nav-item-trailing">{trailing}</span>}
    </>
  );

  return (
    <li>
      {disabled ? (
        <span className="ui-nav-item ui-nav-item-disabled" aria-disabled>
          {content}
        </span>
      ) : (
        <Link
          href={href}
          className={cx("ui-nav-item", active && "ui-nav-item-active", className)}
          aria-current={active ? "page" : undefined}
          {...rest}
        >
          {content}
        </Link>
      )}
    </li>
  );
}

export interface NavGroupLabelProps extends HTMLAttributes<HTMLLIElement> {
  children?: ReactNode;
}

/**
 * Small uppercase section heading between groups of `NavItem`s (e.g. "CRM" /
 * "CLIENTS" in the Altezza reference, "MAIN MENU" in the construction-service
 * one) — rendered as its own `<li>` inside the same `<ul>` `NavList` already
 * owns, so no change to `NavList`'s markup is needed. Hidden automatically
 * when the sidebar is collapsed (see `.ui-sidebar-collapsed .ui-nav-group-label`
 * in styles.css), same pattern as `.ui-nav-item-label`.
 */
export function NavGroupLabel({ className, children, ...rest }: NavGroupLabelProps) {
  return (
    <li className={cx("ui-nav-group-label", className)} role="presentation" {...rest}>
      {children}
    </li>
  );
}
