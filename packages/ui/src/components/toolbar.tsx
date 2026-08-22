import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export interface ToolbarProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
}

export interface ToolbarSectionProps extends HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end";
  children?: ReactNode;
}

function ToolbarSection({ align, className, children, ...rest }: ToolbarSectionProps) {
  return (
    <div className={cx("ui-toolbar-section", align === "end" && "ui-toolbar-section-end", className)} {...rest}>
      {children}
    </div>
  );
}

export function Toolbar({ className, children, ...rest }: ToolbarProps) {
  return (
    <header className={cx("ui-toolbar", className)} {...rest}>
      {children}
    </header>
  );
}
Toolbar.Section = ToolbarSection;
