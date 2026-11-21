"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { getCachedFeatures, saveCachedFeatures } from "@/lib/offline/db";

/** Feature keys the PWA gates on (issue #248). */
export type PwaFeatureKey = "checklists" | "inventory" | "meters";

export interface Features {
  /** `false` until the cache/live read resolved. While not ready, `has()` is false. */
  ready: boolean;
  has: (key: PwaFeatureKey) => boolean;
}

const FeaturesContext = createContext<Features>({ ready: false, has: () => false });

/**
 * Loads the org's enabled modules once per session (app start/login — this
 * provider lives in the protected layout, so it mounts once and survives
 * navigation): Dexie cache first (instant, works offline), then
 * `GET /api/features` once, written back to the cache. If neither source has
 * ever answered (offline on a never-synced device) everything is treated as
 * on — the API routes stay the real boundary and 404 for a module that's off.
 */
export function FeaturesProvider({ currentUserId, children }: { currentUserId: string; children: ReactNode }) {
  const [enabled, setEnabled] = useState<ReadonlySet<string> | "all" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await getCachedFeatures(currentUserId);
      if (!cancelled && cached) setEnabled(new Set(cached));
      try {
        const response = await fetch("/api/features");
        if (response.ok) {
          const data = (await response.json()) as { features?: string[] };
          const features = Array.isArray(data.features) ? data.features : [];
          await saveCachedFeatures(features, currentUserId);
          if (!cancelled) setEnabled(new Set(features));
          return;
        }
      } catch {
        // Offline — keep the cached set.
      }
      if (!cancelled && !cached) setEnabled("all");
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const value = useMemo<Features>(
    () => ({
      ready: enabled !== null,
      has: (key) => (enabled === null ? false : enabled === "all" ? true : enabled.has(key)),
    }),
    [enabled],
  );

  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>;
}

export function useFeatures(): Features {
  return useContext(FeaturesContext);
}
