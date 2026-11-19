"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { syncPendingChecklistToggles } from "@/lib/offline/checklist-sync";
import {
  deleteLocalChecklistToggle,
  getLocalChecklistToggles,
  putLocalChecklistToggle,
} from "@/lib/offline/db";
import type { WorkOrderChecklist } from "@/lib/work-orders/types";

/** One checklist item as shown: the server's state overlaid with a toggle
 * that is still queued locally (offline). */
export interface EffectiveChecklistItem {
  id: string;
  label: string;
  isRequired: boolean;
  isChecked: boolean;
  /** The shown state is a local toggle the server doesn't have yet. */
  pending: boolean;
  /** Last save attempt failed with a server error (not a connectivity one). */
  error: string | null;
}

export interface ChecklistProgress {
  /** True when the work order has a standard checklist with >= 1 item. */
  present: boolean;
  /** Required items only. */
  total: number;
  done: number;
  missing: string[];
  complete: boolean;
}

/**
 * The standard (tick-off) checklist of a work order (issue #230): the
 * server-side items from the detail response (live or cached) plus toggles
 * queued in Dexie (`localChecklistToggles`) while offline. Toggling saves
 * immediately (`PATCH /api/work-orders/[id]/checklist/items/[itemId]`) when
 * the server is reachable; when it isn't, the toggle is queued, shown as
 * pending, and sent with Finish (applied server-side before validation).
 */
export function useWorkOrderChecklist(
  workOrderId: string,
  currentUserId: string,
  checklist: WorkOrderChecklist | null | undefined,
) {
  const [serverChecked, setServerChecked] = useState<Record<string, boolean>>({});
  const [queued, setQueued] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Re-seed from the (re)loaded detail.
  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const item of checklist?.items ?? []) next[item.id] = item.isChecked;
    setServerChecked(next);
  }, [checklist]);

  const refreshQueued = useCallback(async () => {
    const rows = await getLocalChecklistToggles(workOrderId, currentUserId);
    const next: Record<string, boolean> = {};
    for (const row of rows) next[row.itemId] = row.isChecked;
    setQueued(next);
  }, [workOrderId, currentUserId]);

  // Load the queue; flush it whenever the connection comes back.
  useEffect(() => {
    void refreshQueued();
    function onOnline() {
      void syncPendingChecklistToggles(currentUserId).then(refreshQueued);
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [currentUserId, refreshQueued]);

  const items = useMemo<EffectiveChecklistItem[]>(
    () =>
      (checklist?.items ?? []).map((item) => {
        const isQueued = item.id in queued;
        return {
          id: item.id,
          label: item.label,
          isRequired: item.isRequired,
          isChecked: isQueued ? Boolean(queued[item.id]) : (serverChecked[item.id] ?? item.isChecked),
          pending: isQueued,
          error: errors[item.id] ?? null,
        };
      }),
    [checklist, queued, serverChecked, errors],
  );

  const progress = useMemo<ChecklistProgress>(() => {
    const required = items.filter((item) => item.isRequired);
    const missing = required.filter((item) => !item.isChecked).map((item) => item.label);
    return {
      present: items.length > 0,
      total: required.length,
      done: required.length - missing.length,
      missing,
      complete: missing.length === 0,
    };
  }, [items]);

  const toggle = useCallback(
    async (itemId: string, isChecked: boolean) => {
      setErrors((current) => {
        if (!(itemId in current)) return current;
        const rest = { ...current };
        delete rest[itemId];
        return rest;
      });
      const queueIt = async () => {
        await putLocalChecklistToggle({ itemId, workOrderId, userId: currentUserId, isChecked, at: Date.now() });
        await refreshQueued();
      };
      // Optimistic: show the new state right away.
      setServerChecked((current) => ({ ...current, [itemId]: isChecked }));
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await queueIt();
        return;
      }
      try {
        const response = await fetch(`/api/work-orders/${workOrderId}/checklist/items/${itemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isChecked }),
        });
        if (response.ok) {
          await deleteLocalChecklistToggle(itemId);
          await refreshQueued();
          return;
        }
        // A real server rejection: revert and show why.
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setServerChecked((current) => ({ ...current, [itemId]: !isChecked }));
        setErrors((current) => ({ ...current, [itemId]: payload?.error ?? "Couldn't save this item." }));
      } catch {
        // Couldn't reach the server despite looking online: queue it.
        await queueIt();
      }
    },
    [workOrderId, currentUserId, refreshQueued],
  );

  return { items, progress, toggle, refreshQueued };
}
