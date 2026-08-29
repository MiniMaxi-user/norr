"use client";
// Genuinely interactive (owns real hook state via useEffect/useRef), so —
// same as client.tsx/tabs.tsx/toast.tsx/combobox.tsx/confirm-delete-dialog.tsx
// — it needs its OWN dedicated "use client" tsup build entry rather than
// living in the hook-free main index.js bundle Server Components import
// (confirmed the hard way: `next build` fails with "You're importing a
// component that needs useEffect" once this file is reachable from
// `app/layout.tsx` via the plain index.js bundle — `tsc --noEmit` does not
// catch this, only a real `next build` does). See tsup.config.ts's
// top-of-file comment for the full "why a sibling file, not inlined into
// index.ts" story. Lives at the top level of `src/` (not under
// `src/components/`), same as those other dedicated-entry modules —
// required, not just cosmetic, per that same comment.

import { useEffect, useRef } from "react";

/**
 * `Dialog` has no built-in Escape-key handling by design (compose it per
 * call site) — this is that composition, shared by every dialog/panel in
 * the app instead of being duplicated per module.
 *
 * A naive version (just `onOpenChange(false)` on Escape) breaks the moment
 * two dialog instances are open at once (a nested dialog opened on top of
 * an already-open one, e.g. a "+ New contact" dialog over a Site dialog):
 * every open instance attaches a `keydown` listener to the same
 * `document`, so a single Escape press would fire ALL of them, closing the
 * outer dialog too and losing whatever the user had already filled in
 * there, not just the inner dialog they meant to dismiss. Fixed with a
 * small shared stack of currently-open dialog instances (module-scope,
 * mirrors how there's only ever one `document` to attach to) — only the
 * most-recently-opened (topmost) instance on the stack actually closes on
 * Escape; every dialog further down defers.
 */
let openStack: symbol[] = [];

export function useEscapeToClose(open: boolean, onOpenChange: (open: boolean) => void): void {
  const idRef = useRef<symbol | null>(null);
  if (!idRef.current) idRef.current = Symbol("dialog");

  useEffect(() => {
    if (!open) return;
    const id = idRef.current!;
    openStack.push(id);
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Only the topmost (most recently opened) dialog on the stack responds
      // — an Escape press while a nested dialog is open should close just
      // that nested dialog, not everything underneath it.
      if (openStack[openStack.length - 1] !== id) return;
      onOpenChange(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openStack = openStack.filter((entry) => entry !== id);
    };
  }, [open, onOpenChange]);
}
