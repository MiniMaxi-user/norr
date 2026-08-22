"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Sidebar, IconButton, Tooltip } from "@yourorg/ui";
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
    <Sidebar collapsed={collapsed} header={header} footer={footer}>
      {children}
      <Tooltip content={collapsed ? "Expand navigation" : "Collapse navigation"}>
        <IconButton
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-pressed={collapsed}
          variant="ghost"
          onClick={toggle}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </IconButton>
      </Tooltip>
    </Sidebar>
  );
}
