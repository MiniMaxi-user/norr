import type { ReactNode } from "react";
import { cx } from "../cx";
import type { Icon } from "../icons";
import { Text } from "./typography";

export interface CalloutProps {
  icon: Icon;
  children: ReactNode;
  className?: string;
}

/**
 * A highlighted icon + copy row — warning-tinted per product direction.
 * Generalized from the work order detail page's Notes callout (issue #102,
 * promoted issue #107) so any future record detail page can reuse the same
 * shape. Single-tone for now (matches `.ui-callout`'s current CSS) — no
 * `tone` prop until a second tone is actually needed.
 */
export function Callout({ icon: IconComp, children, className }: CalloutProps) {
  return (
    <div className={cx("ui-callout", className)}>
      <IconComp />
      <Text>{children}</Text>
    </div>
  );
}
