"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Stack, Text, toast, useEscapeToClose } from "@yourorg/ui";
import { invoiceQuote, sendInvoiceEmailForQuote, type InvoiceSummary } from "../invoice-actions";
import { formatDateTime } from "@/lib/format/date";

export interface QuoteInvoiceActionsProps {
  quoteId: string;
  /** This quote's invoice (fetched server-side in `page.tsx`); `null` when
   * not invoiced yet. Props are re-derived on every `router.refresh()`, so
   * no local copy is kept. */
  invoice: InvoiceSummary | null;
  /** `can(actor, "invoicing", "create")` (folded with `hasFeature`/
   * `canAccessModule` in `page.tsx`) - gates "Generate invoice". */
  canGenerate: boolean;
}

const POPUP_WIDTH = 900;
const POPUP_HEIGHT = 1000;

/**
 * Cross-browser "center a popup on whichever screen the current browser
 * window is on" math (issue #119: "PDF opent als popup in het midden
 * gecentreerd").
 */
function computePopupFeatures(width: number, height: number): string {
  const availWidth = window.screen.availWidth || width;
  const availHeight = window.screen.availHeight || height;
  const w = Math.min(width, availWidth);
  const h = Math.min(height, availHeight);
  const dualScreenLeft = window.screenLeft ?? window.screenX ?? 0;
  const dualScreenTop = window.screenTop ?? window.screenY ?? 0;
  const outerWidth = window.outerWidth || availWidth;
  const outerHeight = window.outerHeight || availHeight;
  const left = Math.max(0, Math.round(dualScreenLeft + (outerWidth - w) / 2));
  const top = Math.max(0, Math.round(dualScreenTop + (outerHeight - h) / 2));
  return `width=${w},height=${h},left=${left},top=${top}`;
}

/**
 * Generate invoice / Open PDF cluster for the invoice attached to this Quote
 * (issues #119, #211). "Generate invoice" (after a confirm dialog) creates
 * the invoice, flips the quote to Invoiced and e-mails the PDF to the
 * client's invoice contact when one is set; the PDF itself is rendered on
 * demand by `GET /quotes/[id]/invoice` when "Open PDF" is clicked - there is
 * no separate Generate PDF / Regenerate / Delete step any more. Once invoiced,
 * "Send invoice" (not sent yet) / "Resend invoice" (already sent - confirms
 * first, showing when and to whom) e-mails it again on demand.
 *
 * Entirely absent (not just disabled) for a caller with no invoicing access
 * (docs/ARCHITECTURE.md feature-flag rule).
 */
export function QuoteInvoiceActions({ quoteId, invoice, canGenerate }: QuoteInvoiceActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isGenerating, startGenerating] = useTransition();
  const [isSending, startSending] = useTransition();
  const [confirmingResend, setConfirmingResend] = useState(false);

  useEscapeToClose(confirmingResend, (next) => {
    if (!isSending) setConfirmingResend(next);
  });

  useEscapeToClose(confirming, (next) => {
    if (!isGenerating) setConfirming(next);
  });

  if (!canGenerate && !invoice) return null;

  function handleGenerate() {
    startGenerating(async () => {
      const result = await invoiceQuote(quoteId);
      setConfirming(false);
      if (!result.data) {
        const message = result.error ?? "Something went wrong.";
        toast({
          tone: "danger",
          title: "Could not generate invoice",
          description: message,
          duration: 0,
          action: message.toLowerCase().includes("settings")
            ? { label: "Go to Settings", onClick: () => router.push("/settings/company") }
            : undefined,
        });
        return;
      }
      const { invoiceNumber, statusUpdated, email } = result.data;
      const emailLine =
        email.status === "sent"
          ? `Emailed to ${email.to}.`
          : email.status === "skipped"
            ? `Not emailed: ${email.reason}.`
            : `Email failed: ${email.error}`;
      toast({
        tone: email.status === "failed" || !statusUpdated ? "danger" : "success",
        title: `Invoice ${invoiceNumber} generated`,
        description: statusUpdated ? emailLine : `${emailLine} The quote status could not be updated to Invoiced.`,
        ...(email.status === "failed" || !statusUpdated ? { duration: 0 } : {}),
      });
      router.refresh();
    });
  }

  function handleSend() {
    startSending(async () => {
      const result = await sendInvoiceEmailForQuote(quoteId);
      setConfirmingResend(false);
      if (!result.data) {
        toast({ tone: "danger", title: "Could not send invoice", description: result.error ?? "Something went wrong.", duration: 0 });
        return;
      }
      const { email } = result.data;
      if (email.status === "sent") {
        toast({ tone: "success", title: "Invoice sent", description: `Emailed to ${email.to}.` });
      } else {
        toast({
          tone: "danger",
          title: "Invoice not sent",
          description: email.status === "skipped" ? `${email.reason}.` : email.error,
          duration: 0,
        });
      }
      router.refresh();
    });
  }

  function handleOpenPdf() {
    // The PDF is rendered on demand by GET /quotes/[id]/invoice.
    const popup = window.open(`/quotes/${quoteId}/invoice`, "_blank", computePopupFeatures(POPUP_WIDTH, POPUP_HEIGHT));
    if (!popup) {
      toast({
        tone: "danger",
        title: "Popup blocked",
        description: "Allow popups for this site to view the invoice PDF, then try again.",
      });
    }
  }

  return (
    <>
      {invoice ? (
        <>
          {canGenerate && (
            <Button
              type="button"
              variant={invoice.emailedAt ? "outline" : "primary"}
              onClick={invoice.emailedAt ? () => setConfirmingResend(true) : handleSend}
              disabled={isSending}
            >
              {isSending ? "Sending…" : invoice.emailedAt ? "Resend invoice" : "Send invoice"}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={handleOpenPdf}>
            Open PDF
          </Button>
        </>
      ) : (
        canGenerate && (
          <Button type="button" variant="primary" onClick={() => setConfirming(true)}>
            Generate invoice
          </Button>
        )
      )}

      {confirmingResend && invoice?.emailedAt && (
        <Dialog open onOpenChange={(next) => !isSending && setConfirmingResend(next)} size="sm">
          <Dialog.Header>
            <Text>Resend invoice</Text>
          </Dialog.Header>
          <Dialog.Body>
            <Stack gap="sm">
              <Text>
                This invoice was already sent to {invoice.emailedTo ?? "the invoice contact"} on{" "}
                {formatDateTime(invoice.emailedAt)}.
              </Text>
              <Text tone="muted">
                It will be sent again to the client&rsquo;s current invoice contact. To use a different address, change
                the invoice contact on the client&rsquo;s invoice address first.
              </Text>
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            <Button type="button" variant="outline" onClick={() => setConfirmingResend(false)} disabled={isSending}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleSend} disabled={isSending}>
              {isSending ? "Sending…" : "Send again"}
            </Button>
          </Dialog.Footer>
        </Dialog>
      )}

      {confirming && (
        <Dialog open onOpenChange={(next) => !isGenerating && setConfirming(next)} size="sm">
          <Dialog.Header>
            <Text>Generate invoice</Text>
          </Dialog.Header>
          <Dialog.Body>
            <Stack gap="sm">
              <Text>
                This creates the invoice and sets the quote to Invoiced. If the client has an invoice contact, the
                invoice PDF is emailed to them automatically.
              </Text>
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={isGenerating}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? "Generating…" : "Generate invoice"}
            </Button>
          </Dialog.Footer>
        </Dialog>
      )}
    </>
  );
}
