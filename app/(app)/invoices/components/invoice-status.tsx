import { WebBadge, type WebBadgeVariant } from "@yourorg/ui/web";
import { formatDateTimeWeb } from "@/lib/format/web";
import { OutboxStatusBadge } from "@/components/email/outbox-status-badge";
import type { OutboxMailStatus } from "@/lib/email/outbox-status";
import type { InvoiceEmailStatus, InvoicePaymentStatusValue } from "../actions";

/** Label and badge tone of every derived payment status (issues #234-#236). */
export const PAYMENT_STATUS_META: Record<InvoicePaymentStatusValue, { label: string; variant: WebBadgeVariant }> = {
  open: { label: "Open", variant: "info" },
  partially_paid: { label: "Partially paid", variant: "warning" },
  paid: { label: "Paid", variant: "success" },
  overdue: { label: "Overdue", variant: "danger" },
  credited: { label: "Credited", variant: "neutral" },
  credit_note: { label: "Credit note", variant: "mono" },
};

/** Filter choices for the payment-status multiselect. */
export const PAYMENT_STATUS_OPTIONS = (Object.keys(PAYMENT_STATUS_META) as InvoicePaymentStatusValue[]).map((value) => ({
  value,
  label: PAYMENT_STATUS_META[value].label,
}));

/** The one payment-status badge, shared by the Invoices overview, the client's
 * Invoices tab and the quote's Documents tab. */
export function PaymentStatusBadge({ status }: { status: InvoicePaymentStatusValue }) {
  const meta = PAYMENT_STATUS_META[status];
  return <WebBadge variant={meta.variant}>{meta.label}</WebBadge>;
}

export interface InvoiceEmailStatusProps {
  status: InvoiceEmailStatus;
  error?: string | null;
  to?: string | null;
  at?: string | null;
  /** Latest outbox mail (issue #268); wins over the legacy fields when present. */
  outbox?: OutboxMailStatus | null;
}

/** E-mail column: Sent / Failed (error in the tooltip) / Not sent. */
export function InvoiceEmailStatusCell({ status, error, to, at, outbox }: InvoiceEmailStatusProps) {
  if (outbox) return <OutboxStatusBadge mail={outbox} />;
  if (status === "failed") {
    return (
      <span title={error ?? "Sending failed"}>
        <WebBadge variant="danger">Failed</WebBadge>
      </span>
    );
  }
  if (status === "sent") {
    const title = [to ? `Sent to ${to}` : "Sent", at ? formatDateTimeWeb(at) : null].filter(Boolean).join(" · ");
    return <span title={title}>Sent</span>;
  }
  return <span className="web-muted-cell">Not sent</span>;
}
