import type { AnchorHTMLAttributes, ReactNode } from "react";

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  children?: ReactNode;
}

/** Storybook stand-in for `next/link`'s default export — real navigation
 * needs a Next.js router context Storybook doesn't provide, so this renders
 * a plain anchor with the same `href`/`children` contract. */
export default function Link({ href, children, ...rest }: LinkProps) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/** Storybook stand-in for `next/link`'s `useLinkStatus` (issue #140,
 * `nav-item-icon.tsx`) — the plain anchor above never has a real pending
 * navigation to report, so this always resolves "not pending", same as every
 * other Storybook nav-hook mock in this file. */
export function useLinkStatus(): { pending: boolean } {
  return { pending: false };
}
