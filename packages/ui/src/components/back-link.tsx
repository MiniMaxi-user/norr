import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "../icons";

export interface BackLinkProps {
  href: string;
  children?: ReactNode;
}

/**
 * The "&larr; Back to X" link repeated at the top of every detail/nested
 * page (Clients detail, Asset detail, Reference lists, ...) — one shared
 * primitive instead of each page hand-rolling its own `Link` + arrow glyph,
 * per the "don't reinvent per module" rule. The chevron nudges left on
 * hover/focus (`--ui-duration-fast`/`--ui-ease`, same tokens as every other
 * hover affordance in this package) instead of sitting static.
 */
export function BackLink({ href, children }: BackLinkProps) {
  return (
    <Link href={href} className="ui-back-link">
      <ChevronLeft className="ui-back-link-icon" aria-hidden />
      {children}
    </Link>
  );
}
