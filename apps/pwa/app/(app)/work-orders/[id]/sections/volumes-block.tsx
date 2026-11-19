"use client";

import { useEffect, useState } from "react";
import { Callout, ConfirmDeleteDialog, Input, Label } from "@yourorg/ui";
import { PwaNote, WebAmount, WebButton, WebCard, WebStatusBadge } from "@yourorg/ui/web";
import { AlertTriangle, Trash2 } from "@yourorg/ui/icons";
import { formatVolumeValue } from "@/lib/asset-volumes/errors";
import { addLocalVolumeReading, deleteLocalVolumeReading, type LocalVolumeReading } from "@/lib/offline/db";
import type { WorkOrderVolumeCounter, WorkOrderVolumeReading, WorkOrderVolumesResponse } from "@/lib/asset-volumes/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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

/** Parses an engineer-typed reading into a number, or an error message. */
function parseReadingValue(raw: string): { value: number } | { error: string } {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return { error: "Enter a value." };
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { error: "Value must be a number." };
  if (value < 0) return { error: "Value cannot be negative." };
  if (value > 999_999_999_999.999) return { error: "Value is too large." };
  if (Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-6) return { error: "Value has at most 3 decimals." };
  return { value };
}

/**
 * "Volumes" block (issues #221, #225) — meter readings for the work order's
 * asset. Online: each reading is POSTed immediately and the server validates
 * it. Offline (or when the POST can't reach the server): it is checked
 * against the last known value, queued in Dexie (`localVolumeReadings`, shown
 * with a "Pending" badge, deletable while queued) and sent along with
 * Finish, where an out-of-order value is stored flagged for office review.
 * Renders from the cached counters when offline; nothing when the asset has
 * no counters or none were ever loaded.
 */
export function VolumesBlock({
  workOrderId,
  currentUserId,
  data,
  localReadings,
  onChanged,
  onLocalChanged,
}: {
  workOrderId: string;
  currentUserId: string;
  data: WorkOrderVolumesResponse | null;
  localReadings: LocalVolumeReading[];
  onChanged: () => Promise<void>;
  onLocalChanged: () => Promise<void>;
}) {
  const online = useOnlineStatus();

  if (!data || data.counters.length === 0) return null;
  const disabled = !data.canCreate;

  return (
    <WebCard size="touch" title="Volumes" meta={data.asset?.name}>
      {!online && (
        <div className="pwa-card-pad">
          <Callout icon={AlertTriangle}>
            {"You're offline. Readings are checked against the last known value and sent when you finish."}
          </Callout>
        </div>
      )}
      {data.counters.map((counter) => (
        <CounterRow
          key={counter.volumeItemId}
          workOrderId={workOrderId}
          currentUserId={currentUserId}
          counter={counter}
          queued={localReadings.filter((reading) => reading.volumeItemId === counter.volumeItemId)}
          disabled={disabled}
          online={online}
          onChanged={onChanged}
          onLocalChanged={onLocalChanged}
        />
      ))}
    </WebCard>
  );
}

function CounterRow({
  workOrderId,
  currentUserId,
  counter,
  queued,
  disabled,
  online,
  onChanged,
  onLocalChanged,
}: {
  workOrderId: string;
  currentUserId: string;
  counter: WorkOrderVolumeCounter;
  queued: LocalVolumeReading[];
  disabled: boolean;
  online: boolean;
  onChanged: () => Promise<void>;
  onLocalChanged: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<WorkOrderVolumeReading | null>(null);
  const idBase = `volume-${counter.volumeItemId}`;
  const unit = counter.unitLabel ? ` ${counter.unitLabel}` : "";

  // The value a new reading must not go below: the newest known reading, or a
  // higher one already queued locally (queued readings are newer by time).
  const queuedMax = queued.reduce<number | null>((max, r) => (max === null || r.value > max ? r.value : max), null);
  const floor = Math.max(counter.latest?.value ?? 0, queuedMax ?? 0);
  const hasFloor = counter.latest !== null || queuedMax !== null;

  async function queueOffline(numeric: number) {
    if (hasFloor && numeric < floor) {
      setError(`Value ${formatVolumeValue(numeric)} is lower than the latest known reading (${formatVolumeValue(floor)}).`);
      return;
    }
    await addLocalVolumeReading({
      id: crypto.randomUUID(),
      workOrderId,
      userId: currentUserId,
      volumeItemId: counter.volumeItemId,
      value: numeric,
      readAt: new Date().toISOString(),
      notes: null,
    });
    setValue("");
    await onLocalChanged();
  }

  async function handleSave() {
    setError(null);
    const parsed = parseReadingValue(value);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    try {
      if (!online) {
        await queueOffline(parsed.value);
        return;
      }
      let response: Response;
      try {
        // The reading time is always "now": the route defaults `readAt`.
        response = await fetch(`/api/work-orders/${workOrderId}/volumes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ volumeItemId: counter.volumeItemId, value: parsed.value }),
        });
      } catch {
        // Couldn't reach the server despite looking online: queue it.
        await queueOffline(parsed.value);
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Couldn't save this reading.");
        return;
      }
      setValue("");
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<{ error?: string }> {
    if (!toDelete) return {};
    try {
      const response = await fetch(`/api/work-orders/${workOrderId}/volumes/${toDelete.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        return { error: payload?.error ?? "Couldn't delete this reading." };
      }
      await onChanged();
      return {};
    } catch {
      return { error: "Couldn't delete this reading. Check your connection." };
    }
  }

  return (
    <div className="pwa-counter">
      <div className="pwa-stack" data-gap="sm">
        <h3 className="pwa-counter-title">
          {counter.label}
          {counter.unitLabel ? <span> ({counter.unitLabel})</span> : null}
        </h3>
        <PwaNote>
          {counter.latest ? (
            <>
              Latest:{" "}
              <WebAmount>
                {formatVolumeValue(counter.latest.value)}
                {unit}
              </WebAmount>{" "}
              · {formatDate(counter.latest.readAt)}
            </>
          ) : (
            "No readings yet."
          )}
        </PwaNote>
      </div>

      <div className="pwa-field">
        <Label htmlFor={`${idBase}-value`}>New reading</Label>
        <Input
          id={`${idBase}-value`}
          inputMode="decimal"
          autoComplete="off"
          placeholder={hasFloor ? `≥ ${formatVolumeValue(floor)}` : "0"}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>

      {error && (
        <PwaNote role="alert" tone="danger">
          {error}
        </PwaNote>
      )}
      <WebButton size="touch" block disabled={disabled || saving || !value.trim()} onClick={() => void handleSave()}>
        {saving ? "Saving…" : online ? "Save reading" : "Save reading (offline)"}
      </WebButton>

      {queued.length > 0 && (
        <div className="pwa-stack" data-gap="sm">
          <PwaNote>Waiting to be sent</PwaNote>
          {queued.map((reading) => (
            <div key={reading.id} className="pwa-row" data-justify="between">
              <span className="pwa-list-main">
                <span className="pwa-list-title pwa-mono">
                  {formatVolumeValue(reading.value)}
                  {unit}
                </span>
                <span className="pwa-note">{formatDate(reading.readAt)}</span>
              </span>
              <WebStatusBadge tone="warning" size="touch">
                Pending
              </WebStatusBadge>
              <button
                type="button"
                className="pwa-icon-btn"
                data-bare="true"
                aria-label={`Delete pending reading ${formatVolumeValue(reading.value)} for ${counter.label}`}
                onClick={() => void deleteLocalVolumeReading(reading.id).then(onLocalChanged)}
              >
                <Trash2 aria-hidden width={18} height={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      {counter.myReadings.length > 0 && (
        <div className="pwa-stack" data-gap="sm">
          <PwaNote>Your recent readings</PwaNote>
          {counter.myReadings.map((reading) => (
            <div key={reading.id} className="pwa-row" data-justify="between">
              <span className="pwa-list-main">
                <span className="pwa-list-title pwa-mono">
                  {formatVolumeValue(reading.value)}
                  {unit}
                </span>
                <span className="pwa-note">{formatDate(reading.readAt)}</span>
              </span>
              <button
                type="button"
                className="pwa-icon-btn"
                data-bare="true"
                aria-label={`Delete reading ${formatVolumeValue(reading.value)} for ${counter.label}`}
                disabled={!online}
                onClick={() => setToDelete(reading)}
              >
                <Trash2 aria-hidden width={18} height={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDeleteDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title="Delete reading"
        fallbackMessage={
          toDelete
            ? `Delete the reading ${formatVolumeValue(toDelete.value)}${unit} of ${formatDate(toDelete.readAt)}? This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete reading"
        onConfirm={handleDelete}
      />
    </div>
  );
}
