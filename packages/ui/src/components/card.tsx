import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /** Adds hover/focus-visible lift + accent border for a Card that's the
   * sole visual surface of a clickable container (e.g. wrapped in a
   * `<Link>`) — a pure visual affordance, the actual interactive element
   * stays whatever wraps the Card. */
  interactive?: boolean;
}

export function Card({ className, interactive, children, ...rest }: CardProps) {
  return (
    <div className={cx("ui-card", interactive && "ui-card-interactive", className)} {...rest}>
      {children}
    </div>
  );
}
