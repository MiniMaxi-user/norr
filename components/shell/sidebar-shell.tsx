"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Sidebar, Button, IconButton, Tooltip } from "@yourorg/ui";
import { PanelLeftClose, PanelLeftOpen } from "@yourorg/ui/icons";
import { setSidebarCollapsed } from "@/lib/preferences/actions";

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
