import { Fragment } from "react";
import { NavList, NavGroupLabel, Badge, Logo } from "@yourorg/ui";
import { SidebarShell } from "./sidebar-shell";
import { ActiveNavItem } from "./active-nav-item";
import type { ResolvedNavItem } from "./nav-items";

/**
 * Server Component: renders the nav from already-resolved items (see
 * `resolveNavItems` in `nav-items.ts`, called once by `AppShell` and
 * threaded down here) — `enabled` reflects a real `hasFeature()` check
 * (issue #4), not a hardcoded flag. All *interactivity* (collapse/expand,
 * active-route highlighting via `ActiveNavItem`) lives in small client
 * leaves; this component itself renders plain server data.
 * `defaultCollapsed` comes from the persisted preference read server-side in
 * `app/(app)/layout.tsx`, so there's no client-only flash of the wrong width
 * on first paint.
 *
 * Consecutive items sharing `group` (see `NavItem` in `nav-items.ts`) render
 * under one `NavGroupLabel` heading — matching every reference screenshot's
 * grouped sidebar instead of one flat list.
 */
export function AppSidebar({
  defaultCollapsed,
  items,
}: {
  defaultCollapsed: boolean;
  items: ResolvedNavItem[];
}) {
  let lastGroup: string | undefined;

  return (
    <SidebarShell defaultCollapsed={defaultCollapsed} header={<Logo />}>
      <NavList aria-label="Primary">
        {items.map((item) => {
          const Icon = item.icon;
          const showGroupLabel = item.group !== lastGroup;
          lastGroup = item.group;
          return (
            <Fragment key={item.moduleKey}>
              {showGroupLabel && <NavGroupLabel>{item.group}</NavGroupLabel>}
              <ActiveNavItem
                href={item.href}
                icon={<Icon />}
                disabled={!item.enabled}
                trailing={!item.enabled ? <Badge variant="muted">Soon</Badge> : undefined}
              >
                {item.label}
              </ActiveNavItem>
            </Fragment>
          );
        })}
      </NavList>
    </SidebarShell>
  );
}
