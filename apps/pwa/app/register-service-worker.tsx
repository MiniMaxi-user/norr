"use client";

import { useEffect } from "react";

/** Registers the PWA service worker (public/sw.js) on mount. Real offline
 * caching is a later story — for now this just makes the app installable
 * (see public/sw.js's own top-of-file comment). */
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
