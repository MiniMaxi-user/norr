"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Dialog, toast, useEscapeToClose } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { creditInvoice } from "../actions";
import { DialogError, DialogField } from "../../settings/components/settings-dialog-kit";

export interface CreditInvoiceTarget {
  id: string;
  invoiceNumber: string;
  /** Contract invoices also re-open the contract period. */
  isContract?: boolean;
}

export interface CreditInvoiceDialogProps {
  invoice: CreditInvoiceTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCredited?: () => void;
}

/**
 * "Credit invoice" confirmation popup (issue #236): explains the effects and
 * requires a reason. The server creates the credit note (own number, negative
 * amounts, PDF) and e-mails it to the invoice contact. Mount only while open.
 */
export function CreditInvoiceDialog({ invoice, open, onOpenChange, onCredited }: CreditInvoiceDialogProps) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, startTransition] = useTransition();
  useEscapeToClose(open, (next) => {
    if (!pending) onOpenChange(next);
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await creditInvoice({ invoiceId: invoice.id, reason });
      if (!result.data) {
        setError(result.error ?? "Something went wrong.");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      const { creditNoteNumber, email } = result.data;
      const emailLine =
        email.status === "queued"
          ? `Email to ${email.to} queued.`
          : email.status === "skipped"
            ? `Not emailed: ${email.reason}.`
            : `Email failed: ${email.error}`;
      toast({
        tone: email.status === "failed" ? "danger" : "success",
        title: `Credit note ${creditNoteNumber} created`,
        description: emailLine,
        ...(email.status === "failed" ? { duration: 0 } : {}),
      });
      onOpenChange(false);
      onCredited?.();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)} size="sm">
      <Dialog.Header>
        <h2 className="web-dialog-title">Credit invoice {invoice.invoiceNumber}?</h2>
      </Dialog.Header>
      <form onSubmit={submit}>
        <Dialog.Body>
          <div className="web-dialog-form">
            <p className="web-dialog-text">
              This creates a credit note for the full invoice amount, with its own number, and emails it to the invoice
              contact. The invoice becomes Credited and cannot be credited again. The quote goes back to Draft and a
              linked work order back to Completed, so a new invoice can be generated
              {invoice.isContract ? "; the contract period is re-opened for invoicing" : ""}. Payments already
              registered on this invoice stay on record.
            </p>
            {error && Object.keys(fieldErrors).length === 0 ? <DialogError>{error}</DialogError> : null}
            <DialogField id="credit-reason" label="Reason" errors={fieldErrors.reason}>
              <textarea
                id="credit-reason"
                className="web-textarea"
                rows={3}
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                autoFocus
              />
            </DialogField>
          </div>
        </Dialog.Body>
        <Dialog.Footer>
          <WebButton onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </WebButton>
          <WebButton type="submit" variant="danger" loading={pending}>
            Credit invoice
          </WebButton>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}
