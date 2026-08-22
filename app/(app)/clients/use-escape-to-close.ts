"use client";

import { useEffect } from "react";

/**
 * The `Dialog` primitive in the current `@yourorg/ui` stub has no built-in
 * Escape-key handling (see the doc comment on `Dialog` in
 * `types/yourorg-ui.d.ts`: "compose your own ... if the call site needs
 * it"). Every dialog in this module needs it for a premium feel, so it's
 * composed once here instead of duplicated per dialog component.
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
