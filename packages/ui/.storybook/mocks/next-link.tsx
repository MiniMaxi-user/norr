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
