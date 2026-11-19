"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { WebConfirmDialog } from "@yourorg/ui/web-client";
import { invoiceQuote, sendInvoiceEmailForQuote, type InvoiceSummary } from "../invoice-actions";
import { formatDateTimeWeb } from "@/lib/format/web";
import { openDocumentPopup } from "@/lib/popup";

export interface QuoteInvoiceFlow {
  /** Asks for confirmation, then generates the invoice (sets the quote to Invoiced). */
  requestGenerate: () => void;
  /** Sends the invoice e-mail now (first send). */
  sendNow: () => void;
  /** Asks for confirmation first (it was already sent once). */
  requestResend: () => void;
  openPdf: () => void;
  generating: boolean;
  sending: boolean;
  /** The confirm dialogs — render once inside the page. */
  dialogs: ReactNode;
}

/**
 * The invoicing workflow of a quote (issues #119, #211) behind the Quote
 * page's LivePanel and ··· menu: "Generate invoice" (after a confirm dialog)
 * creates the invoice, flips the quote to Invoiced and e-mails the PDF to the
 * client's invoice contact when one is set; "Send invoice" / "Resend invoice"
 * (confirms first, naming when and to whom) e-mails it again on demand; the
 * PDF is rendered on demand by `GET /quotes/[id]/invoice`. Same server
 * actions and messages as before — only the presentation moved.
 */
export function useQuoteInvoice(quoteId: string, invoice: InvoiceSummary | null): QuoteInvoiceFlow {
  const router = useRouter();
  const [confirmingGenerate, setConfirmingGenerate] = useState(false);
  const [confirmingResend, setConfirmingResend] = useState(false);
  const [generating, startGenerating] = useTransition();
  const [sending, startSending] = useTransition();

  function generate() {
    startGenerating(async () => {
      const result = await invoiceQuote(quoteId);
      setConfirmingGenerate(false);
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

  function send() {
    startSending(async () => {
      const result = await sendInvoiceEmailForQuote(quoteId);
      setConfirmingResend(false);
      if (!result.data) {
        toast({
          tone: "danger",
          title: "Could not send invoice",
          description: result.error ?? "Something went wrong.",
          duration: 0,
        });
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

  function openPdf() {
    openDocumentPopup(`/quotes/${quoteId}/invoice`, "invoice PDF");
  }

  const dialogs = (
    <>
      <WebConfirmDialog
        open={confirmingGenerate}
        title="Generate invoice?"
        confirmLabel="Generate invoice"
        confirmVariant="primary"
        pending={generating}
        onCancel={() => setConfirmingGenerate(false)}
        onConfirm={generate}
      >
        This creates the invoice and sets the quote to Invoiced. If the client has an invoice contact, the invoice PDF
        is emailed to them automatically.
      </WebConfirmDialog>

      <WebConfirmDialog
        open={confirmingResend && Boolean(invoice?.emailedAt)}
        title="Resend invoice?"
        confirmLabel="Send again"
        confirmVariant="primary"
        pending={sending}
        onCancel={() => setConfirmingResend(false)}
        onConfirm={send}
      >
        This invoice was already sent to {invoice?.emailedTo ?? "the invoice contact"}
        {invoice?.emailedAt ? ` on ${formatDateTimeWeb(invoice.emailedAt)}` : ""}. It will be sent again to the
        client&rsquo;s current invoice contact. To use a different address, change the invoice contact on the
        client&rsquo;s invoice address first.
      </WebConfirmDialog>
    </>
  );

  return {
    requestGenerate: () => setConfirmingGenerate(true),
    sendNow: send,
    requestResend: () => setConfirmingResend(true),
    openPdf,
    generating,
    sending,
    dialogs,
  };
}
