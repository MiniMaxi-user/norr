"use client";

import { useEffect } from "react";

/**
 * Same Escape-to-close composition `app/(app)/clients/use-escape-to-close.ts`
 * uses for every client panel/dialog — the `Dialog` primitive in
 * `@yourorg/ui` has no built-in Escape handling by design (a call site is
 * always already a "use client" component, so this is cheap to add there).
 * Duplicated locally rather than imported cross-module, matching this app's
 * existing convention of each module owning its own dialog plumbing (no
 * shared `lib/hooks` extraction exists yet for this one hook).
 */
export function useEscapeToClose(open: boolean, onOpenChange: (open: boolean) => void): void {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);
}
