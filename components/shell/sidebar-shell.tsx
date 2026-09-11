"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, Button, IconButton, Tooltip } from "@yourorg/ui";
import { PanelLeftClose, PanelLeftOpen } from "@yourorg/ui/icons";
import { setSidebarCollapsed } from "@/lib/preferences/actions";

/** Routes that auto-collapse the sidebar locally (issue #164, Planning
 * module) — the scheduler board needs the extra horizontal room, but this
 * is NOT the user's real persisted preference, just a per-route default.
 * `startsWith` so any future `/planning/...` sub-route collapses too. */
function shouldAutoCollapse(pathname: string | null): boolean {
  return pathname?.startsWith("/planning") ?? false;
}

interface SidebarShellProps {
  defaultCollapsed: boolean;
  header: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * The only interactive leaf in the nav: owns collapsed/expanded state.
 * `header`/`children`/`footer` are rendered by Server Components (see
 * `sidebar.tsx`) and passed straight through, so collapsing the nav never
 * forces the nav *contents* to become a client component.
 *
 * State is optimistic — the cookie write happens in the background via a
 * Server Action (`setSidebarCollapsed`) so toggling never waits on a round
 * trip, but the visible width flip is instant and matches what the next
 * server render will produce (via `defaultCollapsed`, read from the cookie
 * in `app/(app)/layout.tsx`), so there's no flash on navigation/reload.
 *
 * The toggle itself renders in the sidebar's own footer slot (bottom,
 * border-top) rather than tacked onto the end of the nav list — a full-width
 * labeled ghost button when expanded, an icon-only button (with a tooltip,
 * since there's no room for a label) when collapsed.
 */
export function SidebarShell({ defaultCollapsed, header, children, footer }: SidebarShellProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [, startTransition] = useTransition();
  const pathname = usePathname();

  // Local-only auto-collapse on `/planning` (issue #164) — deliberately
  // plain `setCollapsed`, NEVER `setSidebarCollapsed` (the persisting Server
  // Action): this is a per-route default, not the user's real preference.
  // Keyed on `pathname` (not `collapsed`) so it fires exactly once per route
  // change, not on every toggle while already on `/planning` — the manual
  // footer toggle below still works normally on this route (a user can
  // expand it back, and that flip persists via `toggle()` exactly like on
  // any other route). Leaving `/planning` restores the real
  // `defaultCollapsed` preference.
  useEffect(() => {
    setCollapsed(shouldAutoCollapse(pathname) ? true : defaultCollapsed);
  }, [pathname, defaultCollapsed]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    startTransition(() => {
      void setSidebarCollapsed(next);
    });
  }

  return (
    <Sidebar
      collapsed={collapsed}
      header={header}
      footer={
        <>
          {footer}
          {collapsed ? (
            <Tooltip content="Navigatie uitklappen">
              <IconButton
                aria-label="Navigatie uitklappen"
                aria-pressed={collapsed}
                variant="ghost"
                onClick={toggle}
                className="ui-sidebar-collapse-toggle"
              >
                <PanelLeftOpen aria-hidden />
              </IconButton>
            </Tooltip>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={collapsed}
              onClick={toggle}
              className="ui-sidebar-collapse-toggle"
            >
              <PanelLeftClose aria-hidden /> Inklappen
            </Button>
          )}
        </>
      }
    >
      {children}
    </Sidebar>
  );
}
