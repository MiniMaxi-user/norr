import Link from "next/link";
import type { TimelineItem } from "@yourorg/ui/web";
import { formatDateTimeWeb } from "@/lib/format/web";
import type { QuoteLineItemRecord, QuoteRecord } from "../actions";
import type { InvoiceSummary } from "../invoice-actions";


const euroFormatter = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" });
function formatEuro(value: number): string {
  return euroFormatter.format(value);
}

interface Event {
  id: string;
  at: string;
  title: TimelineItem["title"];
}

/**
 * The Quote page's TIMELINE, built from data the page already loads (no new
 * fetch): the quote's own created/changed stamps, its line items and — for a
 * viewer who can read invoices — every invoice, credit note, e-mail and payment. Newest first.
 * None of these rows store an actor name the page loads, so entries
 * carry no actor.
 */
export function buildQuoteTimeline(input: {
  quote: QuoteRecord;
  lineItems: QuoteLineItemRecord[];
  invoice: InvoiceSummary | null;
  /** Every invoice and credit note of the quote (payments + credit notes become events); falls back to `invoice`. */
  invoices?: InvoiceSummary[];
  /** Label + id of the work order this quote was made from, when it has one. */
  sourceWorkOrder: { id: string; label: string } | null;
}): TimelineItem[] {
  const { quote, lineItems, invoice, sourceWorkOrder } = input;
  const allInvoices = input.invoices ?? (invoice ? [invoice] : []);
  const events: Event[] = [
    {
      id: "quote-created",
      at: quote.created_at,
      title: sourceWorkOrder ? (
        <>
          Quote created from <Link href={`/work-orders/${sourceWorkOrder.id}`}>{sourceWorkOrder.label}</Link>
        </>
      ) : (
        "Quote created"
      ),
    },
  ];

  const created = new Date(quote.created_at).getTime();
  const updated = new Date(quote.updated_at).getTime();
  if (Number.isFinite(created) && Number.isFinite(updated) && updated - created > 60_000) {
    events.push({ id: "quote-updated", at: quote.updated_at, title: "Details changed" });
  }

  for (const item of lineItems) {
    events.push({
      id: `line-${item.id}`,
      at: item.created_at,
      title: `Line added · ${item.article_number ?? item.description}`,
    });
  }

  for (const doc of allInvoices) {
    const isCredit = doc.kind === "credit_note";
    const noun = isCredit ? "Credit note" : "Invoice";
    events.push({
      id: `invoice-${doc.id}`,
      at: doc.generatedAt,
      title: isCredit
        ? `Credit note ${doc.invoiceNumber} generated${doc.creditsInvoiceNumber ? ` for invoice ${doc.creditsInvoiceNumber}` : ""}`
        : `Invoice ${doc.invoiceNumber} generated`,
    });
    if (doc.emailedAt && doc.emailedTo) {
      events.push({ id: `invoice-sent-${doc.id}`, at: doc.emailedAt, title: `${noun} ${doc.invoiceNumber} emailed to ${doc.emailedTo}` });
    }
    for (const payment of doc.payments) {
      events.push({
        id: `payment-${payment.id}`,
        at: payment.createdAt,
        title: `Payment of ${formatEuro(payment.amount)} registered on invoice ${doc.invoiceNumber} (${payment.methodLabel || "payment"})`,
      });
    }
  }

  return events
    .filter((event) => !Number.isNaN(new Date(event.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map<TimelineItem>((event, index) => ({
      id: event.id,
      title: event.title,
      at: formatDateTimeWeb(event.at),
      status: index === 0 ? "latest" : "default",
    }));
}
