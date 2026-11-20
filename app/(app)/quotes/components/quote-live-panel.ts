import type { LivePanelAction, LivePanelData } from "@yourorg/ui/web-client";
import { formatDateWeb, formatMoneyWeb } from "@/lib/format/web";
import type { QuoteRecord } from "../actions";
import type { InvoiceSummary } from "../invoice-actions";
import { sentQuoteExpiry } from "./quote-status";

/** The signed-in viewer (see the client page's twin of this function). */
export interface LivePanelViewer {
  userId: string;
}

export interface QuoteLivePanelRecord {
  quote: QuoteRecord;
  /** `null` = no invoice yet, or the viewer cannot read invoices. */
  invoice: InvoiceSummary | null;
  lineCount: number;
  /** Pre-VAT total of the lines. */
  subtotal: number;
  /** `can(actor, "invoicing", "create")` folded with the feature flag. */
  canInvoice: boolean;
  /** May the viewer change the quote (the expiry action starts Edit)? */
  canUpdate: boolean;
  /** Today in Europe/Amsterdam as `YYYY-MM-DD` (injected for testability). */
  today: string;
  generating: boolean;
  sending: boolean;
  onGenerate: () => void;
  onSendInvoice: () => void;
  onOpenPdf: () => void;
  onEditValidity: () => void;
}

/** Statuses that never lead to an invoice. */
export const NOT_INVOICEABLE = ["rejected", "expired", "invoiced"];

/** The quote is ready to be invoiced (shown as a LivePanel). */
export function canGenerateNow(record: Pick<QuoteLivePanelRecord, "quote" | "invoice" | "lineCount" | "canInvoice">) {
  return (
    record.canInvoice &&
    !record.invoice &&
    record.lineCount > 0 &&
    !record.quote.is_auto_draft &&
    !NOT_INVOICEABLE.includes(record.quote.quote_status?.value ?? "")
  );
}

/**
 * LivePanel of the Quote page — a panel only when something is relevant NOW
 * and the viewer can act on it from here. In priority order:
 *
 *  1. the invoice e-mail failed ("urgent", Send invoice again);
 *  2. the quote is ready to invoice: it has lines, no invoice yet, is a real
 *     quote (not a work order's system auto-draft) and is not rejected/expired
 *     (Generate invoice — the one workflow action that moves a quote's status);
 *  3. an invoice exists but was never e-mailed (Send invoice);
 *  4. the quote was SENT and its validity ends today or ended within the last
 *     7 days without an answer — the same trigger as the Client page's panel
 *     (Edit valid until).
 *
 * More than one trigger => the first is shown, the rest listed under it.
 * Returns `null` otherwise — also when in doubt.
 */
export function getLivePanel(record: QuoteLivePanelRecord, _viewer: LivePanelViewer | null): LivePanelData | null {
  void _viewer;
  const { quote, invoice } = record;
  const panels: LivePanelData[] = [];

  if (invoice && record.canInvoice && !invoice.emailedAt) {
    const sendAction: LivePanelAction = {
      label: record.sending ? "Sending…" : "Send invoice",
      onClick: record.sending ? undefined : record.onSendInvoice,
    };
    const pdfAction: LivePanelAction = { label: "Open PDF", onClick: record.onOpenPdf };
    panels.push(
      invoice.emailError
        ? {
            variant: "urgent",
            title: "INVOICE EMAIL FAILED",
            value: "Not sent",
            context: `${invoice.invoiceNumber} · ${invoice.emailError}`,
            actions: [sendAction, pdfAction],
          }
        : {
            variant: "attention",
            title: "INVOICE NOT SENT",
            value: invoice.invoiceNumber,
            context: "Generated but never emailed — no invoice contact or email address was set at the time",
            actions: [sendAction, pdfAction],
          },
    );
  }

  if (canGenerateNow(record)) {
    panels.push({
      variant: "attention",
      title: "ACTION NEEDED FROM YOU",
      value: "Invoice",
      context: `${record.lineCount} ${record.lineCount === 1 ? "line" : "lines"} · ${formatMoneyWeb(record.subtotal)} excl. VAT — generate the invoice and set this quote to Invoiced`,
      actions: [
        {
          label: record.generating ? "Generating…" : "Generate invoice",
          onClick: record.generating ? undefined : record.onGenerate,
        },
      ],
    });
  }

  const expiry = sentQuoteExpiry(quote, record.today);
  if (expiry && record.canUpdate) {
    panels.push({
      variant: expiry === "expired" ? "urgent" : "attention",
      title: expiry === "expired" ? "QUOTE EXPIRED" : "QUOTE EXPIRES TODAY",
      value: expiry === "expired" ? "Expired" : "Today",
      context: `Sent and valid until ${formatDateWeb(quote.valid_until)} — no answer yet`,
      actions: [{ label: "Edit valid until", onClick: record.onEditValidity }],
    });
  }

  // An urgent panel outranks an attention one; otherwise keep the order above.
  panels.sort((a, b) => Number(b.variant === "urgent") - Number(a.variant === "urgent"));
  const [first, ...rest] = panels;
  return first ? { ...first, others: rest } : null;
}
