import type { ReactNode } from "react";
import { Toolbar } from "@yourorg/ui";
import { CommandPalette } from "./command-palette";
import { ThemeToggle } from "./theme-toggle";

/**
 * Server Component. `title` is a plain server-rendered slot (each route's
 * layout/page decides what to put here — e.g. a breadcrumb once modules
 * exist); only the two interactive controls are client leaves.
 *
 * TODO(auth-rbac-engineer): this is the natural spot for an account/org
 * switcher menu once session + membership resolution exists.
 */
export function Topbar({ title }: { title?: ReactNode }) {
  return (
    <Toolbar>
      <Toolbar.Section>{title}</Toolbar.Section>
      <Toolbar.Section align="end">
        <CommandPalette />
        <ThemeToggle />
      </Toolbar.Section>
    </Toolbar>
  );
}
