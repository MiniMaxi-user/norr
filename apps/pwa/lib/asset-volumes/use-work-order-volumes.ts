"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getCachedWorkOrderVolumes,
  getLocalVolumeReadings,
  saveWorkOrderVolumes,
  type LocalVolumeReading,
} from "@/lib/offline/db";
import type { WorkOrderVolumesResponse } from "@/lib/asset-volumes/types";

/**
 * Counters + latest values for a work order (issue #225): fetched live and
 * cached in Dexie, falling back to that cache when the fetch fails, plus the
 * readings queued locally while offline. Shared by the Work tab's Volumes
 * block and the Sign tab's completeness checklist (owned by the detail screen).
 * `data` stays `null` when nothing was ever fetched (offline, no cache).
 */
export function useWorkOrderVolumes(workOrderId: string, currentUserId: string, enabled = true) {
  const [data, setData] = useState<WorkOrderVolumesResponse | null>(null);
  const [localReadings, setLocalReadings] = useState<LocalVolumeReading[]>([]);

  const refreshLocal = useCallback(async () => {
    setLocalReadings(await getLocalVolumeReadings(workOrderId, currentUserId));
  }, [workOrderId, currentUserId]);

  const reload = useCallback(async () => {
    // Issue #248: Meters module off — nothing to fetch (the route would 404).
    if (!enabled) return;
    try {
      const response = await fetch(`/api/work-orders/${workOrderId}/volumes`);
      if (response.ok) {
        const fresh = (await response.json()) as WorkOrderVolumesResponse;
        await saveWorkOrderVolumes(workOrderId, fresh, currentUserId);
        setData(fresh);
        return;
      }
    } catch {
      // Offline — fall through to the cache.
    }
    const cached = await getCachedWorkOrderVolumes(workOrderId, currentUserId);
    if (cached) setData((current) => current ?? cached.data);
  }, [workOrderId, currentUserId, enabled]);

  useEffect(() => {
    void reload();
    void refreshLocal();
  }, [reload, refreshLocal]);

  return { data, localReadings, reload, refreshLocal };
}
