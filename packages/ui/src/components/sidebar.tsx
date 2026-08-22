import type { ReactNode } from "react";
import { cx } from "../cx";

export interface SidebarProps {
  collapsed?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

export function Sidebar({ collapsed, header, footer, children }: SidebarProps) {
  return (
    <aside className={cx("ui-sidebar", collapsed && "ui-sidebar-collapsed")}>
      {header && <div className="ui-sidebar-header">{header}</div>}
      <div className="ui-sidebar-body">{children}</div>
      {footer && <div className="ui-sidebar-footer">{footer}</div>}
    </aside>
  );
}
