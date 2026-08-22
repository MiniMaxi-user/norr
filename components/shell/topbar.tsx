import type { ReactNode } from "react";
import { Toolbar, Button } from "@yourorg/ui";
import { CommandPalette } from "./command-palette";
import { ThemeToggle } from "./theme-toggle";
import type { ResolvedNavItem } from "./nav-items";
import { logOutAction } from "@/lib/auth/actions";

/**
 * Server Component. `title` is a plain server-rendered slot (each route's
 * layout/page decides what to put here — e.g. a breadcrumb once modules
 * exist); only the two interactive controls are client leaves.
 *
 * The logout control is a plain `<form action={logOutAction}>` rather than
 * a client component — Server Actions can be invoked directly from a form
 * rendered by a Server Component, no client-side state needed for
 * something this simple (issue #3). This is also the natural spot for a
 * future account/org switcher menu once a multi-org UI exists.
 */
export function Topbar({
  title,
  navItems,
}: {
  title?: ReactNode;
  navItems: ResolvedNavItem[];
}) {
  return (
    <Toolbar>
      <Toolbar.Section>{title}</Toolbar.Section>
      <Toolbar.Section align="end">
        <CommandPalette navItems={navItems} />
        <ThemeToggle />
        <form action={logOutAction}>
          <Button type="submit" variant="outline" size="sm">
            Log out
          </Button>
        </form>
      </Toolbar.Section>
    </Toolbar>
  );
}
