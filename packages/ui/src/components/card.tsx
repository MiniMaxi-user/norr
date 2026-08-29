import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type CardTone = "default" | "accent";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  /** Adds hover/focus-visible lift + accent border for a Card that's the
   * sole visual surface of a clickable container (e.g. wrapped in a
   * `<Link>`) — a pure visual affordance, the actual interactive element
   * stays whatever wraps the Card. */
  interactive?: boolean;
  /** `"accent"` tints the Card with the brand accent (Mässing) instead of the
   * neutral surface — for a single, deliberately prominent call-to-action
   * inline in a page/panel (e.g. "Create work order" on an Activity's detail
   * panel) that needs to visually outrank a plain `Button` sitting among
   * other equal-weight actions. Use sparingly — same "the accent, not a broad
   * wash" rule as everywhere else in the design system. Defaults to
   * `"default"` (the existing neutral card). */
  tone?: CardTone;
}

export function Card({ className, interactive, tone = "default", children, ...rest }: CardProps) {
  return (
    <div
      className={cx("ui-card", interactive && "ui-card-interactive", tone === "accent" && "ui-card-accent", className)}
      {...rest}
    >
      {children}
    </div>
  );
}
