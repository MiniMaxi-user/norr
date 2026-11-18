"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CommandPalette as UiCommandPalette, CommandGroup, CommandItem } from "@yourorg/ui";
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
  label: string;
  href: string;
  icon: ReactNode;
}

/**
 * Global cmd/ctrl-K command palette. Owns its own open state and the
 * keyboard listener, and renders both the trigger and the dialog — kept as
 * one client leaf since both pieces share the same state and there's no
 * server-renderable part of a command palette.
 *
 * The trigger is the topbar's search field (design system "Topbar", issue
 * #222); clicking it and pressing Ctrl/Cmd+K open the same palette.
 *
 * Commands today are shell-level only (navigate to enabled modules).
 * `navItems` is resolved server-side via `resolveNavItems()` (`hasFeature()`
 * per item, issue #4), already filtered to the enabled ones by `Topbar` —
 * this component can't call `hasFeature()` itself since it's a server-only
 * DB-backed helper and this is a "use client" leaf. Theme switching is gone:
 * web is light-only. TODO(frontend-ui-engineer): once modules ship, register
 * their commands (and record search) here dynamically.
 */
export function CommandPalette({ navItems }: { navItems: CommandPaletteNavItem[] }) {
  const [open, setOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setIsMac(/mac|iphone|ipad/i.test(navigator.platform));
  }, []);

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

  return (
    <>
      <button
        type="button"
        className="web-topbar-search"
        aria-label="Search modules and commands"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden />
        <span className="web-topbar-search-label">Search modules and commands</span>
        <span className="web-topbar-search-kbd" aria-hidden="true">
          {isMac ? "⌘K" : "Ctrl K"}
        </span>
      </button>

      <UiCommandPalette open={open} onOpenChange={setOpen} placeholder="Type a command or search…">
        <CommandGroup heading="Navigate">
          {navItems.map((item) => (
            // `href`, not `moduleKey` — Planning and Work Orders share
            // `moduleKey: "planning"` (issue #164, see `nav-items.ts`'s
            // `requiredPermission` comment), so `href` is the only field
            // still guaranteed unique per nav entry.
            <CommandItem key={item.href} onSelect={() => runAndClose(() => router.push(item.href))}>
              {item.icon}
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </UiCommandPalette>
    </>
  );
}
