import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type StackGap = "xs" | "sm" | "md" | "lg";

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: StackGap;
  children?: ReactNode;
}

export function Stack({ gap, className, children, ...rest }: StackProps) {
  return (
    <div className={cx("ui-stack", gap && `ui-stack-${gap}`, className)} {...rest}>
      {children}
    </div>
  );
}

export type InlineAlign = "start" | "center" | "end" | "baseline";

export interface InlineProps extends HTMLAttributes<HTMLDivElement> {
  gap?: StackGap;
  align?: InlineAlign;
  wrap?: boolean;
  children?: ReactNode;
}

/**
 * Row-direction sibling of `Stack` — same gap scale (the `.ui-stack-*`
 * classes only set the `gap` property, so they're direction-agnostic and
 * safe to reuse here), `align-items: center` by default. For any
 * icon+label / avatar+name grouping that needs a horizontal flex row
 * instead of `Stack`'s column — e.g. a compound table cell — so call sites
 * never reach for a raw `<div style={{ display: "flex" }}>` (CLAUDE.md rule
 * 4: no ad-hoc styling in the app repo).
 */
export function Inline({ gap, align, wrap, className, children, ...rest }: InlineProps) {
  return (
    <div
      className={cx(
        "ui-inline",
        gap && `ui-stack-${gap}`,
        align && `ui-inline-${align}`,
        wrap && "ui-inline-wrap",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
