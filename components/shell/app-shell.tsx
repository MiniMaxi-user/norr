import type { ReactNode } from "react";
import { AppLayout } from "@yourorg/ui";
import { AppSidebar } from "./sidebar";
import { Topbar } from "./topbar";

interface AppShellProps {
  defaultSidebarCollapsed: boolean;
  title?: ReactNode;
  children: ReactNode;
}

/**
 * Composition root for the authenticated app chrome. Stays a Server
 * Component — every interactive piece (sidebar collapse, theme toggle,
 * command palette) is already isolated to its own client leaf, so this
 * component just arranges server-rendered structure around them.
 *
 * TODO(auth-rbac-engineer): once session resolution exists, this is where
 * a signed-out request gets redirected before rendering the shell, and
 * where the current user/organization gets threaded down to `Topbar` for
 * an account switcher. Nothing here should assume a user exists yet.
 */
export function AppShell({ defaultSidebarCollapsed, title, children }: AppShellProps) {
  return (
    <AppLayout
      sidebar={<AppSidebar defaultCollapsed={defaultSidebarCollapsed} />}
      topbar={<Topbar title={title} />}
    >
      {children}
    </AppLayout>
  );
}
