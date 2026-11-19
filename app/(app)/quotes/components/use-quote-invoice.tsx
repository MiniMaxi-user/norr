"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { WebConfirmDialog } from "@yourorg/ui/web-client";
import {
  invoiceQuote,
  sendInvoiceEmailForInvoice,
  sendInvoiceEmailForQuote,
  type InvoicePaymentSummary,
  type InvoiceSummary,
} from "../invoice-actions";
import { deletePayment } from "../../invoices/actions";
import { CreditInvoiceDialog } from "../../invoices/components/credit-invoice-dialog";
import { RegisterPaymentDialog } from "../../invoices/components/register-payment-dialog";
import { formatDateTimeWeb, formatMoneyWeb } from "@/lib/format/web";
import { openDocumentPopup } from "@/lib/popup";

export interface QuoteInvoiceFlow {
  /** Asks for confirmation, then generates the invoice (sets the quote to Invoiced). */
  requestGenerate: () => void;
  /** Sends the live invoice e-mail now (first send). */
  sendNow: () => void;
  /** Asks for confirmation first (the live invoice was already sent once). */
  requestResend: () => void;
  /** Opens the live invoice PDF. */
  openPdf: () => void;
  /** Per-document actions of the Documents tab (every invoice and credit note of the quote). */
  openPdfFor: (invoiceId: string) => void;
  sendFor: (invoiceId: string) => void;
  requestResendFor: (invoice: InvoiceSummary) => void;
  requestPayment: (invoice: InvoiceSummary) => void;
  requestCredit: (invoice: InvoiceSummary) => void;
  requestDeletePayment: (payment: InvoicePaymentSummary, invoiceNumber: string) => void;
  generating: boolean;
  sending: boolean;
  /** The confirm dialogs and popups — render once inside the page. */
  dialogs: ReactNode;
}

/**
 * The invoicing workflow of a quote (issues #119, #211, #235, #236) behind the
 * Quote page's LivePanel and Documents tab: "Generate invoice" (after a confirm
 * dialog) creates the invoice, flips the quote to Invoiced and e-mails the PDF
 * to the client's invoice contact when one is set; "Send invoice" / "Resend"
 * (confirms first, naming when and to whom) e-mails any invoice or credit note
 * again on demand; "Register payment" and "Credit invoice" open their popups;
 * a payment can be deleted after a confirm. PDFs are rendered on demand by
 * `GET /invoices/[id]/pdf` (and `GET /quotes/[id]/invoice` for the live one).
 */
export function useQuoteInvoice(
  quoteId: string,
  invoice: InvoiceSummary | null,
  options: { isContract?: boolean } = {},
): QuoteInvoiceFlow {
  const router = useRouter();
  const [confirmingGenerate, setConfirmingGenerate] = useState(false);
  // The document the resend confirmation is about (null = closed).
  const [resendTarget, setResendTarget] = useState<InvoiceSummary | null>(null);
  const [payTarget, setPayTarget] = useState<InvoiceSummary | null>(null);
  const [creditTarget, setCreditTarget] = useState<InvoiceSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ payment: InvoicePaymentSummary; invoiceNumber: string } | null>(
    null,
  );
  const [generating, startGenerating] = useTransition();
  const [sending, startSending] = useTransition();
  const [deleting, startDeleting] = useTransition();

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

  /** Sends one invoice or credit note by id; without id, the quote's live invoice. */
  function send(invoiceId?: string) {
    startSending(async () => {
      const result = invoiceId ? await sendInvoiceEmailForInvoice(invoiceId) : await sendInvoiceEmailForQuote(quoteId);
      setResendTarget(null);
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

  function confirmDeletePayment() {
    if (!deleteTarget) return;
    const { payment } = deleteTarget;
    startDeleting(async () => {
      const result = await deletePayment(payment.id);
      setDeleteTarget(null);
      if (result.error) {
        toast({ tone: "danger", title: "Could not delete payment", description: result.error, duration: 0 });
        return;
      }
      toast({ tone: "success", title: "Payment deleted" });
      router.refresh();
    });
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
        open={resendTarget !== null}
        title={resendTarget?.kind === "credit_note" ? "Resend credit note?" : "Resend invoice?"}
        confirmLabel="Send again"
        confirmVariant="primary"
        pending={sending}
        onCancel={() => setResendTarget(null)}
        onConfirm={() => send(resendTarget?.id)}
      >
        {resendTarget?.invoiceNumber ?? "This document"} was already sent to{" "}
        {resendTarget?.emailedTo ?? "the invoice contact"}
        {resendTarget?.emailedAt ? ` on ${formatDateTimeWeb(resendTarget.emailedAt)}` : ""}. It will be sent again to
        the client&rsquo;s current invoice contact. To use a different address, change the invoice contact on the
        client&rsquo;s invoice address first.
      </WebConfirmDialog>

      <WebConfirmDialog
        open={deleteTarget !== null}
        title="Delete payment?"
        confirmLabel="Delete payment"
        confirmVariant="danger"
        pending={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDeletePayment}
      >
        This removes the payment of {deleteTarget ? formatMoneyWeb(deleteTarget.payment.amount) : ""} on invoice{" "}
        {deleteTarget?.invoiceNumber}; the outstanding amount goes up accordingly.
      </WebConfirmDialog>

      {payTarget ? (
        <RegisterPaymentDialog
          invoice={{ id: payTarget.id, invoiceNumber: payTarget.invoiceNumber, outstanding: payTarget.outstanding }}
          open
          onOpenChange={(next) => !next && setPayTarget(null)}
        />
      ) : null}
      {creditTarget ? (
        <CreditInvoiceDialog
          invoice={{ id: creditTarget.id, invoiceNumber: creditTarget.invoiceNumber, isContract: options.isContract }}
          open
          onOpenChange={(next) => !next && setCreditTarget(null)}
        />
      ) : null}
    </>
  );

  return {
    requestGenerate: () => setConfirmingGenerate(true),
    sendNow: () => send(),
    requestResend: () => setResendTarget(invoice),
    openPdf,
    openPdfFor: (invoiceId) => openDocumentPopup(`/invoices/${invoiceId}/pdf`, "invoice PDF"),
    sendFor: (invoiceId) => send(invoiceId),
    requestResendFor: setResendTarget,
    requestPayment: setPayTarget,
    requestCredit: setCreditTarget,
    requestDeletePayment: (payment, invoiceNumber) => setDeleteTarget({ payment, invoiceNumber }),
    generating,
    sending,
    dialogs,
  };
}
