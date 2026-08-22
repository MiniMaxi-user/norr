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
import { NAV_ITEMS } from "./nav-items";

/**
 * Global cmd/ctrl-K command palette. Owns its own open state and the
 * keyboard listener, and renders both the trigger button (shown in the
 * topbar) and the dialog — kept as one client leaf since both pieces share
 * the same state and there's no server-renderable part of a command
 * palette.
 *
 * Commands today are shell-level only (navigate to the one enabled module,
 * toggle theme). TODO(frontend-ui-engineer): once modules ship, register
 * their commands here dynamically (respecting `hasFeature()`) instead of
 * hardcoding a growing list.
 */
export function CommandPalette() {
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

  const enabledNavItems = NAV_ITEMS.filter((item) => item.enabled);

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
              <item.icon />
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
