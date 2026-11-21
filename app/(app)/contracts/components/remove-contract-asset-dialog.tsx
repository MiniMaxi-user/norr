"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "@yourorg/ui";
import { WebBadge, WebDataTable, WebField, WebHint } from "@yourorg/ui/web";
import { WebConfirmDialog } from "@yourorg/ui/web-client";
import { formatDateWeb, formatNumberWeb } from "@/lib/format/web";
import { getContractAssetRemoval, removeContractAsset, type ContractAssetRemovalInfo } from "../actions";

const rowKey = (assetId: string, volumeItemId: string) => `${assetId}|${volumeItemId}`;

export interface RemoveContractAssetDialogProps {
  contractId: string;
  /** Shown in the title; falls back to the number the server returns. */
  contractNumber?: string;
  assetId: string;
  assetName: string;
  onClose: () => void;
  /** Called after the asset was removed (the caller refreshes the page). */
  onRemoved: () => void;
}

/**
 * "Remove asset from contract" (issue #274), one dialog for both contract states, decided by the server:
 *  - Draft contract: a plain confirm, the link is deleted.
 *  - Active contract: the removal date (default today, bounded by the asset's coverage start, the last settled
 *    counter window and today) and, when the contract has counter lines, the closing readings on that date in the
 *    same short style as the End contract page (asset, serial number, counter, last reading, reading input).
 *    The asset stays on the contract as history ("Removed on <date>").
 * A small, secondary action reached from a tab, so a dialog (docs/ARCHITECTURE.md "Popup vs. full page").
 */
export function RemoveContractAssetDialog({
  contractId,
  contractNumber,
  assetId,
  assetName,
  onClose,
  onRemoved,
}: RemoveContractAssetDialogProps) {
  const [info, setInfo] = useState<ContractAssetRemovalInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [entered, setEntered] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requestId = useRef(0);

  function load(removedOn?: string) {
    const id = ++requestId.current;
    setRefreshing(true);
    void getContractAssetRemoval(contractId, assetId, removedOn).then((result) => {
      if (id !== requestId.current) return;
      setRefreshing(false);
      if (!result.data) {
        setLoadError(result.error ?? "Could not load the removal details.");
        return;
      }
      setLoadError(null);
      setInfo(result.data);
      if (removedOn === undefined) setDate(result.data.defaultDate);
    });
  }

  useEffect(() => {
    load();
    // Loads once per open dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeDate(next: string) {
    setDate(next);
    setSubmitError(null);
    if (/^\d{4}-\d{2}-\d{2}$/.test(next)) load(next);
  }

  const isActive = info?.status === "active";
  const rows = info?.readingRows ?? [];

  async function handleConfirm() {
    if (!info) return;
    setSubmitError(null);
    const readings: { assetId: string; volumeItemId: string; value: number }[] = [];
    if (isActive) {
      if (info.dateError) {
        setSubmitError(info.dateError);
        return;
      }
      let missing = 0;
      for (const row of rows) {
        if (row.closingReading) continue;
        const text = (entered[rowKey(row.assetId, row.volumeItemId)] ?? "").trim().replace(",", ".");
        if (text === "" || !Number.isFinite(Number(text)) || Number(text) < 0) {
          missing += 1;
          continue;
        }
        readings.push({ assetId: row.assetId, volumeItemId: row.volumeItemId, value: Number(text) });
      }
      if (missing > 0) {
        setSubmitError(
          `Enter a closing reading for every counter (${missing} ${missing === 1 ? "reading" : "readings"} missing).`,
        );
        return;
      }
    }
    setSubmitting(true);
    const result = await removeContractAsset(
      contractId,
      assetId,
      isActive ? { removedOn: date, readings } : {},
    );
    setSubmitting(false);
    if (!result.data) {
      setSubmitError(result.error ?? "Could not remove this asset from the contract.");
      return;
    }
    toast({
      title: result.data.mode === "removed" ? "Asset removed from the contract" : "Asset unlinked",
      description:
        result.data.mode === "removed" && result.data.removedOn
          ? `Covered until ${formatDateWeb(result.data.removedOn)}`
          : undefined,
      duration: 3000,
    });
    onClose();
    onRemoved();
  }

  const number = contractNumber ?? info?.contractNumber ?? "this contract";

  return (
    <WebConfirmDialog
      open
      size="lg"
      title={isActive ? "Remove asset from contract" : "Unlink asset"}
      confirmLabel={isActive ? "Remove asset" : "Unlink asset"}
      confirmVariant="danger"
      pending={submitting || refreshing}
      error={loadError ?? submitError}
      onCancel={onClose}
      onConfirm={() => void handleConfirm()}
    >
      {info === null ? (
        <WebHint>{loadError ? "" : "Loading…"}</WebHint>
      ) : !isActive ? (
        <p>
          Unlink <strong>{assetName}</strong> from contract <strong>{number}</strong>? The contract is still a draft,
          so nothing is kept as history.
        </p>
      ) : (
        <div className="web-dialog-form">
          <p>
            Remove <strong>{assetName}</strong> (and its components) from contract <strong>{number}</strong>. The asset
            stays on the contract as history; work orders after the removal date are no longer covered.
          </p>
          <WebField
            label="Removal date (last covered day)"
            htmlFor="remove-asset-date"
            required
            error={info.dateError}
            messageId="remove-asset-date-error"
          >
            <input
              id="remove-asset-date"
              type="date"
              className="web-input"
              value={date}
              min={info.minDate}
              max={info.maxDate}
              aria-describedby={info.dateError ? "remove-asset-date-error" : undefined}
              onChange={(event) => changeDate(event.target.value)}
            />
          </WebField>
          {info.lastSettledEnd ? (
            <WebHint>Counter usage is settled up to {formatDateWeb(info.lastSettledEnd)}.</WebHint>
          ) : null}

          {info.hasCounterLines && rows.length > 0 ? (
            <>
              <p className="web-dialog-section">Closing readings</p>
              <WebHint>
                Reading on <strong>{formatDateWeb(date)}</strong> per counter, saved as a normal reading.
              </WebHint>
              <WebDataTable aria-busy={refreshing}>
                <thead>
                  <tr>
                    <th scope="col">Asset</th>
                    <th scope="col">Serial number</th>
                    <th scope="col">Counter</th>
                    <th scope="col" data-numeric="true">
                      Last reading
                    </th>
                    <th scope="col">Reading on {formatDateWeb(date)}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const key = rowKey(row.assetId, row.volumeItemId);
                    return (
                      <tr key={key}>
                        <td data-primary="true">
                          <Link href={`/assets/${row.assetId}?tab=volumes`}>{row.assetName}</Link>
                        </td>
                        <td data-id="true">{row.serialNumber ?? "—"}</td>
                        <td>{row.counterLabel}</td>
                        <td data-numeric="true">
                          {row.lastReading
                            ? `${formatNumberWeb(row.lastReading.value)} (${formatDateWeb(row.lastReading.readAt.slice(0, 10))})`
                            : "None"}
                        </td>
                        <td>
                          {row.closingReading ? (
                            <>
                              {formatNumberWeb(row.closingReading.value)}{" "}
                              <WebBadge variant="success">Already recorded</WebBadge>
                            </>
                          ) : (
                            <input
                              className="web-input"
                              type="number"
                              step="0.001"
                              min="0"
                              inputMode="decimal"
                              data-numeric="true"
                              aria-label={`Closing reading ${row.assetName}, ${row.counterLabel}`}
                              value={entered[key] ?? ""}
                              onChange={(event) => setEntered((current) => ({ ...current, [key]: event.target.value }))}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </WebDataTable>
            </>
          ) : (
            <WebHint>No counters on this asset: no readings needed.</WebHint>
          )}
        </div>
      )}
    </WebConfirmDialog>
  );
}
