import type { AnchorHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

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
  trailing?: ReactNode;
  children?: ReactNode;
}

export function NavItem({ href, icon, disabled, trailing, children, ...rest }: NavItemProps) {
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
        <Link href={href} className="ui-nav-item" {...rest}>
          {content}
        </Link>
      )}
    </li>
  );
}
