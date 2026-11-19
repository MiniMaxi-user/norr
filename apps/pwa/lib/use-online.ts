"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Live `navigator.onLine` (issue #223) — re-renders on the browser's
 * `online`/`offline` events. Server snapshot assumes online so SSR/hydration
 * never flashes the offline state. Only a hint: a request can still fail while
 * `onLine` is true, callers must handle network errors on their own. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
