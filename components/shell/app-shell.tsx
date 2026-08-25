import type { ReactNode } from "react";
import { AppLayout } from "@yourorg/ui";
import { AppSidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { resolveNavItems } from "./nav-items";
import type { FeatureOrganization } from "@/lib/rbac/features";
import type { CurrentSession } from "@/lib/auth/session";

interface AppShellProps {
  defaultSidebarCollapsed: boolean;
  /** Current user's organization (see `lib/auth/session.ts`), or `null` for
   * a signed-in user with no tenant membership yet. Threaded through to
   * `resolveNavItems` for real `hasFeature()` gating (issue #4). */
  organization: FeatureOrganization | null;
  /** Real signed-in user, for the topbar avatar/dropdown (issue #3's
   * `requireSession()` guarantees one exists by the time this renders). */
  user: Pick<CurrentSession, "email" | "fullName" | "role">;
  /** `session.isPlatformAdmin` (issue #45) — threaded to `resolveNavItems`
   * so the "Platform settings" nav item can resolve `enabled` outside the
   * normal `hasFeature(organization, ...)` path (see that function's own
   * comment for why), and to `Topbar`/`UserMenu` for the "Platform Admin"
   * badge. */
  isPlatformAdmin: boolean;
  title?: ReactNode;
  children: ReactNode;
}

/**
 * Composition root for the authenticated app chrome. Stays a Server
 * Component — every interactive piece (sidebar collapse, theme toggle,
 * command palette) is already isolated to its own client leaf, so this
 * component just arranges server-rendered structure around them.
 *
 * Nav entitlement (`hasFeature()` per item) is resolved once here and
 * threaded down to both `AppSidebar` and `Topbar` (which passes it on to
 * `CommandPalette`) so the sidebar and command palette never disagree about
 * which modules are enabled.
 *
 * Session resolution/redirect happens one level up, in
 * `app/(app)/layout.tsx` (via `requireSession()`) — by the time this
 * renders, a signed-in user is guaranteed to exist.
 */
export async function AppShell({
  defaultSidebarCollapsed,
  organization,
  user,
  isPlatformAdmin,
  title,
  children,
}: AppShellProps) {
  const navItems = await resolveNavItems(organization, isPlatformAdmin);

  return (
    <AppLayout
      sidebar={<AppSidebar defaultCollapsed={defaultSidebarCollapsed} items={navItems} />}
      topbar={<Topbar title={title} navItems={navItems} user={user} isPlatformAdmin={isPlatformAdmin} />}
    >
      {children}
    </AppLayout>
  );
}
