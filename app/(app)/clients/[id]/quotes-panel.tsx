"use client";

import { useRouter } from "next/navigation";
import { Badge, LinkedRecordsTable, SectionHeader, Stack } from "@yourorg/ui";
import { ClipboardList } from "@yourorg/ui/icons";
import type { QuoteRecord } from "@/app/(app)/quotes/actions";
import { formatDate } from "@/lib/format/date";
import { formatCurrency } from "@/lib/format/currency";

export interface QuotesPanelProps {
  quotes: QuoteRecord[];
}

/**
 * Read-only "Quotes" tab on the Client detail page (docs/ARCHITECTURE.md
 * "Relational detail pages") — every pre-sale proposal for this client, each
 * row linking to the real Quotes module's detail page.
 *
 * Same `SectionHeader` title treatment as the sibling Work Orders/Contracts
 * tabs (issue #113 follow-up), deliberately with no add action in its
 * `actions` slot — explicit product-owner call, unlike Work Orders/Contracts:
 * `CreateQuoteButton`/`/quotes/new?clientId=…` exists and works the same
 * client-scoped way theirs do, it's just not surfaced from this tab (most
 * quotes arrive via a Work Order's auto-draft, issue #109, rather than a
 * bare "New Quote" click from the client page). Otherwise flat and
 * read-only: this task's scope is surfacing *visibility* of the
 * relationship, not duplicating the Quotes module's own create/edit/delete
 * affordances onto the Client page — those stay on `/quotes` and
 * `/quotes/[id]`.
 */
export function QuotesPanel({ quotes }: QuotesPanelProps) {
  const router = useRouter();

  return (
    <Stack gap="md">
      <SectionHeader icon={ClipboardList} title="Quotes" />

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
          { header: "Total", render: (quote) => formatCurrency(quote.total) },
        ]}
      />
    </Stack>
  );
}
