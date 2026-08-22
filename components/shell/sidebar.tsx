import { NavList, NavItem as UiNavItem, Badge, Logo } from "@yourorg/ui";
import { SidebarShell } from "./sidebar-shell";
import { NAV_ITEMS } from "./nav-items";

/**
 * Server Component: decides *what* the nav contains. All *interactivity*
 * (collapse/expand) lives in `SidebarShell`. `defaultCollapsed` comes from
 * the persisted preference read server-side in `app/(app)/layout.tsx`, so
 * there's no client-only flash of the wrong width on first paint.
 */
export function AppSidebar({ defaultCollapsed }: { defaultCollapsed: boolean }) {
  return (
    <SidebarShell defaultCollapsed={defaultCollapsed} header={<Logo />}>
      <NavList aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <UiNavItem
              key={item.moduleKey}
              href={item.href}
              icon={<Icon />}
              disabled={!item.enabled}
              // TODO(frontend-ui-engineer, Phase 1+): once a module ships,
              // flip `enabled: true` in nav-items.ts. Once entitlements
              // exist (CLAUDE.md rule 3), gate visibility with
              // `hasFeature(org, item.moduleKey)` server-side here instead
              // of the static `enabled` flag — an un-entitled module must
              // not render at all, not just render disabled.
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
