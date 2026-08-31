"use client";

import { Fragment, useMemo } from "react";
import { usePathname } from "next/navigation";
import { Breadcrumbs, NavGroupLabel, NavItem, NavList } from "@yourorg/ui";
import { usePageHeader } from "@/components/shell/page-header-context";
import { findSettingsNavItem, SETTINGS_NAV_GROUPS } from "./settings-nav-items";

/**
 * The Settings admin shell (issue #110): a persistent grouped left rail +
 * content pane, replacing the old flat drill-down (`/settings` ->
 * `/settings/reference-lists` with an in-page `Tabs` board). Mounted once by
 * `app/(app)/settings/layout.tsx` around every settings route, so navigating
 * between leaf routes only swaps `children` — the rail itself never
 * unmounts.
 *
 * Composition mirrors `components/shell/sidebar.tsx`'s `AppSidebar` exactly:
 * ONE `NavList` (one `<nav><ul>`) wrapping every group, with `NavGroupLabel`
 * and `NavItem` as flat `<li>` siblings inside it — NOT one `NavList` per
 * group. `NavGroupLabel`'s own doc comment (packages/ui/src/components/
 * nav.tsx) assumes it's a sibling `<li>` inside the SAME `<ul>` as the items
 * it labels; nesting a separate `NavList` per group would instead produce
 * one `<nav><ul>` per group, breaking that assumption and the shared
 * `.ui-nav-list`/`.ui-nav-group-label` spacing rules in styles.css, which
 * are written for one continuous list. Unlike `AppSidebar` (whose groups are
 * derived from a flat array via "consecutive items sharing `group` render
 * under one heading"), `SETTINGS_NAV_GROUPS` is already pre-grouped, so this
 * just maps groups then items — no `lastGroup` tracking needed.
 *
 * Active-state + breadcrumb label both resolve from `usePathname()`
 * client-side, same reasoning `components/shell/active-nav-item.tsx` gives
 * for why that check can't live in a Server Component.
 */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const current = findSettingsNavItem(pathname);
  const currentLabel = current?.item.label;

  const breadcrumbItems = useMemo(
    () => [{ label: "Settings", href: "/settings" }, ...(currentLabel ? [{ label: currentLabel }] : [])],
    [currentLabel],
  );
  // The element itself (not just `breadcrumbItems`) must be memoized — see
  // the "MUST be referentially stable" warning on `usePageHeader`'s doc
  // comment; an inline `<Breadcrumbs items={breadcrumbItems} />` here would
  // be a fresh element every render and infinite-loop. Same pattern as
  // `app/(app)/clients/[id]/client-detail.tsx`.
  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  return (
    <div className="ui-settings-shell">
      <div className="ui-settings-rail">
        <NavList aria-label="Settings">
          {SETTINGS_NAV_GROUPS.map((group) => (
            <Fragment key={group.label}>
              <NavGroupLabel>{group.label}</NavGroupLabel>
              {group.items.map((item) => (
                <NavItem key={item.key} href={item.href} icon={<group.icon />} active={pathname === item.href}>
                  {item.label}
                </NavItem>
              ))}
            </Fragment>
          ))}
        </NavList>
      </div>
      <div className="ui-settings-content">{children}</div>
    </div>
  );
}
