"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, toast, useEscapeToClose } from "@yourorg/ui";
import { WebBadge, WebButton, WebCard, WebDataTableEmpty, WebField, WebInput } from "@yourorg/ui/web";
import { WebDataTableCard, type WebColumn } from "@yourorg/ui/web-client";
import { formatDateTimeWeb } from "@/lib/format/web";
import {
  getWorkReceiptRecipientOptions,
  sendWorkReceipt,
  type WorkReceiptRecord,
} from "../work-receipt-actions";

export interface WorkOrderReceiptsData {
  receipts: WorkReceiptRecord[];
  canGenerate: boolean;
  canSend: boolean;
  isApproved: boolean;
}

export interface WorkOrderReceiptsPanelProps {
  data: WorkOrderReceiptsData;
  workOrderId: string;
}

// Same shape check the settings forms use for a typical address.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Work receipts tab (issue #226): every generated version of the work receipt
 * (werkbon) for this work order, newest first, each with "Open" (the PDF in a
 * new tab) and "Send…" (one-recipient dialog). Generating is the header's
 * primary action in `WorkOrderScreen`; before the work order is approved the
 * tab only explains when a receipt becomes available.
 */
export function WorkOrderReceiptsPanel({ data, workOrderId }: WorkOrderReceiptsPanelProps) {
  const [sending, setSending] = useState<WorkReceiptRecord | null>(null);

  const columns = useMemo<WebColumn<WorkReceiptRecord>[]>(
    () => [
      { id: "number", header: "Receipt", sortValue: (row) => row.version, render: (row) => row.receiptNumber },
      {
        id: "generated",
        header: "Generated",
        sortValue: (row) => row.generatedAt,
        render: (row) => `${formatDateTimeWeb(row.generatedAt)}${row.generatedByName ? ` · ${row.generatedByName}` : ""}`,
      },
      {
        id: "sent",
        header: "Sent",
        render: (row) => {
          if (row.emailError) {
            return (
              <>
                <WebBadge variant="danger">Failed</WebBadge> {row.emailError}
              </>
            );
          }
          if (!row.emailedAt) return "Not sent";
          return `${row.emailedTo ?? ""} · ${formatDateTimeWeb(row.emailedAt)}${row.emailedByName ? ` · ${row.emailedByName}` : ""}`;
        },
      },
      {
        id: "actions",
        header: "",
        align: "end",
        render: (row) => (
          <>
            {row.pdfUrl ? (
              <a href={row.pdfUrl} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
                <WebButton size="sm">Open</WebButton>
              </a>
            ) : null}
            {data.canSend ? (
              <WebButton size="sm" onClick={() => setSending(row)}>
                Send…
              </WebButton>
            ) : null}
          </>
        ),
      },
    ],
    [data.canSend],
  );

  const segment = useMemo(
    () => ({
      label: "Show receipts",
      defaultValue: "all",
      options: [
        { value: "sent", label: "Sent", match: (row: WorkReceiptRecord) => Boolean(row.emailedAt) && !row.emailError },
        { value: "unsent", label: "Not sent", match: (row: WorkReceiptRecord) => !row.emailedAt || Boolean(row.emailError) },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  if (!data.isApproved && data.receipts.length === 0) {
    return (
      <WebCard title="Work receipts" meta="0">
        <WebDataTableEmpty>
          A work receipt can be generated once the work order is approved (completed). It is a PDF of the work done with
          the client&apos;s signature.
        </WebDataTableEmpty>
      </WebCard>
    );
  }

  return (
    <div className="web-tab-stack">
      <WebDataTableCard
        title="Work receipts"
        meta={String(data.receipts.length)}
        rows={data.receipts}
        getRowKey={(row) => row.id}
        columns={columns}
        searchText={(row) => `${row.receiptNumber} ${row.emailedTo ?? ""}`}
        noun="receipts"
        dropdowns={[]}
        segment={segment}
        urlPrefix="receipts"
        defaultSort={{ columnId: "number", direction: "desc" }}
        rowLabel={(row) => `Work receipt ${row.receiptNumber}`}
      />
      {sending ? <SendWorkReceiptDialog receipt={sending} workOrderId={workOrderId} onClose={() => setSending(null)} /> : null}
    </div>
  );
}

function SendWorkReceiptDialog({
  receipt,
  workOrderId,
  onClose,
}: {
  receipt: WorkReceiptRecord;
  workOrderId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [options, setOptions] = useState<{ email: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSend] = useTransition();

  useEscapeToClose(true, (next) => {
    if (!next && !pending) onClose();
  });

  useEffect(() => {
    let cancelled = false;
    void getWorkReceiptRecipientOptions(workOrderId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.data) return;
      const { suggested, options: fetched } = result.data;
      setOptions(fetched);
      if (suggested) setTo((current) => current || suggested);
    });
    return () => {
      cancelled = true;
    };
  }, [workOrderId]);

  const address = to.trim();
  const invalid = touched && !EMAIL_PATTERN.test(address) ? "Enter a valid email address, like name@company.com" : null;

  function submit() {
    setTouched(true);
    if (!EMAIL_PATTERN.test(address)) return;
    setError(null);
    startSend(async () => {
      const result = await sendWorkReceipt(receipt.id, address);
      if (!result.data) {
        setError(result.error ?? "Could not send the work receipt.");
        return;
      }
      if (result.data.status === "failed") {
        setError(result.data.error ?? "The email could not be sent.");
        router.refresh();
        return;
      }
      toast({ title: "Work receipt sent", description: `${receipt.receiptNumber} to ${result.data.to}`, tone: "success", duration: 4000 });
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(next) => (!next && !pending ? onClose() : undefined)} size="sm">
      <Dialog.Header>
        <h2 className="web-dialog-title">Send work receipt {receipt.receiptNumber}</h2>
      </Dialog.Header>
      <Dialog.Body>
        <div className="web-dialog-form">
          {error ? (
            <p className="web-dialog-error" role="alert">
              <span className="web-error-mark" aria-hidden="true">
                !
              </span>
              {error}
            </p>
          ) : null}
          <WebField label="Send to" htmlFor="work-receipt-to" required error={invalid} messageId="work-receipt-to-error">
            <WebInput
              id="work-receipt-to"
              type="email"
              autoComplete="off"
              autoFocus
              value={to}
              placeholder={loading ? "Loading suggestions…" : "name@company.com"}
              aria-describedby={invalid ? "work-receipt-to-error" : undefined}
              onChange={(event) => setTo(event.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </WebField>
          {options.length > 0 ? (
            <div role="group" aria-label="Known contacts">
              {options.map((option) => (
                <WebButton key={option.email} size="sm" onClick={() => setTo(option.email)}>
                  {option.label}
                </WebButton>
              ))}
            </div>
          ) : null}
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <WebButton onClick={onClose} disabled={pending}>
          Cancel
        </WebButton>
        <WebButton variant="primary" loading={pending} onClick={submit}>
          {address ? `Send to ${address}` : "Send"}
        </WebButton>
      </Dialog.Footer>
    </Dialog>
  );
}
