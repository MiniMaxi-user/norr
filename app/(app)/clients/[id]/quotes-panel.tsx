"use client";

import { useRouter } from "next/navigation";
import { Badge, LinkedRecordsTable } from "@yourorg/ui";
import { ClipboardList } from "@yourorg/ui/icons";
import type { QuoteRecord } from "@/app/(app)/quotes/actions";
import { formatDate } from "./format-date";

export interface QuotesPanelProps {
  quotes: QuoteRecord[];
}

function formatTotal(value: number): string {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/**
 * Read-only "Quotes" tab on the Client detail page (docs/ARCHITECTURE.md
 * "Relational detail pages") — every pre-sale proposal for this client, each
 * row linking to the real Quotes module's detail page.
 *
 * Deliberately flat and read-only, same shape as the sibling "Contracts"
 * tab (`contracts-panel.tsx`): this task's scope is surfacing *visibility*
 * of the relationship, not duplicating the Quotes module's own create/edit/
 * delete affordances onto the Client page — those stay on `/quotes` and
 * `/quotes/[id]`.
 */
export function QuotesPanel({ quotes }: QuotesPanelProps) {
  const router = useRouter();

  return (
    <LinkedRecordsTable
      records={quotes}
      getKey={(quote) => quote.id}
      onRowClick={(quote) => router.push(`/quotes/${quote.id}`)}
      emptyIcon={<ClipboardList />}
      emptyHeading="No quotes yet"
      emptyText="Pre-sale proposals for this client will show up here."
      columns={[
        { header: "Name", render: (quote) => quote.name },
        {
          header: "Status",
          align: "center",
          render: (quote) => (
            <Badge color={quote.quote_status?.color} variant="muted">
              {quote.quote_status?.label ?? "—"}
            </Badge>
          ),
        },
        { header: "Valid until", render: (quote) => formatDate(quote.valid_until) },
        { header: "Total", render: (quote) => formatTotal(quote.total) },
      ]}
    />
  );
}
