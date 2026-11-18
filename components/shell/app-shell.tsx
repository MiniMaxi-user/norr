import type { ReactNode } from "react";
import { Topbar } from "./topbar";
import { ContextStrip } from "./page-header-context";
import { resolveNavItems } from "./nav-items";
import type { FeatureOrganization } from "@/lib/rbac/features";
import type { CurrentSession } from "@/lib/auth/session";
import type { PermissionActor } from "@/lib/rbac/permissions";

interface AppShellProps {
  /** Current user's organization (see `lib/auth/session.ts`), or `null` for
   * a signed-in user with no tenant membership yet. Threaded through to
   * `resolveNavItems` for real `hasFeature()` gating (issue #4). */
  organization: FeatureOrganization | null;
  /** Real signed-in user, for the topbar avatar menu (issue #3's
   * `requireSession()` guarantees one exists by the time this renders). */
  user: Pick<CurrentSession, "email" | "fullName" | "role" | "avatarUrl" | "locale">;
  /** `session.isPlatformAdmin` (issue #45) — resolves the "Platform settings"
   * entry outside the normal `hasFeature()` path and marks the avatar menu
   * with a "Platform Admin" badge. */
  isPlatformAdmin: boolean;
  children: ReactNode;
}

/**
 * Composition root for the authenticated WEB chrome (design system, issue
 * #222): a navy topbar over a single scrolling content area — the old left
 * sidebar is gone. Stays a Server Component; every interactive piece (module
 * menu, command palette, avatar menu) is its own client leaf.
 *
 * Nav entitlement (`hasFeature()` + RBAC per item) is resolved ONCE here via
 * `resolveNavItems` and threaded down to the topbar and the command palette,
 * so the two can never disagree about which modules exist.
 *
 * `ContextStrip` shows the breadcrumb pages not yet migrated to the new
 * `PageHeader` still push through `usePageHeader` (the topbar itself carries
 * no breadcrumb any more); it renders nothing when no page set one.
 *
 * Session resolution/redirect happens one level up, in
 * `app/(app)/layout.tsx` (via `requireSession()`).
 */
export async function AppShell({ organization, user, isPlatformAdmin, children }: AppShellProps) {
  const actor: PermissionActor = { role: user.role, isPlatformAdmin };
  const navItems = await resolveNavItems(organization, isPlatformAdmin, actor);

  return (
    <div className="web-shell">
      <Topbar navItems={navItems} user={user} isPlatformAdmin={isPlatformAdmin} />
      <div className="web-shell-body">
        <ContextStrip />
        <main className="ui-app-layout-content">{children}</main>
      </div>
    </div>
  );
}
