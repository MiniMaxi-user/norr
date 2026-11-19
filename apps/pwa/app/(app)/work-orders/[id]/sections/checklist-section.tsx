"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Callout, Checkbox, Input, Label } from "@yourorg/ui";
import { PwaCardText, PwaNote, PwaStack, WebCard, WebStatusBadge } from "@yourorg/ui/web";
import { AlertTriangle } from "@yourorg/ui/icons";
import { formatVolumeValue } from "@/lib/asset-volumes/errors";
import { deleteLocalVolumeReading, replaceLocalVolumeReading, type LocalVolumeReading } from "@/lib/offline/db";
import type { EffectiveChecklistItem } from "@/lib/checklists/use-work-order-checklist";
import type { WorkOrderVolumeCounter, WorkOrderVolumesResponse } from "@/lib/asset-volumes/types";

/** Pause after the last keystroke before a valid value is saved. */
const AUTOSAVE_DEBOUNCE_MS = 800;
const MAX_VOLUME = 999_999_999_999;
const DIGITS_ONLY_RE = /^\d+$/;

/** Whole numbers only (issue #230). `empty` = nothing typed yet (no error). */
function parseIntegerValue(raw: string): { value: number } | { empty: true } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { empty: true };
  if (!DIGITS_ONLY_RE.test(trimmed)) return { error: "Enter a whole number (0 or more)." };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value > MAX_VOLUME) return { error: "Value is too large." };
  return { value };
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/**
 * The "Checklist" tab (`?section=checklist`, issue #230) — two lists:
 *
 * 1. The work order's standard tick-off checklist (if it has one): big touch
 *    checkboxes, a "Required" marker for required items. Toggling saves
 *    immediately when online; offline it is queued (Dexie
 *    `localChecklistToggles`), shown as "Pending" and sent with Finish.
 * 2. The fixed, non-editable "Volumes" checklist, derived from the counters of
 *    the asset's model: one whole-number field per counter, always required.
 *    No save button — the field autosaves on blur and shortly after the last
 *    keystroke (see `VolumeField`).
 *
 * State (checklist items, counters, queued readings) is owned by
 * `work-order-detail.tsx` so the Sign tab's checklist can read it too.
 */
export function ChecklistSection({
  workOrderId,
  currentUserId,
  items,
  onToggle,
  volumes,
  localVolumeReadings,
  onVolumesChanged,
  onLocalVolumesChanged,
}: {
  workOrderId: string;
  currentUserId: string;
  items: EffectiveChecklistItem[];
  onToggle: (itemId: string, isChecked: boolean) => Promise<void>;
  volumes: WorkOrderVolumesResponse | null;
  localVolumeReadings: LocalVolumeReading[];
  onVolumesChanged: () => Promise<void>;
  onLocalVolumesChanged: () => Promise<void>;
}) {
  const hasItems = items.length > 0;
  const hasCounters = Boolean(volumes && volumes.counters.length > 0);

  return (
    <PwaStack>
      {hasItems && (
        <WebCard size="touch" title="Checklist">
          <div className="pwa-card-pad">
            <div className="pwa-pick-list">
              {items.map((item) => (
                <div key={item.id}>
                  <label className="pwa-pick-row">
                    <Checkbox checked={item.isChecked} onChange={(event) => void onToggle(item.id, event.target.checked)} />
                    <span className="pwa-pick-label">{item.label}</span>
                    {item.pending && (
                      <WebStatusBadge tone="warning" size="touch">
                        Pending
                      </WebStatusBadge>
                    )}
                    {item.isRequired && (
                      <WebStatusBadge tone="neutral" size="touch">
                        Required
                      </WebStatusBadge>
                    )}
                  </label>
                  {item.error && (
                    <PwaNote role="alert" tone="danger">
                      {item.error}
                    </PwaNote>
                  )}
                </div>
              ))}
            </div>
          </div>
        </WebCard>
      )}

      {hasCounters && volumes && (
        <WebCard size="touch" title="Volumes" meta={volumes.asset?.name}>
          {volumes.counters.map((counter) => (
            <VolumeField
              key={counter.volumeItemId}
              workOrderId={workOrderId}
              currentUserId={currentUserId}
              counter={counter}
              queued={localVolumeReadings.filter((reading) => reading.volumeItemId === counter.volumeItemId)}
              disabled={!volumes.canCreate}
              onChanged={onVolumesChanged}
              onLocalChanged={onLocalVolumesChanged}
            />
          ))}
        </WebCard>
      )}

      {!volumes && (
        <Callout icon={AlertTriangle}>Open this work order once while online to load its volume counters.</Callout>
      )}

      {!hasItems && !hasCounters && volumes && (
        <WebCard size="touch" title="Checklist">
          <PwaCardText empty>No checklist for this work order.</PwaCardText>
        </WebCard>
      )}
    </PwaStack>
  );
}

type FieldStatus = "idle" | "saving" | "saved" | "pending" | "error";

/**
 * One counter of the fixed "Volumes" checklist: a whole-number input that
 * autosaves (no Save button) — on blur, or ~800ms after the last keystroke
 * once the value is valid. Online: `POST /api/work-orders/[id]/volumes` (the
 * server replaces this engineer's earlier reading of the counter on this work
 * order). Offline, or when the server can't be reached: the reading replaces
 * the queued one for this counter (`localVolumeReadings`, one per counter per
 * work order) and is sent with Finish; a lower-than-previous value is refused
 * up front like the server would.
 */
function VolumeField({
  workOrderId,
  currentUserId,
  counter,
  queued,
  disabled,
  onChanged,
  onLocalChanged,
}: {
  workOrderId: string;
  currentUserId: string;
  counter: WorkOrderVolumeCounter;
  queued: LocalVolumeReading[];
  disabled: boolean;
  onChanged: () => Promise<void>;
  onLocalChanged: () => Promise<void>;
}) {
  const online = useOnlineStatus();
  const queuedValue = queued.length > 0 ? (queued[queued.length - 1]?.value ?? null) : null;
  const myReadingHere = counter.myReadings.find((reading) => reading.workOrderId === workOrderId) ?? null;
  const initial = queuedValue ?? myReadingHere?.value ?? null;

  const [value, setValue] = useState(initial === null ? "" : String(initial));
  const [status, setStatus] = useState<FieldStatus>(queuedValue !== null ? "pending" : "idle");
  const [message, setMessage] = useState<string | null>(null);
  // The last value that was saved (or loaded), so unchanged text isn't re-sent.
  const savedRef = useRef<number | null>(initial);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedRef = useRef(queued);
  queuedRef.current = queued;
  const idBase = `volume-${counter.volumeItemId}`;
  const unit = counter.unitLabel ? ` ${counter.unitLabel}` : "";

  // The previous value is the newest reading — unless that is this engineer's
  // own reading on this work order, which a new value replaces.
  const latestIsMine = counter.latest !== null && myReadingHere !== null && counter.latest.readingId === myReadingHere.id;
  const previous = counter.latest !== null && !latestIsMine ? counter.latest.value : null;

  const saveOnce = useCallback(
    async (numeric: number) => {
      if (savedRef.current === numeric && queuedRef.current.length === 0) return;
      setStatus("saving");
      setMessage(null);

      const queueOffline = async () => {
        if (previous !== null && numeric < previous) {
          setStatus("error");
          setMessage(`Lower than the previous reading (${formatVolumeValue(previous)}).`);
          return;
        }
        await replaceLocalVolumeReading({
          id: crypto.randomUUID(),
          workOrderId,
          userId: currentUserId,
          volumeItemId: counter.volumeItemId,
          value: numeric,
          readAt: new Date().toISOString(),
          notes: null,
        });
        savedRef.current = numeric;
        setStatus("pending");
        await onLocalChanged();
      };

      if (!navigator.onLine) {
        await queueOffline();
        return;
      }
      let response: Response;
      try {
        response = await fetch(`/api/work-orders/${workOrderId}/volumes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ volumeItemId: counter.volumeItemId, value: numeric }),
        });
      } catch {
        // Couldn't reach the server despite looking online.
        await queueOffline();
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setStatus("error");
        setMessage(payload?.error ?? "Couldn't save this value.");
        return;
      }
      // The server now holds the value: a queued older one must not be sent
      // with Finish (it would replace this one).
      for (const reading of queuedRef.current) await deleteLocalVolumeReading(reading.id);
      savedRef.current = numeric;
      setStatus("saved");
      await onLocalChanged();
      await onChanged();
    },
    [workOrderId, currentUserId, counter.volumeItemId, previous, onChanged, onLocalChanged],
  );

  // Never two concurrent POSTs for the same counter: while a save runs, only the
  // latest requested value is remembered and saved right after it finishes.
  const inFlightRef = useRef(false);
  const pendingRef = useRef<number | null>(null);
  const save = useCallback(
    async (numeric: number) => {
      if (inFlightRef.current) {
        pendingRef.current = numeric;
        return;
      }
      inFlightRef.current = true;
      try {
        let next: number | null = numeric;
        while (next !== null) {
          pendingRef.current = null;
          await saveOnce(next);
          next = pendingRef.current as number | null;
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [saveOnce],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function handleChange(next: string) {
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    const parsed = parseIntegerValue(next);
    if ("error" in parsed) {
      setStatus("error");
      setMessage(parsed.error);
      return;
    }
    setMessage(null);
    if ("empty" in parsed) {
      setStatus("idle");
      return;
    }
    timerRef.current = setTimeout(() => void save(parsed.value), AUTOSAVE_DEBOUNCE_MS);
  }

  function handleBlur() {
    if (timerRef.current) clearTimeout(timerRef.current);
    const parsed = parseIntegerValue(value);
    if ("value" in parsed) void save(parsed.value);
  }

  return (
    <div className="pwa-counter">
      <div className="pwa-field">
        <Label htmlFor={`${idBase}-value`}>
          {counter.label}
          {counter.unitLabel ? ` (${counter.unitLabel})` : ""}
        </Label>
        <Input
          id={`${idBase}-value`}
          inputMode="numeric"
          autoComplete="off"
          placeholder="0"
          value={value}
          disabled={disabled}
          aria-invalid={status === "error" ? true : undefined}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={handleBlur}
        />
      </div>
      {counter.latest && !latestIsMine && (
        <PwaNote>
          Last: {formatVolumeValue(counter.latest.value)}
          {unit}
        </PwaNote>
      )}
      <PwaNote
        role={status === "error" ? "alert" : "status"}
        tone={status === "error" ? "danger" : status === "saved" ? "success" : undefined}
      >
        {status === "saving" && "Saving…"}
        {status === "saved" && "Saved ✓"}
        {status === "pending" && (online ? "Saved on this device, sent with Finish" : "Pending (offline), sent with Finish")}
        {status === "error" && message}
        {status === "idle" && !value.trim() && "Required"}
      </PwaNote>
    </div>
  );
}
