"use client";

import { IconButton, Tooltip, useTheme } from "@yourorg/ui";
import { Sun, Moon } from "@yourorg/ui/icons";

/**
 * Smallest possible interactive leaf: flips light/dark via `@yourorg/ui`'s
 * theming provider (mounted once in `app/layout.tsx`). The provider owns
 * persistence (assumed localStorage + `prefers-color-scheme`, same
 * contract as next-themes) — no app-level cookie/localStorage handling
 * needed here.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Tooltip content={isDark ? "Switch to light theme" : "Switch to dark theme"}>
      <IconButton
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        variant="ghost"
        onClick={() => setTheme(isDark ? "light" : "dark")}
      >
        {isDark ? <Sun /> : <Moon />}
      </IconButton>
    </Tooltip>
  );
}
