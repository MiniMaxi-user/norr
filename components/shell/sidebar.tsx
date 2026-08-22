import { NavList, NavItem as UiNavItem, Badge, Logo } from "@yourorg/ui";
import { SidebarShell } from "./sidebar-shell";
import type { ResolvedNavItem } from "./nav-items";

/**
 * Server Component: renders the nav from already-resolved items (see
 * `resolveNavItems` in `nav-items.ts`, called once by `AppShell` and
 * threaded down here) — `enabled` reflects a real `hasFeature()` check
 * (issue #4), not a hardcoded flag. All *interactivity* (collapse/expand)
 * lives in `SidebarShell`. `defaultCollapsed` comes from the persisted
 * preference read server-side in `app/(app)/layout.tsx`, so there's no
 * client-only flash of the wrong width on first paint.
 */
export function AppSidebar({
  defaultCollapsed,
  items,
}: {
  defaultCollapsed: boolean;
  items: ResolvedNavItem[];
}) {
  return (
    <SidebarShell defaultCollapsed={defaultCollapsed} header={<Logo />}>
      <NavList aria-label="Primary">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <UiNavItem
              key={item.moduleKey}
              href={item.href}
              icon={<Icon />}
              disabled={!item.enabled}
              trailing={!item.enabled ? <Badge variant="muted">Soon</Badge> : undefined}
            >
              {item.label}
            </UiNavItem>
          );
        })}
      </NavList>
    </SidebarShell>
  );
}
