"use client";

import { useCallback, useEffect, useState } from "react";
import { Callout, ConfirmDeleteDialog, Input, Label } from "@yourorg/ui";
import { PwaNote, WebAmount, WebButton, WebCard } from "@yourorg/ui/web";
import { AlertTriangle, Trash2 } from "@yourorg/ui/icons";
import { formatVolumeValue } from "@/lib/asset-volumes/errors";
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

/**
 * "Volumes" block (issue #221) — meter readings for the work order's asset.
 * Online-only: the server validates each value against neighbouring
 * readings, so there is no offline queue. Renders nothing while loading,
 * when the fetch fails, or when the asset has no counters.
 */
export function VolumesBlock({ workOrderId }: { workOrderId: string }) {
  const online = useOnlineStatus();
  const [data, setData] = useState<WorkOrderVolumesResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/work-orders/${workOrderId}/volumes`);
      if (!response.ok) return;
      setData((await response.json()) as WorkOrderVolumesResponse);
    } catch {
      // Offline/failed: keep whatever was last fetched in memory.
    }
  }, [workOrderId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data || data.counters.length === 0) return null;
  const disabled = !online || !data.canCreate;

  return (
    <WebCard size="touch" title="Volumes" meta={data.asset?.name}>
      {!online && (
        <div className="pwa-card-pad">
          <Callout icon={AlertTriangle}>Readings require a connection.</Callout>
        </div>
      )}
      {data.counters.map((counter) => (
        <CounterRow key={counter.volumeItemId} workOrderId={workOrderId} counter={counter} disabled={disabled} online={online} onChanged={load} />
      ))}
    </WebCard>
  );
}

function CounterRow({
  workOrderId,
  counter,
  disabled,
  online,
  onChanged,
}: {
  workOrderId: string;
  counter: WorkOrderVolumeCounter;
  disabled: boolean;
  online: boolean;
  onChanged: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<WorkOrderVolumeReading | null>(null);
  const idBase = `volume-${counter.volumeItemId}`;
  const unit = counter.unitLabel ? ` ${counter.unitLabel}` : "";

  async function handleSave() {
    setError(null);
    if (!value.trim()) {
      setError("Enter a value.");
      return;
    }
    setSaving(true);
    try {
      // The reading time is always "now": the route defaults `readAt` to the
      // current date-time, so neither `readAt` nor `notes` is ever sent.
      const body: Record<string, unknown> = { volumeItemId: counter.volumeItemId, value: value.trim().replace(",", ".") };
      const response = await fetch(`/api/work-orders/${workOrderId}/volumes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Couldn't save this reading.");
        return;
      }
      setValue("");
      await onChanged();
    } catch {
      setError("Couldn't save this reading. Check your connection and try again.");
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
          placeholder={counter.latest ? `≥ ${formatVolumeValue(counter.latest.value)}` : "0"}
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
        {saving ? "Saving…" : "Save reading"}
      </WebButton>
      {!online && <PwaNote>Readings require a connection.</PwaNote>}

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
                <span className="pwa-note">
                  {formatDate(reading.readAt)}
                </span>
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
