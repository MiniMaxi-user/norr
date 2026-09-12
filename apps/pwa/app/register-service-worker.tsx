"use client";

import { useEffect } from "react";

/** Registers the PWA service worker (public/sw.js) on mount. As of issue
 * #169, public/sw.js does real app-shell caching (network-first
 * navigations, cache-first static assets) — see its own top-of-file
 * comment for the full strategy. This component itself is unchanged: just
 * registration, no caching logic lives here. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Service worker registration failed:", error);
      });
    }
  }, []);

  return null;
}
