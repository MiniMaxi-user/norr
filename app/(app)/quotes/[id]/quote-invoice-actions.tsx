"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Stack, Text, toast, useEscapeToClose } from "@yourorg/ui";
import { invoiceQuote, type InvoiceSummary } from "../invoice-actions";

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
 * no separate Generate PDF / Regenerate / Delete step any more.
 *
 * Entirely absent (not just disabled) for a caller with no invoicing access
 * (docs/ARCHITECTURE.md feature-flag rule).
 */
export function QuoteInvoiceActions({ quoteId, invoice, canGenerate }: QuoteInvoiceActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isGenerating, startGenerating] = useTransition();

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
        <Button type="button" variant="outline" onClick={handleOpenPdf}>
          Open PDF
        </Button>
      ) : (
        canGenerate && (
          <Button type="button" variant="primary" onClick={() => setConfirming(true)}>
            Generate invoice
          </Button>
        )
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
