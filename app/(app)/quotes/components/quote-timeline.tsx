import Link from "next/link";
import type { TimelineItem } from "@yourorg/ui/web";
import { formatDateTimeWeb } from "@/lib/format/web";
import type { QuoteLineItemRecord, QuoteRecord } from "../actions";
import type { InvoiceSummary } from "../invoice-actions";

const MAX_ITEMS = 8;

interface Event {
  id: string;
  at: string;
  title: TimelineItem["title"];
}

/**
 * The Quote page's TIMELINE, built from data the page already loads (no new
 * fetch): the quote's own created/changed stamps, its line items and — for a
 * viewer who can read invoices — the invoice and its e-mail. Newest first, at
 * most 8. None of these rows store an actor name the page loads, so entries
 * carry no actor.
 */
export function buildQuoteTimeline(input: {
  quote: QuoteRecord;
  lineItems: QuoteLineItemRecord[];
  invoice: InvoiceSummary | null;
  /** Label + id of the work order this quote was made from, when it has one. */
  sourceWorkOrder: { id: string; label: string } | null;
}): TimelineItem[] {
  const { quote, lineItems, invoice, sourceWorkOrder } = input;
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

  if (invoice) {
    events.push({ id: "invoice", at: invoice.generatedAt, title: `Invoice ${invoice.invoiceNumber} generated` });
    if (invoice.emailedAt && invoice.emailedTo) {
      events.push({ id: "invoice-sent", at: invoice.emailedAt, title: `Invoice emailed to ${invoice.emailedTo}` });
    }
  }

  return events
    .filter((event) => !Number.isNaN(new Date(event.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_ITEMS)
    .map<TimelineItem>((event, index) => ({
      id: event.id,
      title: event.title,
      at: formatDateTimeWeb(event.at),
      status: index === 0 ? "latest" : "default",
    }));
}
