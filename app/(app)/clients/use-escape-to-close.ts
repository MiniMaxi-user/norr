"use client";

import { useEffect, useRef } from "react";

/**
 * The `Dialog` primitive in the current `@yourorg/ui` stub has no built-in
 * Escape-key handling (see the doc comment on `Dialog` in
 * `types/yourorg-ui.d.ts`: "compose your own ... if the call site needs
 * it"). Every dialog in this module needs it for a premium feel, so it's
 * composed once here instead of duplicated per dialog component.
 *
 * Issue #52 introduced the first genuinely NESTED dialog in this app
 * (`ContactFormDialog`'s "+ New contact" opened on top of an already-open
 * `SiteFormDialog`). Each dialog instance calls this hook independently and
 * they all attach a `keydown` listener to the same `document`, so a naive
 * version (just `onOpenChange(false)` on Escape) would fire BOTH listeners
 * on a single Escape press — closing the outer site dialog too and losing
 * whatever the user had already filled in there, not just the inner contact
 * dialog the user actually meant to dismiss. Same category of bug as
 * `Dialog`'s own outside-click fix (an outer surface reacting to an event
 * really meant for an inner one), just via a different event path (a
 * document-level key listener rather than element target/currentTarget), so
 * it needs its own fix: a small shared stack of currently-open dialog
 * instances (module-scope, mirrors how there's only ever one `document` to
 * attach to) — only the most-recently-opened (topmost) instance currently on
 * the stack actually closes on Escape; every dialog further down defers.
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
