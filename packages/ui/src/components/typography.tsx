import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface HeadingProps extends Omit<HTMLAttributes<HTMLHeadingElement>, "children"> {
  level?: HeadingLevel;
  children?: ReactNode;
}

export function Heading({ level, className, children, ...rest }: HeadingProps) {
  const lvl = level ?? 2;
  const Tag = `h${lvl}` as `h${HeadingLevel}`;
  return (
    <Tag className={cx("ui-heading", `ui-heading-${lvl}`, className)} {...rest}>
      {children}
    </Tag>
  );
}

export type TextTone = "muted" | "danger" | "success";

export interface TextProps extends Omit<HTMLAttributes<HTMLParagraphElement>, "children"> {
  tone?: TextTone;
  children?: ReactNode;
}

export function Text({ tone, className, children, ...rest }: TextProps) {
  return (
    <p className={cx("ui-text", tone && `ui-text-${tone}`, className)} {...rest}>
      {children}
    </p>
  );
}
