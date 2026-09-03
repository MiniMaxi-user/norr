"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDeleteDialog, toast } from "@yourorg/ui";
import { generateInvoice, getInvoiceSignedUrl, deleteInvoice, type InvoiceSummary } from "../invoice-actions";

export interface QuoteInvoiceActionsProps {
  quoteId: string;
  /** Initial "does this quote already have an invoice" state, fetched
   * server-side in `page.tsx` so there's no client-side loading flash on
   * first render. Kept in local state below and updated optimistically on
   * generate/delete, same convention `quote-detail.tsx`'s own scalar fields
   * (title/validUntil/notes) already use — a later `router.refresh()`
   * re-syncs the server cache, but this component's own displayed state is
   * never re-derived from the prop after mount. */
  invoice: InvoiceSummary | null;
  /** `can(actor, "invoicing", "create")` (folded with `hasFeature`/
   * `canAccessModule` in `page.tsx`) — gates Generate/Regenerate. */
  canGenerate: boolean;
  /** `can(actor, "invoicing", "delete")` (same fold) — gates the Delete
   * button. Per `lib/rbac/permissions.ts`'s `invoicing` module, owner and
   * administratie always get create+read+delete together and every other
   * role gets none of them, so "Open PDF" (which needs `read`) is safely
   * shown whenever `invoice` is non-null without a third prop: an
   * `invoice` can only be non-null here if the caller could read it in the
   * first place (`page.tsx` only calls `getInvoiceForQuote` when
   * `canReadInvoice` passed). */
  canDelete: boolean;
}

const POPUP_WIDTH = 900;
const POPUP_HEIGHT = 1000;

/**
 * Standard cross-browser "center a popup on whichever screen the current
 * browser window is actually on" math (issue #119 acceptance criterion:
 * "PDF opent als popup in het midden gecentreerd") — `screenLeft`/`screenTop`
 * give this window's own position (so multi-monitor setups center on the
 * right screen, not always the primary one), `outerWidth`/`outerHeight` its
 * own chrome-inclusive size, and `screen.availWidth`/`availHeight` clamp the
 * popup so it never requests a size bigger than the display itself.
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
 * Generate / Open PDF / Delete cluster for the invoice attached to this
 * Quote (issue #119). Lives inside `QuoteDetailActions` — the hero band's
 * own action-button slot — rather than a separate panel: an invoice is a
 * 1:1 derived artifact of the quote (`invoices.quote_id unique`, no list of
 * its own sub-records to browse), so a small button cluster is the right
 * weight here, same as `WorkOrderDetailActions`' "Create Quote" button.
 *
 * Entirely absent (not just disabled) when both `canGenerate` and
 * `canDelete` are false — CLAUDE.md rule 3 / `docs/ARCHITECTURE.md`'s
 * feature-flag rule: a caller with no invoicing access, or an org where
 * `invoicing` isn't entitled at all, sees nothing here, not a disabled
 * button.
 */
export function QuoteInvoiceActions({ quoteId, invoice: initialInvoice, canGenerate, canDelete }: QuoteInvoiceActionsProps) {
  const router = useRouter();
  const [invoice, setInvoice] = useState(initialInvoice);
  const [isGenerating, startGenerating] = useTransition();
  const [isOpening, startOpening] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!canGenerate && !canDelete) return null;

  function handleGenerate() {
    startGenerating(async () => {
      const result = await generateInvoice(quoteId);
      if (!result.data) {
        const message = result.error ?? "Something went wrong.";
        toast({
          tone: "danger",
          title: "Could not generate invoice",
          description: message,
          duration: 0,
          // The one documented failure mode that's actionable from here:
          // the org has no `own_client_id` configured yet (Settings ->
          // Company, issue #120). Surfaced as-is (not rewritten) per the
          // backend's own doc comment; this just adds a shortcut to fix it.
          action: message.toLowerCase().includes("settings")
            ? { label: "Go to Settings", onClick: () => router.push("/settings/company") }
            : undefined,
        });
        return;
      }
      setInvoice({
        id: result.data.invoiceId,
        invoiceNumber: result.data.invoiceNumber,
        generatedAt: new Date().toISOString(),
      });
      toast({ tone: "success", title: "Invoice generated", description: result.data.invoiceNumber });
      router.refresh();
    });
  }

  function handleOpenPdf() {
    if (!invoice) return;
    startOpening(async () => {
      // Always mint a fresh signed URL right before opening — the backend's
      // signed URLs expire in 120 seconds, so a cached one from an earlier
      // generate/open could easily be stale by the time the user clicks.
      const result = await getInvoiceSignedUrl(invoice.id);
      if (!result.data) {
        toast({
          tone: "danger",
          title: "Could not open invoice",
          description: result.error ?? "Something went wrong.",
        });
        return;
      }
      const popup = window.open(
        result.data.signedUrl,
        "invoice-pdf",
        computePopupFeatures(POPUP_WIDTH, POPUP_HEIGHT),
      );
      if (!popup) {
        toast({
          tone: "danger",
          title: "Popup blocked",
          description: "Allow popups for this site to view the invoice PDF, then try again.",
        });
      }
    });
  }

  return (
    <>
      {invoice ? (
        <>
          <Button type="button" variant="outline" onClick={handleOpenPdf} disabled={isOpening}>
            {isOpening ? "Opening…" : "Open PDF"}
          </Button>
          {canGenerate && (
            <Button type="button" variant="outline" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? "Regenerating…" : "Regenerate invoice"}
            </Button>
          )}
          {canDelete && (
            <Button type="button" variant="danger" onClick={() => setDeleteOpen(true)}>
              Delete invoice
            </Button>
          )}
        </>
      ) : (
        canGenerate && (
          <Button type="button" variant="primary" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? "Generating…" : "Generate invoice"}
          </Button>
        )
      )}

      {invoice && (
        <ConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete invoice"
          fallbackMessage={
            <>
              Are you sure you want to delete invoice <strong>{invoice.invoiceNumber}</strong>? This cannot be
              undone.
            </>
          }
          onConfirm={async () => {
            const result = await deleteInvoice(invoice.id);
            return { error: !result.data ? (result.error ?? "Could not delete this invoice.") : undefined };
          }}
          onDeleted={() => {
            setInvoice(null);
            router.refresh();
          }}
          confirmLabel="Delete"
        />
      )}
    </>
  );
}
