/**
 * Response/request contract for the work order asset volumes routes
 * (issue #221): `/api/work-orders/[id]/volumes` and
 * `/api/work-orders/[id]/volumes/[readingId]`. Plain data shapes (no
 * server-only imports) so client components can import them.
 */

export interface WorkOrderVolumeReading {
  id: string;
  value: number;
  /** ISO timestamp. */
  readAt: string;
  notes: string | null;
  /** The work order the reading was entered on (may be another one). */
  workOrderId: string | null;
  /** ISO timestamp. */
  createdAt: string;
}

export interface WorkOrderVolumeCounter {
  volumeItemId: string;
  label: string;
  description: string | null;
  /** Label of the counter's `article_unit` (e.g. "Prints"), if any. */
  unitLabel: string | null;
  /** Newest reading by anyone (the value the engineer must not go below). */
  latest: { readingId: string; value: number; readAt: string } | null;
  /** The signed-in engineer's own recent readings for this asset+counter,
   * newest first (max 5) — each one deletable via DELETE. */
  myReadings: WorkOrderVolumeReading[];
  /** True when at least one reading by anyone exists on THIS work order
   * (issue #225: finishing requires one per counter). */
  hasReadingOnWorkOrder: boolean;
}

export interface WorkOrderVolumesResponse {
  workOrderId: string;
  /** null when the work order has no asset (then `counters` is empty). */
  asset: { id: string; name: string } | null;
  /** Counters configured on the asset's current model, in model order. */
  counters: WorkOrderVolumeCounter[];
  /** Always true for an engineer today (asset_volumes create_own). */
  canCreate: boolean;
}

/** POST body. `assetId` is NOT accepted: it is always the work order's own asset. */
export interface CreateWorkOrderVolumeReadingBody {
  volumeItemId: string;
  /** Number or numeric string, >= 0, max 3 decimals. */
  value: number | string;
  /** ISO timestamp WITH offset; omit = now. Not in the future. */
  readAt?: string;
  notes?: string;
}

export interface CreateWorkOrderVolumeReadingResponse {
  reading: WorkOrderVolumeReading & { volumeItemId: string };
}

/** One queued (offline-entered) reading, as sent in the finish POST's
 * `volumeReadings` array (issue #225). `id` is the client uuid and doubles as
 * the `asset_volume_readings.id` idempotency key. */
export interface FinishVolumeReadingInput {
  id: string;
  volumeItemId: string;
  value: number;
  /** ISO timestamp WITH offset (the moment the engineer entered it). */
  readAt: string;
  notes: string | null;
}
