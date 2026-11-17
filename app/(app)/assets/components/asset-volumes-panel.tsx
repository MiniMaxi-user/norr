"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  ConfirmDeleteDialog,
  Dialog,
  EmptyState,
  Heading,
  Inline,
  Input,
  Label,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
} from "@yourorg/ui";
import {
  createAssetVolumeReading,
  deleteAssetVolumeReading,
  type AssetVolumeCounter,
  type AssetVolumeReading,
  type AssetVolumesData,
} from "@/lib/asset-volumes/actions";
import { formatDateTime } from "@/lib/format/date";
import { formatNumber } from "@/lib/format/number";

export interface AssetVolumesPanelProps {
  volumes: AssetVolumesData;
}

/** `YYYY-MM-DDTHH:mm` in the browser's local zone, as `datetime-local` expects. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDelta(delta: number): string {
  const text = formatNumber(Math.abs(delta));
  return delta > 0 ? `+${text}` : delta < 0 ? `-${text}` : text;
}

/**
 * "Volumes" tab on the asset page (issue #221): one card per counter
 * configured on the asset's model (latest value + immutable reading history),
 * plus counters that still have history but are no longer on the model.
 */
export function AssetVolumesPanel({ volumes }: AssetVolumesPanelProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AssetVolumeReading | null>(null);
  const router = useRouter();

  const configured = volumes.counters.filter((counter) => !counter.notConfigured);

  const settingsHint = (
    <Text tone="muted">
      Counters are configured per asset model in <Link href="/settings/asset-models">Settings, Asset Models</Link>.
    </Text>
  );

  if (!volumes.modelId || volumes.counters.length === 0) {
    return (
      <EmptyState
        heading={volumes.modelId ? "No counters on this model" : "No model on this asset"}
        text={
          volumes.modelId
            ? "Add one or more counters to this asset's model to start recording volume readings."
            : "Link this asset to a model first. Counters are configured per asset model."
        }
        action={settingsHint}
      />
    );
  }

  return (
    <Stack gap="lg">
      <Inline justify="between" align="center" wrap>
        {settingsHint}
        {volumes.canCreate && configured.length > 0 && (
          <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
            Add reading
          </Button>
        )}
      </Inline>

      {volumes.counters.map((counter) => (
        <CounterCard key={counter.volumeItemId} counter={counter} onDelete={setDeleteTarget} />
      ))}

      {volumes.canCreate && addOpen && (
        <AddReadingDialog onClose={() => setAddOpen(false)} assetId={volumes.assetId} counters={configured} />
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
    </Stack>
  );
}

function CounterCard({
  counter,
  onDelete,
}: {
  counter: AssetVolumeCounter;
  onDelete: (reading: AssetVolumeReading) => void;
}) {
  const unit = counter.unitLabel ? ` ${counter.unitLabel}` : "";
  return (
    <Card>
      <Stack gap="md">
        <Inline justify="between" align="center" wrap>
          <Inline gap="sm" align="center">
            <Heading level={5}>{counter.label}</Heading>
            {counter.notConfigured && <Badge variant="muted">No longer on model</Badge>}
            {!counter.isActive && <Badge variant="warning">Retired</Badge>}
          </Inline>
          <Text tone="muted">
            {counter.latest
              ? `Latest: ${formatNumber(counter.latest.value)}${unit} · ${formatDateTime(counter.latest.readAt)}`
              : "No readings yet"}
          </Text>
        </Inline>
        {counter.description && <Text tone="muted">{counter.description}</Text>}

        {counter.readings.length === 0 ? (
          <Text tone="muted">No readings recorded for this counter.</Text>
        ) : (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell>Date/time</Table.HeaderCell>
                <Table.HeaderCell align="end">Value</Table.HeaderCell>
                <Table.HeaderCell align="end">Change</Table.HeaderCell>
                <Table.HeaderCell>Work order</Table.HeaderCell>
                <Table.HeaderCell>Recorded by</Table.HeaderCell>
                <Table.HeaderCell>Notes</Table.HeaderCell>
                <Table.HeaderCell align="center">Actions</Table.HeaderCell>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {counter.readings.map((reading, index) => {
                const previous = counter.readings[index + 1];
                return (
                  <Table.Row key={reading.id}>
                    <Table.Cell>
                      <Text>{formatDateTime(reading.readAt)}</Text>
                    </Table.Cell>
                    <Table.Cell align="end">
                      <Text>
                        {formatNumber(reading.value)}
                        {unit}
                      </Text>
                    </Table.Cell>
                    <Table.Cell align="end">
                      <Text tone="muted">{previous ? formatDelta(reading.value - previous.value) : "—"}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      {reading.workOrderId ? (
                        <Link href={`/work-orders/${reading.workOrderId}`}>{reading.workOrderLabel ?? "Work order"}</Link>
                      ) : (
                        <Text tone="muted">—</Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Text tone="muted">{reading.createdByName ?? "—"}</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text tone="muted">{reading.notes ?? "—"}</Text>
                    </Table.Cell>
                    <Table.Cell align="center">
                      {reading.canDelete ? (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => onDelete(reading)}
                          aria-label={`Delete reading of ${formatNumber(reading.value)} on ${formatDateTime(reading.readAt)}`}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        )}
      </Stack>
    </Card>
  );
}

/** Mounted only while open (parent conditionally renders it), so the
 * "now" default and the error state are fresh on every open. */
function AddReadingDialog({
  onClose,
  assetId,
  counters,
}: {
  onClose: () => void;
  assetId: string;
  counters: AssetVolumeCounter[];
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
              <Select id="asset-volume-counter" name="volumeItemId" required defaultValue={counters[0]?.volumeItemId}>
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
