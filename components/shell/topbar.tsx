import type { ReactNode } from "react";
import { Badge, Toolbar, IconButton, Separator, Tooltip } from "@yourorg/ui";
import { Bell, CircleHelp } from "@yourorg/ui/icons";
import { CommandPalette } from "./command-palette";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import type { ResolvedNavItem } from "./nav-items";
import { memberDisplayName } from "@/lib/members/format";
import type { CurrentSession } from "@/lib/auth/session";

/**
 * `CommandPalette` is a "use client" leaf and cannot receive a raw icon
 * *component* across the server/client boundary (React can only serialize
 * already-rendered elements, not function references — see the comment in
 * `command-palette.tsx` for the crash this caused live). Rendering `<Icon />`
 * here, in this Server Component, is what makes it safe to pass down.
 */
function toCommandPaletteItems(items: ResolvedNavItem[]) {
  return items.map(({ icon: Icon, ...item }) => ({ ...item, icon: <Icon /> }));
}

/**
 * Server Component. `title` is a plain server-rendered slot (each route's
 * layout/page decides what to put here — e.g. a breadcrumb once modules
 * exist); only the interactive controls (command palette, theme toggle, user
 * menu) are client leaves.
 *
 * The help icon and notification bell have no real feature behind them yet
 * (no help center, no notifications backend) — rendered visually per the
 * product owner's note that inert chrome is fine for now; they intentionally
 * have no `onClick`.
 */
export function Topbar({
  title,
  navItems,
  user,
  isPlatformAdmin,
}: {
  title?: ReactNode;
  navItems: ResolvedNavItem[];
  user: Pick<CurrentSession, "email" | "fullName" | "role" | "avatarUrl" | "locale">;
  /** `session.isPlatformAdmin` (issue #45) — renders a "Platform Admin"
   * badge to the left of the search bar (product feedback: not in the user
   * menu). */
  isPlatformAdmin: boolean;
}) {
  const displayName = memberDisplayName({ email: user.email, full_name: user.fullName });

  return (
    <Toolbar className="ui-topbar">
      <Toolbar.Section>{title}</Toolbar.Section>
      <Toolbar.Section align="end">
        {isPlatformAdmin && <Badge variant="accent">Platform Admin</Badge>}
        <CommandPalette navItems={toCommandPaletteItems(navItems)} />
        <ThemeToggle />

        <Tooltip content="Help">
          <IconButton aria-label="Help" variant="ghost" disabled>
            <CircleHelp aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip content="Notifications">
          <IconButton aria-label="Notifications" variant="ghost" disabled>
            <Bell aria-hidden />
          </IconButton>
        </Tooltip>

        <Separator orientation="vertical" />

        <UserMenu
          name={displayName}
          role={user.role}
          email={user.email}
          fullName={user.fullName}
          avatarUrl={user.avatarUrl}
          locale={user.locale}
        />
      </Toolbar.Section>
    </Toolbar>
  );
}
