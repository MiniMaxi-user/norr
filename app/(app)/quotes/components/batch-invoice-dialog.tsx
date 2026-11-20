"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Dialog, Stack, Text, useEscapeToClose } from "@yourorg/ui";
import { formatMoneyWeb } from "@/lib/format/web";
import { invoiceQuotes, type InvoiceQuotesResult } from "../invoice-actions";

export interface BatchInvoiceDialogProps {
  quoteIds: string[];
  /** Sum of the selected quotes' totals. */
  totalAmount: number;
  onOpenChange: (open: boolean) => void;
  /** Called once the summary is dismissed (after at least one run). */
  onFinished: () => void;
}

/**
 * "Invoice selected (n)" (issue #237): confirm dialog (count + total), then
 * the summary in the same dialog — invoiced, e-mails queued (link to the
 * Outbox) and per-quote problems — like `GenerateContractQuotesButton`.
 */
export function BatchInvoiceDialog({ quoteIds, totalAmount, onOpenChange, onFinished }: BatchInvoiceDialogProps) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<InvoiceQuotesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (running) return;
    if (!next) {
      if (result) onFinished();
      setResult(null);
      setError(null);
    }
    onOpenChange(next);
  }

  useEscapeToClose(true, handleOpenChange);

  async function handleInvoice() {
    setRunning(true);
    setError(null);
    const response = await invoiceQuotes(quoteIds);
    setRunning(false);
    if (!response.data) {
      setError(response.error ?? "Could not invoice the selected quotes.");
      return;
    }
    setResult(response.data);
    router.refresh();
  }

  const count = quoteIds.length;

  return (
    <Dialog open onOpenChange={handleOpenChange} size="sm">
      <Dialog.Header>
        <Text>Invoice selected quotes</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {!result && (
            <Text>
              This generates an invoice for {count} {count === 1 ? "quote" : "quotes"} with a total of{" "}
              {formatMoneyWeb(totalAmount)}. Each invoice is e-mailed to the client&apos;s invoice contact through the
              e-mail queue. This can take a while; keep this window open.
            </Text>
          )}
          {error && <Text tone="danger">{error}</Text>}
          {result && (
            <Stack gap="sm">
              <Text tone={result.problems.length > 0 ? undefined : "success"}>
                {result.invoiced.length} invoiced
                {result.problems.length > 0 ? `, ${result.problems.length} skipped or failed` : ""}.
              </Text>
              {result.emailsQueued > 0 && (
                <Text>
                  {result.emailsQueued} {result.emailsQueued === 1 ? "e-mail" : "e-mails"} queued — sending can take a
                  few minutes. <Link href="/settings/email-outbox">Open the Outbox</Link>
                </Text>
              )}
              {result.problems.length > 0 && (
                <Stack gap="xs">
                  {result.problems.map((entry) => (
                    <Text key={`${entry.quoteId}-${entry.error}`} tone="danger">
                      {entry.quoteLabel}: {entry.error}
                    </Text>
                  ))}
                </Stack>
              )}
            </Stack>
          )}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        {result ? (
          <Button type="button" variant="primary" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={running}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleInvoice} disabled={running}>
              {running ? "Invoicing…" : `Invoice ${count} ${count === 1 ? "quote" : "quotes"}`}
            </Button>
          </>
        )}
      </Dialog.Footer>
    </Dialog>
  );
}
