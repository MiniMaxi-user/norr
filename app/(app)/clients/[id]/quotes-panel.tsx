"use client";

import { useRouter } from "next/navigation";
import { Badge, EmptyState, Table } from "@yourorg/ui";
import { ClipboardList } from "@yourorg/ui/icons";
import type { QuoteRecord } from "@/app/(app)/quotes/actions";

export interface QuotesPanelProps {
  quotes: QuoteRecord[];
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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

  if (quotes.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList />}
        heading="No quotes yet"
        text="Pre-sale proposals for this client will show up here."
      />
    );
  }

  return (
    <Table>
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell>Name</Table.HeaderCell>
          <Table.HeaderCell align="center">Status</Table.HeaderCell>
          <Table.HeaderCell>Valid until</Table.HeaderCell>
          <Table.HeaderCell>Total</Table.HeaderCell>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {quotes.map((quote) => (
          <Table.Row key={quote.id} onClick={() => router.push(`/quotes/${quote.id}`)}>
            <Table.Cell>{quote.name}</Table.Cell>
            <Table.Cell align="center">
              <Badge color={quote.quote_status?.color} variant="muted">
                {quote.quote_status?.label ?? "—"}
              </Badge>
            </Table.Cell>
            <Table.Cell>{formatDate(quote.valid_until)}</Table.Cell>
            <Table.Cell>{formatTotal(quote.total)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}
