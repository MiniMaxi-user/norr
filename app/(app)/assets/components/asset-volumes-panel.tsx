"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog, Dialog, Heading, Input, Label, Select, Stack, Text, Textarea, Button } from "@yourorg/ui";
import { WebBadge, WebCard } from "@yourorg/ui/web";
import { WebButton } from "@yourorg/ui/web";
import { WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import {
  createAssetVolumeReading,
  deleteAssetVolumeReading,
  type AssetVolumeCounter,
  type AssetVolumeReading,
  type AssetVolumesData,
} from "@/lib/asset-volumes/actions";
import { formatDateTimeWeb, formatNumberWeb } from "@/lib/format/web";

export interface AssetVolumesPanelProps {
  volumes: AssetVolumesData;
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDelta(delta: number): string {
  const text = formatNumberWeb(Math.abs(delta));
  return delta > 0 ? `+${text}` : delta < 0 ? `-${text}` : text;
}

interface ReadingRow extends AssetVolumeReading {
  /** Change versus the previous (older) reading; null for the first one. */
  delta: number | null;
}

/**
 * Asset "Volumes" tab (issue #221, restyled issue #222): one card per counter
 * of the asset's model — title + mono meta ("Latest: …"), its own FilterBar
 * and a readings table, all with the identical structure. "+ Reading" sits in
 * the FilterBar (counter pre-selected), delete is in the row ··· menu.
 * Readings cannot be edited; the model/counter rules and the add/delete
 * actions are unchanged.
 */
export function AssetVolumesPanel({ volumes }: AssetVolumesPanelProps) {
  const [addFor, setAddFor] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetVolumeReading | null>(null);
  const router = useRouter();

  const configured = volumes.counters.filter((counter) => !counter.notConfigured);

  const settingsHint = (
    <>
      Counters are configured per asset model in <Link href="/settings/asset-models">Settings, Asset Models</Link>.
    </>
  );

  if (!volumes.modelId || volumes.counters.length === 0) {
    return (
      <WebCard title="Volumes">
        <p className="web-card-text">
          {volumes.modelId
            ? "No counters on this model. Add one or more counters to this asset's model to start recording volume readings. "
            : "No model on this asset. Link this asset to a model first. "}
          {settingsHint}
        </p>
      </WebCard>
    );
  }

  return (
    <div className="web-tab-stack">
      {volumes.counters.map((counter, index) => (
        <CounterCard
          key={counter.volumeItemId}
          counter={counter}
          prefix={`vol${index}`}
          canAdd={volumes.canCreate && !counter.notConfigured && configured.length > 0}
          onAdd={() => setAddFor(counter.volumeItemId)}
          onDelete={setDeleteTarget}
          shortcut={index === 0}
        />
      ))}
      <p className="web-card-note">{settingsHint}</p>

      {volumes.canCreate && addFor && (
        <AddReadingDialog
          onClose={() => setAddFor(null)}
          assetId={volumes.assetId}
          counters={configured}
          defaultCounterId={addFor}
        />
      )}

      <ConfirmDeleteDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete this reading?"
        fallbackMessage="Readings cannot be edited. Deleting removes this reading permanently; you can add a corrected one afterwards."
        confirmLabel="Delete reading"
        onConfirm={async () => {
          if (!deleteTarget) return { error: "No reading selected." };
          const result = await deleteAssetVolumeReading({ id: deleteTarget.id });
          return { error: result.error };
        }}
        onDeleted={() => router.refresh()}
      />
    </div>
  );
}

function CounterCard({
  counter,
  prefix,
  canAdd,
  onAdd,
  onDelete,
  shortcut,
}: {
  counter: AssetVolumeCounter;
  prefix: string;
  canAdd: boolean;
  onAdd: () => void;
  onDelete: (reading: AssetVolumeReading) => void;
  shortcut: boolean;
}) {
  const unit = counter.unitLabel ? ` ${counter.unitLabel}` : "";
  const rows = useMemo<ReadingRow[]>(
    () =>
      counter.readings.map((reading, index) => {
        const previous = counter.readings[index + 1];
        return { ...reading, delta: previous ? reading.value - previous.value : null };
      }),
    [counter.readings],
  );

  const columns = useMemo<WebColumn<ReadingRow>[]>(
    () => [
      { id: "readAt", header: "Date/time", sortValue: (row) => row.readAt, render: (row) => formatDateTimeWeb(row.readAt) },
      {
        id: "value",
        header: "Value",
        align: "end",
        sortValue: (row) => row.value,
        render: (row) => (
          <>
            {`${formatNumberWeb(row.value)}${unit}`}
            {row.needsReview && (
              <>
                {" "}
                <WebBadge variant="warning">Needs review</WebBadge>
              </>
            )}
          </>
        ),
      },
      {
        id: "delta",
        header: "Change",
        align: "end",
        sortValue: (row) => row.delta,
        render: (row) => (row.delta === null ? "—" : formatDelta(row.delta)),
      },
      {
        id: "workOrder",
        header: "Work order",
        render: (row) =>
          row.workOrderId ? (
            <Link href={`/work-orders/${row.workOrderId}`} className="web-cell-link">
              {row.workOrderLabel ?? "Work order"}
            </Link>
          ) : (
            "—"
          ),
      },
      {
        id: "by",
        header: "Recorded by",
        sortValue: (row) => row.createdByName ?? "",
        render: (row) => row.createdByName ?? "—",
      },
      { id: "notes", header: "Notes", render: (row) => row.notes ?? "—" },
    ],
    [unit],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "by",
        label: "Recorded by",
        getOptions: (row: ReadingRow) =>
          row.createdByName ? [{ value: row.createdByName, label: row.createdByName }] : [],
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show readings",
      defaultValue: "all",
      options: [
        { value: "manual", label: "Manual", match: (row: ReadingRow) => !row.workOrderId },
        { value: "workorder", label: "Work order", match: (row: ReadingRow) => Boolean(row.workOrderId) },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  const meta = counter.latest
    ? `Latest: ${formatNumberWeb(counter.latest.value)}${unit} · ${formatDateTimeWeb(counter.latest.readAt)}`
    : "No readings yet";

  return (
    <WebDataTableCard
      title={`${counter.label}${counter.notConfigured ? " (no longer on model)" : ""}${!counter.isActive ? " (retired)" : ""}`}
      meta={meta}
      rows={rows}
      getRowKey={(row) => row.id}
      columns={columns}
      searchText={(row) => `${row.createdByName ?? ""} ${row.notes ?? ""} ${row.workOrderLabel ?? ""}`}
      noun="readings"
      dropdowns={dropdowns}
      segment={segment}
      urlPrefix={prefix}
      defaultSort={{ columnId: "readAt", direction: "desc" }}
      searchShortcut={shortcut}
      note={counter.description ?? undefined}
      rowActions={(row): WebMenuItem[] =>
        row.canDelete ? [{ key: "delete", label: "Delete reading", danger: true, onSelect: () => onDelete(row) }] : []
      }
      rowLabel={(row) => `reading of ${formatNumberWeb(row.value)} on ${formatDateTimeWeb(row.readAt)}`}
      add={
        canAdd ? (
          <WebButton size="filter" onClick={onAdd}>
            + Reading
          </WebButton>
        ) : undefined
      }
      emptyAction={canAdd ? "Use + Reading to record the first one." : undefined}
    />
  );
}

function AddReadingDialog({
  onClose,
  assetId,
  counters,
  defaultCounterId,
}: {
  onClose: () => void;
  assetId: string;
  counters: AssetVolumeCounter[];
  defaultCounterId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [now] = useState(() => toLocalInputValue(new Date()));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const localDate = String(form.get("readAt") ?? "");
    const parsedDate = localDate ? new Date(localDate) : null;
    if (parsedDate && Number.isNaN(parsedDate.getTime())) {
      setFieldErrors({ readAt: ["Enter a valid date and time."] });
      return;
    }
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await createAssetVolumeReading({
        assetId,
        volumeItemId: form.get("volumeItemId"),
        value: form.get("value"),
        readAt: parsedDate ? parsedDate.toISOString() : undefined,
        notes: String(form.get("notes") ?? "").trim() || undefined,
      });
      if (result.error || !result.data) {
        setError(result.error ?? "Could not add this reading.");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      onClose();
      router.refresh();
    });
  }

  const fieldError = (name: string) =>
    fieldErrors[name]?.map((message) => (
      <Text key={message} tone="danger">
        {message}
      </Text>
    ));

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} size="sm">
      <Dialog.Header>
        <Heading level={3}>Add reading</Heading>
      </Dialog.Header>
      <form onSubmit={handleSubmit}>
        <Dialog.Body>
          <Stack gap="md">
            {error && <Text tone="danger">{error}</Text>}

            <Stack gap="xs">
              <Label htmlFor="asset-volume-counter">Counter</Label>
              <Select id="asset-volume-counter" name="volumeItemId" required defaultValue={defaultCounterId ?? counters[0]?.volumeItemId}>
                {counters.map((counter) => (
                  <option key={counter.volumeItemId} value={counter.volumeItemId}>
                    {counter.label}
                    {counter.unitLabel ? ` (${counter.unitLabel})` : ""}
                  </option>
                ))}
              </Select>
              {fieldError("volumeItemId")}
            </Stack>

            <Stack gap="xs">
              <Label htmlFor="asset-volume-value">Value</Label>
              <Input id="asset-volume-value" name="value" type="number" min={0} step="any" required inputMode="decimal" />
              <Text tone="muted">Must not be lower than the previous reading, nor higher than a later one.</Text>
              {fieldError("value")}
            </Stack>

            <Stack gap="xs">
              <Label htmlFor="asset-volume-read-at">Date and time</Label>
              <Input id="asset-volume-read-at" name="readAt" type="datetime-local" defaultValue={now} max={now} required />
              {fieldError("readAt")}
            </Stack>

            <Stack gap="xs">
              <Label htmlFor="asset-volume-notes">Notes</Label>
              <Textarea id="asset-volume-notes" name="notes" rows={3} maxLength={1000} />
              {fieldError("notes")}
            </Stack>
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Add reading"}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}
