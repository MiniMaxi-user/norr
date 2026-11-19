"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Dialog, toast, useEscapeToClose } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { formatMoneyWeb } from "@/lib/format/web";
import { listPaymentMethods, registerPayment, type PaymentMethodOption } from "../actions";
import { DialogError, DialogField } from "../../settings/components/settings-dialog-kit";

export interface RegisterPaymentTarget {
  id: string;
  invoiceNumber: string;
  /** Amount still to be paid; prefilled in the popup. */
  outstanding: number;
}

export interface RegisterPaymentDialogProps {
  invoice: RegisterPaymentTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful registration (the dialog also refreshes the route). */
  onRegistered?: () => void;
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * "Register payment" popup (issue #235): light action -> small dialog. Date
 * defaults to today, amount to the outstanding amount, method to the list's
 * default. A validation failure (e.g. overpayment, on the amount field) keeps
 * everything the user typed. Several partial payments are possible: register
 * again for the remaining outstanding amount. Mount it only while open (the
 * parent renders it conditionally) so the defaults are fresh each time.
 */
export function RegisterPaymentDialog({ invoice, open, onOpenChange, onRegistered }: RegisterPaymentDialogProps) {
  const router = useRouter();
  const [paidOn, setPaidOn] = useState(todayIso);
  const [amount, setAmount] = useState(() => invoice.outstanding.toFixed(2));
  const [methodId, setMethodId] = useState("");
  const [note, setNote] = useState("");
  const [methods, setMethods] = useState<PaymentMethodOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [pending, startTransition] = useTransition();
  useEscapeToClose(open, (next) => {
    if (!pending) onOpenChange(next);
  });

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    void listPaymentMethods().then((result) => {
      if (cancelled) return;
      if (!result.data) {
        setError(result.error ?? "Could not load the payment methods.");
        setMethods([]);
        return;
      }
      const loaded = result.data;
      setMethods(loaded.methods);
      setMethodId((current) => current || loaded.defaultMethodId || "");
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await registerPayment({
        invoiceId: invoice.id,
        paidOn,
        amount: amount.trim().replace(",", "."),
        methodId,
        note,
      });
      if (!result.data) {
        setError(result.error ?? "Something went wrong.");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      toast({ tone: "success", title: "Payment registered", description: `Invoice ${invoice.invoiceNumber}` });
      onOpenChange(false);
      onRegistered?.();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)} size="sm">
      <Dialog.Header>
        <h2 className="web-dialog-title">Register payment</h2>
      </Dialog.Header>
      <form onSubmit={submit}>
        <Dialog.Body>
          <div className="web-dialog-form">
            <p className="web-dialog-text">
              Invoice {invoice.invoiceNumber} &middot; outstanding {formatMoneyWeb(invoice.outstanding)}. For a partial
              payment, lower the amount and register the rest later.
            </p>
            {error && Object.keys(fieldErrors).length === 0 ? <DialogError>{error}</DialogError> : null}
            <DialogField id="payment-paid-on" label="Payment date" errors={fieldErrors.paidOn}>
              <input
                id="payment-paid-on"
                type="date"
                className="web-input"
                value={paidOn}
                onChange={(event) => setPaidOn(event.target.value)}
                required
              />
            </DialogField>
            <DialogField id="payment-amount" label="Amount (EUR)" errors={fieldErrors.amount}>
              <input
                id="payment-amount"
                inputMode="decimal"
                className="web-input"
                data-numeric="true"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </DialogField>
            <DialogField id="payment-method" label="Method" errors={fieldErrors.methodId}>
              <select
                id="payment-method"
                className="web-select"
                value={methodId}
                onChange={(event) => setMethodId(event.target.value)}
                disabled={methods === null}
                required
              >
                {methods === null ? <option value="">Loading…</option> : <option value="">Choose a method…</option>}
                {(methods ?? []).map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.label}
                  </option>
                ))}
              </select>
            </DialogField>
            <DialogField id="payment-note" label="Note" errors={fieldErrors.note}>
              <textarea
                id="payment-note"
                className="web-textarea"
                rows={2}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </DialogField>
          </div>
        </Dialog.Body>
        <Dialog.Footer>
          <WebButton onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </WebButton>
          <WebButton type="submit" variant="save" loading={pending} disabled={methods === null}>
            Register payment
          </WebButton>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}
