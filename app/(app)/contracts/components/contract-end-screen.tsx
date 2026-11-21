"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import {
  WebBadge,
  WebCard,
  WebCardSection,
  WebCardStack,
  WebDataTable,
  WebField,
  WebHint,
  WebLinkButton,
  SidebarRows,
  type TimelineItem,
  SidebarSection,
  WebDetailLayout,
  WebPage,
  type WebBadgeVariant,
} from "@yourorg/ui/web";
import { LivePanel, PageHeader, WebConfirmDialog, type LivePanelData } from "@yourorg/ui/web-client";
import { formatDateWeb, formatMoneyWeb, formatNumberWeb } from "@/lib/format/web";
import type { QuoteLineDraft } from "@/app/(app)/quotes/contract-balance";
import {
  completeContractEnd,
  getContractEndBalance,
  scheduleContractEnd,
  type ContractEndBalance,
  type ContractEndInput,
} from "../end-actions";

const PREVIEW_DEBOUNCE_MS = 400;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const rowKey = (assetId: string, volumeItemId: string) => `${assetId}|${volumeItemId}`;
const lineAmount = (line: QuoteLineDraft) => Math.round(line.quantity * line.unitPrice * 100) / 100;

const PERIOD_STATUS: Record<"invoiced" | "quoted" | "open", { label: string; variant: WebBadgeVariant }> = {
  invoiced: { label: "Invoiced", variant: "success" },
  quoted: { label: "Quoted, not invoiced", variant: "warning" },
  open: { label: "Open", variant: "info" },
};

export interface ContractEndScreenProps {
  contractId: string;
  contractNumber: string;
  startDate: string;
  clientId: string;
  /** Null when the client could not be loaded. */
  clientName: string | null;
  /** Assets linked directly to the contract (components not counted). */
  linkedAssetCount: number;
  /** Balance computed on the server for `initialEndDate`. */
  /** `null` when the server could not compute it (see `initialError`); the date stays editable to retry. */
  initialBalance: ContractEndBalance | null;
  initialError: string | null;
  initialEndDate: string;
  /** Current end date of the contract (null = open-ended), for the rail. */
  currentEndDate: string | null;
  /** Plain-language explanation of how invoicing works, built on the server. */
  explanation: string;
  canSeeQuotes: boolean;
  /** The contract's timeline (start, line items, assets, quotes), built on the server. */
  timeline: TimelineItem[];
}

/**
 * The End contract page (issue #271): a full page, not a dialog (docs/ARCHITECTURE.md
 * "Popup vs. full page"), in four numbered steps: 1 End date, 2 Closing readings,
 * 3 Balance overview (live preview, recomputed server-side, debounced), 4 Confirm.
 * A future end date only schedules the ending (the contract stays Active). Amounts
 * are never trusted from here: `completeContractEnd` recomputes everything.
 */
export function ContractEndScreen({
  contractId,
  contractNumber,
  startDate,
  clientId,
  clientName,
  linkedAssetCount,
  initialBalance,
  initialError,
  initialEndDate,
  currentEndDate,
  explanation,
  canSeeQuotes,
  timeline,
}: ContractEndScreenProps) {
  const router = useRouter();
  const [endDate, setEndDate] = useState(initialEndDate);
  const [entered, setEntered] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [balance, setBalance] = useState<ContractEndBalance | null>(initialBalance);
  const [refreshing, setRefreshing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(initialError);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const dateError = !ISO_DATE.test(endDate)
    ? "Enter the end date"
    : endDate < startDate
      ? "The end date cannot be before the contract start date"
      : null;

  const input = useMemo<ContractEndInput>(() => {
    const closingReadings: NonNullable<ContractEndInput["closingReadings"]> = [];
    const skippedRows: NonNullable<ContractEndInput["skipped"]> = [];
    for (const row of balance?.readingRows ?? []) {
      const key = rowKey(row.assetId, row.volumeItemId);
      if (skipped[key]) {
        skippedRows.push({ assetId: row.assetId, volumeItemId: row.volumeItemId });
        continue;
      }
      const text = (entered[key] ?? "").trim().replace(",", ".");
      if (text !== "" && Number.isFinite(Number(text))) {
        closingReadings.push({ assetId: row.assetId, volumeItemId: row.volumeItemId, value: Number(text) });
      }
    }
    return { endDate, closingReadings, skipped: skippedRows };
  }, [endDate, entered, skipped, balance]);

  // Debounced live preview. The first run (server-rendered balance) is skipped.
  const firstRun = useRef(true);
  const requestId = useRef(0);
  const inputKey = JSON.stringify(input);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (dateError) return;
    const id = ++requestId.current;
    setRefreshing(true);
    const timer = setTimeout(() => {
      void getContractEndBalance(contractId, input).then((result) => {
        if (id !== requestId.current) return;
        setRefreshing(false);
        if (!result.data) {
          setPreviewError(result.error ?? "Could not calculate the balance.");
          return;
        }
        setPreviewError(null);
        setBalance(result.data);
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `input` is covered by its serialized key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, contractId, dateError]);

  const isSchedule = balance?.mode === "schedule";
  const canComplete =
    balance !== null && !isSchedule && !dateError && !refreshing && !previewError && balance.missingReadings === 0;

  const handleSchedule = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    const result = await scheduleContractEnd(contractId, endDate);
    setSubmitting(false);
    if (!result.data) {
      setSubmitError(result.error ?? "Could not schedule the ending.");
      return;
    }
    toast({ title: "Ending scheduled", description: `Ends on ${formatDateWeb(endDate)}`, tone: "success", duration: 3000 });
    router.push(`/contracts/${contractId}`);
    router.refresh();
  }, [contractId, endDate, router]);

  async function handleComplete() {
    setSubmitting(true);
    setSubmitError(null);
    const result = await completeContractEnd(contractId, input);
    setSubmitting(false);
    if (!result.data) {
      setSubmitError(result.error ?? "Could not complete the final balance.");
      return;
    }
    setConfirmOpen(false);
    toast({
      title: "Contract ended",
      description: result.data.quoteId ? "The final settlement quote was created." : "Nothing was left to invoice.",
      tone: "success",
      duration: 4000,
    });
    router.push(`/contracts/${contractId}`);
    router.refresh();
  }

  const header = (
    <PageHeader
      breadcrumb={[
        { label: "Contracts", href: "/contracts" },
        { label: contractNumber, href: `/contracts/${contractId}`, mono: true },
        { label: "End contract" },
      ]}
      title="End contract"
      mode="read"
      actions={{
        canEdit: false,
        onEdit: () => {},
        onSave: () => {},
        onCancel: () => {},
        primary: null,
        secondary: <WebLinkButton href={`/contracts/${contractId}`}>Cancel</WebLinkButton>,
      }}
    />
  );

  const rows = balance?.readingRows ?? [];
  const missingReadings = balance?.missingReadings ?? 0;

  // The action that must happen NOW lives in the rail's LivePanel, not the header.
  const livePanel = useMemo<LivePanelData | null>(() => {
    if (balance === null || dateError) return null;
    if (isSchedule) {
      return {
        variant: "info",
        title: "SCHEDULE ENDING",
        value: `Ends on ${formatDateWeb(endDate)}`,
        context: "The contract stays Active until then; you can cancel the ending until that date.",
        actions: [{ label: "Schedule ending", loading: submitting, onClick: () => void handleSchedule() }],
      };
    }
    const context = refreshing
      ? "Updating the balance…"
      : previewError
        ? "The balance could not be calculated"
        : missingReadings > 0
          ? `${missingReadings} ${missingReadings === 1 ? "reading" : "readings"} missing`
          : "Ready to complete (excl. VAT)";
    return {
      variant: canComplete ? "urgent" : "attention",
      title: "FINAL BALANCE",
      value: formatMoneyWeb(balance.totals.net),
      context,
      actions: [{ label: "Complete final balance", disabled: !canComplete, onClick: () => setConfirmOpen(true) }],
    };
  }, [balance, dateError, isSchedule, endDate, submitting, refreshing, previewError, missingReadings, canComplete, handleSchedule]);

  return (
    <WebPage>
      <WebDetailLayout
        header={header}
        rail={
          <>
            <LivePanel panel={livePanel} />
            <SidebarSection title="Contract">
              <SidebarRows
                rows={[
                  {
                    label: "Client",
                    value: clientName ? <Link href={`/clients/${clientId}`}>{clientName}</Link> : "—",
                  },
                  {
                    label: "Linked assets",
                    value: (
                      <Link href={`/contracts/${contractId}?tab=assets`}>
                        {linkedAssetCount} {linkedAssetCount === 1 ? "asset" : "assets"}
                      </Link>
                    ),
                  },
                  { label: "Start date", value: formatDateWeb(startDate) },
                  { label: "Current end date", value: currentEndDate ? formatDateWeb(currentEndDate) : "Open-ended" },
                ]}
              />
            </SidebarSection>
          </>
        }
        timeline={{ items: timeline, emptyText: "Nothing on this contract yet." }}
      >
        <WebCardStack>
          <WebCard title="1. End date">
            <WebCardSection>
              <p className="web-dialog-text">
                The day the contract stops. Today or earlier completes the final balance now; a later date keeps the
                contract Active until then.
              </p>
            </WebCardSection>
            <WebField label="End date" htmlFor="contract-end-date" required error={dateError} messageId="contract-end-date-error">
              <input
                id="contract-end-date"
                type="date"
                className="web-input"
                value={endDate}
                min={startDate}
                aria-describedby={dateError ? "contract-end-date-error" : undefined}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </WebField>
            <WebCardSection>
              <WebHint>{explanation}</WebHint>
              {previewError || submitError ? (
                <p className="web-hint-warning" role="alert">
                  {previewError ?? submitError}
                </p>
              ) : null}
              {isSchedule && !dateError ? (
                <div className="web-dialog-summary" data-tone="info" role="status">
                  <span className="web-dialog-summary-title">Scheduled ending</span>
                  This date is in the future, so <strong>{contractNumber}</strong> stays Active and shows &quot;Ends on{" "}
                  {formatDateWeb(endDate)}&quot;. Reopen this page after that date to complete the final balance. You
                  can cancel the ending until then.
                </div>
              ) : null}
            </WebCardSection>
          </WebCard>

          {isSchedule || balance === null ? null : (
            <>
              <WebCard
                title="2. Closing readings"
                meta={
                  rows.length > 0
                    ? `${rows.length - missingReadings} / ${rows.length} ready`
                    : undefined
                }
              >
                <WebCardSection>
                  <p className="web-dialog-text">
                    Needed to settle counter usage up to the end date. Readings entered here are saved as normal counter
                    readings when you complete the balance.
                  </p>
                  {rows.length > 0 ? (
                    <WebHint>
                      <strong>Settle without reading</strong>: use this when a counter cannot be read (meter broken,
                      asset already removed). That asset is left out of the counter settlement for that counter: its
                      usage since the last settled reading is not billed, and no under-use is credited for that counter.
                      The final balance shows a warning so it stays traceable.
                    </WebHint>
                  ) : null}
                  {rows.length === 0 ? (
                    <p className="web-dialog-text">This contract has no counters on covered assets, so no readings are needed.</p>
                  ) : null}
                </WebCardSection>
                {rows.length === 0 ? null : (
                  <WebDataTable aria-busy={refreshing}>
                    <thead>
                      <tr>
                        <th scope="col">Asset</th>
                        <th scope="col">Serial number</th>
                        <th scope="col">Counter</th>
                        <th scope="col" data-numeric="true">
                          Last reading
                        </th>
                        <th scope="col">Reading on {formatDateWeb(endDate)}</th>
                        <th scope="col">
                          <span className="web-sr-only">Settle without reading</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const key = rowKey(row.assetId, row.volumeItemId);
                        const inputId = `closing-${row.assetId}-${row.volumeItemId}`;
                        const isSkipped = Boolean(skipped[key]);
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
                                  id={inputId}
                                  className="web-input"
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  inputMode="decimal"
                                  data-numeric="true"
                                  aria-label={`Closing reading ${row.assetName}, ${row.counterLabel}`}
                                  disabled={isSkipped}
                                  value={entered[key] ?? ""}
                                  onChange={(event) => setEntered((current) => ({ ...current, [key]: event.target.value }))}
                                />
                              )}
                            </td>
                            <td>
                              {row.closingReading ? null : (
                                <span className="web-field-checkbox">
                                  <input
                                    type="checkbox"
                                    aria-labelledby={`${inputId}-skip`}
                                    checked={isSkipped}
                                    onChange={(event) => setSkipped((current) => ({ ...current, [key]: event.target.checked }))}
                                  />
                                  <span id={`${inputId}-skip`}>Settle without reading</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </WebDataTable>
                )}
                {balance.missingReadings > 0 ? (
                  <WebCardSection>
                    <p className="web-hint-warning" role="status">
                      {balance.missingReadings} {balance.missingReadings === 1 ? "reading is" : "readings are"} still
                      missing. Enter it or choose Settle without reading; that asset is then excluded from settlement.
                    </p>
                  </WebCardSection>
                ) : null}
              </WebCard>

              <BalanceOverview balance={balance} refreshing={refreshing} canSeeQuotes={canSeeQuotes} />

              <WebCard title="4. Confirm">
                <WebCardSection>
                  <p className="web-dialog-text">
                    Creates one draft Final settlement quote for review and invoicing, saves the closing readings and
                    ends the contract on {formatDateWeb(endDate)}. This cannot be undone. When everything above is
                    right, use the button in the live panel on the right.
                  </p>
                  {balance.missingReadings > 0 ? (
                    <WebHint>Complete step 2 first: every row needs a reading or Settle without reading.</WebHint>
                  ) : null}
                </WebCardSection>
              </WebCard>
            </>
          )}
        </WebCardStack>
      </WebDetailLayout>

      <WebConfirmDialog
        open={confirmOpen}
        title="Complete final balance?"
        confirmLabel="Complete final balance"
        pending={submitting}
        error={submitError}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleComplete()}
      >
        {contractNumber} ends on {formatDateWeb(endDate)}.
        {balance
          ? ` Total to invoice ${formatMoneyWeb(balance.totals.toInvoice)}, to credit ${formatMoneyWeb(balance.totals.toCredit)}, net ${formatMoneyWeb(balance.totals.net)} excl. VAT.`
          : ""}
      </WebConfirmDialog>
    </WebPage>
  );
}

function BalanceOverview({
  balance,
  refreshing,
  canSeeQuotes,
}: {
  balance: ContractEndBalance;
  refreshing: boolean;
  canSeeQuotes: boolean;
}) {
  return (
    <WebCard title="3. Balance overview" meta={refreshing ? "Updating…" : undefined} aria-busy={refreshing}>
      <WebCardSection>
        <p className="web-dialog-text">
          What will be invoiced, credited and settled up to the end date. Read-only; it updates as you change the date
          or the readings.
        </p>
        <p className="web-dialog-section">Billing periods</p>
        {balance.periods.length === 0 ? <p className="web-dialog-text">No billing periods up to the end date.</p> : null}
      </WebCardSection>
      {balance.periods.length === 0 ? null : (
        <WebDataTable>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Status</th>
              <th scope="col">Quote / invoice</th>
              <th scope="col" data-numeric="true">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {balance.periods.map((period) => {
              const status = PERIOD_STATUS[period.status];
              return (
                <tr key={period.index}>
                  <td>
                    {formatDateWeb(period.period.start)} – {formatDateWeb(period.period.end)}
                    {period.proRata ? ` (pro rata, ${Math.round(period.factor * 1000) / 10}%)` : ""}
                  </td>
                  <td>
                    <WebBadge variant={status.variant}>{status.label}</WebBadge>
                  </td>
                  <td data-id="true">
                    {period.quoteId && canSeeQuotes ? (
                      <Link href={`/quotes/${period.quoteId}`}>{period.invoiceNumber ?? period.quoteNumber ?? "Quote"}</Link>
                    ) : (
                      (period.invoiceNumber ?? period.quoteNumber ?? "—")
                    )}
                  </td>
                  <td data-numeric="true">{period.amount === null ? "—" : formatMoneyWeb(period.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </WebDataTable>
      )}
      {balance.quotesToReplace.length > 0 ? (
        <WebCardSection>
          <WebHint>
            Replaced by the final quote (not invoiced yet):{" "}
            {balance.quotesToReplace.map((quote) => quote.quoteNumber ?? quote.name).join(", ")}.
          </WebHint>
        </WebCardSection>
      ) : null}

      {balance.creditLines.length > 0 ? (
        <>
          <WebCardSection>
            <p className="web-dialog-section">Credit for prepaid time after the end date</p>
          </WebCardSection>
          <LinesTable lines={balance.creditLines} />
        </>
      ) : null}

      {balance.counterWindows.length > 0 ? (
        <>
          <WebCardSection>
            <p className="web-dialog-section">Counter settlement</p>
            <WebHint>
              Usage above the included volume is billed at the line&apos;s overage price. Usage below it (under-use) is
              only credited, at the line&apos;s sales price, when <strong>Credit under-use</strong> is on for that contract
              line. When it is off, the line is a minimum contract: the included volume stays paid, whatever was used.
              Under-use is never credited while readings are incomplete.
            </WebHint>
          </WebCardSection>
          {balance.counterWindows.map((entry) => (
            <div key={`${entry.window.start}-${entry.window.end}`}>
              <WebCardSection>
                <p className="web-dialog-text">
                  <strong>{entry.label}</strong>
                </p>
              </WebCardSection>
              <WebDataTable>
                <thead>
                  <tr>
                    <th scope="col">Counter</th>
                    <th scope="col" data-numeric="true">
                      Included (pro rata)
                    </th>
                    <th scope="col" data-numeric="true">
                      Used
                    </th>
                    <th scope="col" data-numeric="true">
                      Overage
                    </th>
                    <th scope="col" data-numeric="true">
                      Under-use
                    </th>
                    <th scope="col">Credit under-use</th>
                    <th scope="col" data-numeric="true">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entry.counters.map((counter) => (
                    <tr key={counter.lineId}>
                      <td>{counter.counterLabel}</td>
                      <td data-numeric="true">{formatNumberWeb(counter.included)}</td>
                      <td data-numeric="true">{formatNumberWeb(counter.usage)}</td>
                      <td data-numeric="true">{formatNumberWeb(counter.overage)}</td>
                      <td data-numeric="true">
                        {formatNumberWeb(counter.underUse)}
                      </td>
                      <td>
                        {!counter.creditUnderUse ? (
                          <WebBadge variant="neutral">Off · minimum contract</WebBadge>
                        ) : counter.underUseCreditAmount > 0 ? (
                          <WebBadge variant="success">Credited {formatMoneyWeb(-counter.underUseCreditAmount)}</WebBadge>
                        ) : counter.underUse > 0 ? (
                          <WebBadge variant="warning">On · not credited (incomplete readings)</WebBadge>
                        ) : (
                          <WebBadge variant="neutral">On · nothing to credit</WebBadge>
                        )}
                      </td>
                      <td data-numeric="true">
                        {formatMoneyWeb(Math.round((counter.overageAmount - counter.underUseCreditAmount) * 100) / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </WebDataTable>
            </div>
          ))}
        </>
      ) : null}

      {balance.warnings.length > 0 ? (
        <WebCardSection>
          <ul className="web-hint-warning" role="status">
            {balance.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </WebCardSection>
      ) : null}

      <WebCardSection>
        <p className="web-dialog-section">Totals (excl. VAT)</p>
      </WebCardSection>
      <WebDataTable>
        <tbody>
          <tr>
            <td>To invoice</td>
            <td data-numeric="true">{formatMoneyWeb(balance.totals.toInvoice)}</td>
          </tr>
          <tr>
            <td>To credit</td>
            <td data-numeric="true">{formatMoneyWeb(-balance.totals.toCredit)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td>Final settlement quote</td>
            <td data-numeric="true">{formatMoneyWeb(balance.totals.net)}</td>
          </tr>
        </tfoot>
      </WebDataTable>
    </WebCard>
  );
}

function LinesTable({ lines }: { lines: QuoteLineDraft[] }) {
  return (
    <WebDataTable>
      <thead>
        <tr>
          <th scope="col">Description</th>
          <th scope="col" data-numeric="true">
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={`${line.sortOrder}-${index}`}>
            <td>{line.description}</td>
            <td data-numeric="true">{formatMoneyWeb(lineAmount(line))}</td>
          </tr>
        ))}
      </tbody>
    </WebDataTable>
  );
}
