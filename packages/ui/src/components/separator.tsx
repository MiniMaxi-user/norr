import type { HTMLAttributes } from "react";
import { cx } from "../cx";

export interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

/**
 * Thin dividing line — a horizontal rule between grouped content (e.g. the
 * "or" divider between the login form and an SSO button) or a vertical rule
 * between topbar controls. Purely decorative (`aria-hidden`, `role="none"`);
 * doesn't affect assistive-tech reading order.
 */
export function Separator({ orientation = "horizontal", className, ...rest }: SeparatorProps) {
  return (
    <div
      aria-hidden
      className={cx("ui-separator", orientation === "vertical" && "ui-separator-vertical", className)}
      {...rest}
    />
  );
}
