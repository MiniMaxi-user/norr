"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Callout,
  Card,
  ConfirmDeleteDialog,
  Disclosure,
  Heading,
  IconButton,
  Inline,
  Input,
  Label,
  Stack,
  Text,
  Textarea,
} from "@yourorg/ui";
import { AlertTriangle, Trash2 } from "@yourorg/ui/icons";
import { formatVolumeValue } from "@/lib/asset-volumes/errors";
import type { WorkOrderVolumeCounter, WorkOrderVolumeReading, WorkOrderVolumesResponse } from "@/lib/asset-volumes/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Current local time as a `datetime-local` input value. */
function nowLocalInputValue(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
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
    <Card>
      <Stack gap="md">
        <Heading level={3}>Volumes{data.asset ? ` · ${data.asset.name}` : ""}</Heading>
        {!online && <Callout icon={AlertTriangle}>Readings require a connection.</Callout>}
        {data.counters.map((counter) => (
          <CounterRow key={counter.volumeItemId} workOrderId={workOrderId} counter={counter} disabled={disabled} online={online} onChanged={load} />
        ))}
      </Stack>
    </Card>
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
  const [readAt, setReadAt] = useState("");
  const [notes, setNotes] = useState("");
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
      const body: Record<string, unknown> = { volumeItemId: counter.volumeItemId, value: value.trim().replace(",", ".") };
      if (readAt) body.readAt = new Date(readAt).toISOString();
      if (notes.trim()) body.notes = notes.trim();
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
      setReadAt("");
      setNotes("");
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
    <Stack gap="sm">
      <Stack gap="xs">
        <Text style={{ fontWeight: 650 }}>
          {counter.label}
          {counter.unitLabel ? <span style={{ fontWeight: 400 }}> ({counter.unitLabel})</span> : null}
        </Text>
        <Text tone="muted">
          {counter.latest ? `Latest: ${formatVolumeValue(counter.latest.value)}${unit} · ${formatDate(counter.latest.readAt)}` : "No readings yet."}
        </Text>
      </Stack>

      <Stack gap="xs">
        <Label htmlFor={`${idBase}-value`}>New reading</Label>
        <Input
          id={`${idBase}-value`}
          inputMode="decimal"
          autoComplete="off"
          placeholder={counter.latest ? `≥ ${formatVolumeValue(counter.latest.value)}` : "0"}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          style={{ minHeight: 44 }}
        />
      </Stack>

      <Disclosure>
        <Disclosure.Summary>Date and notes</Disclosure.Summary>
        <Disclosure.Content>
          <Stack gap="sm">
            <Stack gap="xs">
              <Label htmlFor={`${idBase}-date`}>Read at (default: now)</Label>
              <Input
                id={`${idBase}-date`}
                type="datetime-local"
                value={readAt}
                max={nowLocalInputValue()}
                disabled={disabled}
                onChange={(event) => setReadAt(event.target.value)}
                style={{ minHeight: 44 }}
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor={`${idBase}-notes`}>Notes</Label>
              <Textarea
                id={`${idBase}-notes`}
                rows={2}
                maxLength={500}
                value={notes}
                disabled={disabled}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Stack>
          </Stack>
        </Disclosure.Content>
      </Disclosure>

      {error && (
        <Text role="alert" tone="danger">
          {error}
        </Text>
      )}
      <Button fullWidth disabled={disabled || saving || !value.trim()} onClick={() => void handleSave()} style={{ minHeight: 44 }}>
        {saving ? "Saving…" : "Save reading"}
      </Button>
      {!online && <Text tone="muted">Readings require a connection.</Text>}

      {counter.myReadings.length > 0 && (
        <Stack gap="xs">
          <Text tone="muted">Your recent readings</Text>
          {counter.myReadings.map((reading) => (
            <Inline key={reading.id} gap="sm" align="center" justify="between">
              <Stack gap="xs">
                <Text style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatVolumeValue(reading.value)}
                  {unit}
                </Text>
                <Text tone="muted">
                  {formatDate(reading.readAt)}
                  {reading.notes ? ` · ${reading.notes}` : ""}
                </Text>
              </Stack>
              <IconButton
                aria-label={`Delete reading ${formatVolumeValue(reading.value)} for ${counter.label}`}
                disabled={!online}
                onClick={() => setToDelete(reading)}
                style={{ minWidth: 44, minHeight: 44 }}
              >
                <Trash2 aria-hidden width={18} height={18} />
              </IconButton>
            </Inline>
          ))}
        </Stack>
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
    </Stack>
  );
}
