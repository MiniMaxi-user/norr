"use client";
// Genuinely interactive (calls `useLinkStatus`, a real hook) — same as
// client.tsx/tabs.tsx/toast.tsx/combobox.tsx/confirm-delete-dialog.tsx, it
// needs its OWN dedicated "use client" tsup build entry rather than living
// in the hook-free main index.js bundle Server Components import; see
// tsup.config.ts's top-of-file comment for the full "why a sibling file, not
// inlined" story. Unlike those, this one is NOT re-exported from index.ts —
// it's `NavItem`'s own internal icon-slot renderer (see nav.tsx), not public
// API, so it doesn't need the top-level-of-`src/` placement those need for
// index.ts's literal `"./foo.js"` CJS resolution; living beside `nav.tsx`
// here works because `nav.tsx`'s own `"./nav-item-icon.js"` import is (a)
// resolvable on disk relative to this same `components/` directory for the
// CJS build (which doesn't mark it external and needs a real file to
// inline), and (b) a valid literal specifier for the ESM build's `external`
// match, which is text-based, not resolved-path-based — and tsup's named
// entry (`"nav-item-icon": "src/components/nav-item-icon.tsx"`) still
// outputs a flat sibling `dist/nav-item-icon.js` regardless of that nesting,
// exactly what `"./nav-item-icon.js"` needs to resolve to at runtime next to
// `dist/index.js`.

import type { ReactNode } from "react";
import { useLinkStatus } from "next/link";
import { Spinner } from "./spinner";

export interface NavItemIconProps {
  /** The item's normal icon, shown whenever this link's own navigation
   * isn't pending. */
  icon: ReactNode;
}

/**
 * `NavItem`'s icon-slot renderer (issue #140) — swaps the item's own icon
 * for the branded `Spinner` while THIS link's own navigation is pending,
 * using Next.js 15.5's `useLinkStatus()`. That hook only works when called
 * from a component nested INSIDE the `<Link>` whose status it reports, so
 * `NavItem` renders this as a child of the `Link` it already returns (see
 * nav.tsx) rather than calling the hook itself — keeping `NavItem` itself
 * hook-free/server-safe, exactly mirroring how `ActiveNavItem`
 * (components/shell/active-nav-item.tsx) isolates the *other* nav hook
 * (`usePathname`) into its own thin client wrapper instead of putting it on
 * `NavItem` directly.
 *
 * Same fixed `.ui-nav-item-icon` box either way (see styles.css) — no
 * layout shift when the icon swaps to the spinner and back.
 */
export function NavItemIcon({ icon }: NavItemIconProps) {
  const { pending } = useLinkStatus();
  return <span className="ui-nav-item-icon">{pending ? <Spinner size={16} label="Loading" /> : icon}</span>;
}
