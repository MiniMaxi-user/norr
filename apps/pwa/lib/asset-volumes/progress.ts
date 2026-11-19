import type { WorkOrderVolumesResponse } from "@/lib/asset-volumes/types";
import type { LocalVolumeReading } from "@/lib/offline/db";

/**
 * Volume completeness for finishing a work order (issue #225): every counter
 * configured on the asset's model needs >= 1 reading on THIS work order,
 * either already on the server or queued locally.
 *
 * `known: false` = the counters were never fetched on this device (offline,
 * no cache) — completeness can't be judged.
 */
export type VolumeProgress =
  | { known: false }
  | { known: true; total: number; done: number; missing: string[]; complete: boolean };

export function computeVolumeProgress(
  data: WorkOrderVolumesResponse | null,
  localReadings: LocalVolumeReading[],
  workOrderId: string,
): VolumeProgress {
  if (!data) return { known: false };
  const queued = new Set(localReadings.map((reading) => reading.volumeItemId));
  const missing: string[] = [];
  for (const counter of data.counters) {
    const onServer =
      counter.hasReadingOnWorkOrder === true || counter.myReadings.some((reading) => reading.workOrderId === workOrderId);
    if (!onServer && !queued.has(counter.volumeItemId)) missing.push(counter.label);
  }
  const total = data.counters.length;
  return { known: true, total, done: total - missing.length, missing, complete: missing.length === 0 };
}
