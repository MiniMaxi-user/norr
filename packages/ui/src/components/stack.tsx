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
