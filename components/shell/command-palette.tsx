"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandPalette as UiCommandPalette,
  CommandGroup,
  CommandItem,
  Button,
  Kbd,
  useTheme,
} from "@yourorg/ui";
import { Search } from "@yourorg/ui/icons";
import type { ReactNode } from "react";

/**
 * Client-safe projection of `ResolvedNavItem` (see `./nav-items`): `icon` is
 * an already-rendered element, not the bare component reference. A Server
 * Component (`Topbar`) must render `<Icon />` itself before this ever
 * reaches this "use client" component — passing a component *function*
 * across the server/client boundary as a prop fails at runtime ("Functions
 * cannot be passed directly to Client Components"), even though it type
 * checks fine, since TypeScript has no notion of the RSC serialization
 * boundary. This crashed the live app shell for exactly this reason; fixed
 * by never letting a raw `ComponentType` cross into this file's props.
 */
export interface CommandPaletteNavItem {
  moduleKey: string;
  label: string;
  href: string;
  icon: ReactNode;
  enabled: boolean;
}

/**
 * Global cmd/ctrl-K command palette. Owns its own open state and the
 * keyboard listener, and renders both the trigger button (shown in the
 * topbar) and the dialog — kept as one client leaf since both pieces share
 * the same state and there's no server-renderable part of a command
 * palette.
 *
 * Commands today are shell-level only (navigate to enabled modules, toggle
 * theme). `navItems` is resolved server-side via `resolveNavItems()`
 * (`hasFeature()` per item, issue #4) and passed down from `Topbar` — this
 * component can't call `hasFeature()` itself since it's a server-only
 * DB-backed helper and this is a "use client" leaf. TODO(frontend-ui-engineer):
 * once modules ship, register their commands here dynamically instead of
 * just navigation entries.
 */
export function CommandPalette({ navItems }: { navItems: CommandPaletteNavItem[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isCombo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (isCombo) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function runAndClose(action: () => void) {
    action();
    setOpen(false);
  }

  const enabledNavItems = navItems.filter((item) => item.enabled);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label="Open command palette"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden />
        Search…
        <Kbd>Ctrl K</Kbd>
      </Button>

      <UiCommandPalette open={open} onOpenChange={setOpen} placeholder="Type a command or search…">
        <CommandGroup heading="Navigate">
          {enabledNavItems.map((item) => (
            <CommandItem
              key={item.moduleKey}
              onSelect={() => runAndClose(() => router.push(item.href))}
            >
              {item.icon}
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Preferences">
          <CommandItem onSelect={() => runAndClose(() => setTheme(theme === "dark" ? "light" : "dark"))}>
            Toggle theme
          </CommandItem>
        </CommandGroup>
      </UiCommandPalette>
    </>
  );
}
