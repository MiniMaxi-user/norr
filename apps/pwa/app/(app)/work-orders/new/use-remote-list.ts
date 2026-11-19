"use client";

import { useEffect, useState } from "react";

export type RemoteStatus = "idle" | "loading" | "ready" | "error";

/** Debounces a fast-changing value (search text) by `delay` ms. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Fetches `{ items: T[] }` from `url` (issue #223's picker endpoints).
 * `null` url = nothing to load (`idle`, empty list). Aborts the in-flight
 * request whenever the url changes. */
export function useRemoteList<T>(url: string | null): { items: T[]; status: RemoteStatus } {
  const [state, setState] = useState<{ url: string | null; items: T[]; status: RemoteStatus }>({
    url: null,
    items: [],
    status: "idle",
  });

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    void (async () => {
      setState((current) => ({ url, items: current.url === url ? current.items : [], status: "loading" }));
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Unexpected response: ${response.status}`);
        const data = (await response.json()) as { items: T[] };
        setState({ url, items: data.items, status: "ready" });
      } catch {
        if (controller.signal.aborted) return;
        setState({ url, items: [], status: "error" });
      }
    })();
    return () => controller.abort();
  }, [url]);

  // A null url means "nothing requested" regardless of what was loaded last.
  if (!url) return { items: [], status: "idle" };
  // The url just changed and the effect hasn't flipped to loading yet.
  if (state.url !== url) return { items: [], status: "loading" };
  return { items: state.items, status: state.status };
}
