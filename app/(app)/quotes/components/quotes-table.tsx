"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Inline, Input, Stack, Table, Text } from "@yourorg/ui";
import type { QuoteRecord } from "../actions";
import { DeleteQuoteDialog } from "./delete-quote-dialog";
import { formatDate } from "@/lib/format/date";
import { formatCurrency } from "@/lib/format/currency";

export interface QuotesTableProps {
  quotes: QuoteRecord[];
  clientNameById: Map<string, string>;
  canEdit: boolean;
  canDelete: boolean;
  /** Issue #109 — `true` (only ever passed when `QuotesScreen`'s "Show draft
   * quotes" toggle is on) renders a "Concept" badge next to the Name for any
   * row with `is_auto_draft: true`, so an auto-draft stays visually distinct
   * from a "real" quote even once a planner has chosen to look at both
   * together. */
  showDraftBadge?: boolean;
}

/**
 * List view table for Quotes — same shape as
 * `app/(app)/contracts/components/contracts-table.tsx`: client-side search
 * over the current page, row click navigates to the detail page. Row-level
 * "Edit" navigates to that same detail page (Pattern A migration deleted
 * `/quotes/[id]/edit` — every field that page used to own is inline-editable
 * on the detail page now, see `[id]/quote-detail.tsx`'s own doc comment) —
 * same "Edit is just a second, discoverable way to reach the detail page"
 * precedent `app/(app)/work-orders/components/work-orders-table.tsx` already
 * establishes (issue #89). Delete stays a lightweight confirm `Dialog`.
 */
export function QuotesTable({ quotes, clientNameById, canEdit, canDelete, showDraftBadge }: QuotesTableProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [deletingQuote, setDeletingQuote] = useState<QuoteRecord | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return quotes;
    return quotes.filter((quote) =>
      [quote.name, clientNameById.get(quote.client_id), quote.quote_status?.label]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(q)),
    );
  }, [quotes, query, clientNameById]);

  const showActionsColumn = canEdit || canDelete;

  return (
    <>
      <Stack gap="md">
        <Input
          aria-label="Search quotes on this page"
          placeholder="Search by name, client, status…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <Table stickyHeader maxHeight="65vh">
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Client</Table.HeaderCell>
              <Table.HeaderCell align="center">Status</Table.HeaderCell>
              <Table.HeaderCell>Valid until</Table.HeaderCell>
              <Table.HeaderCell>Total</Table.HeaderCell>
              {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {filtered.map((quote) => (
              <Table.Row key={quote.id} onClick={() => router.push(`/quotes/${quote.id}`)}>
                <Table.Cell>
                  {showDraftBadge && quote.is_auto_draft ? (
                    <Inline gap="xs" align="center">
                      <Text>{quote.name}</Text>
                      <Badge variant="muted">Concept</Badge>
                    </Inline>
                  ) : (
                    quote.name
                  )}
                </Table.Cell>
                <Table.Cell>{clientNameById.get(quote.client_id) ?? "—"}</Table.Cell>
                <Table.Cell align="center">
                  <Badge color={quote.quote_status?.color} variant="muted">
                    {quote.quote_status?.label ?? "—"}
                  </Badge>
                </Table.Cell>
                <Table.Cell>{formatDate(quote.valid_until)}</Table.Cell>
                <Table.Cell>{formatCurrency(quote.total)}</Table.Cell>
                {showActionsColumn && (
                  <Table.Cell align="center">
                    <span className="ui-row-actions" onClick={(event) => event.stopPropagation()}>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/quotes/${quote.id}`)}
                        >
                          Edit
                        </Button>
                      )}
                      {canDelete && (
                        <Button type="button" variant="danger" size="sm" onClick={() => setDeletingQuote(quote)}>
                          Delete
                        </Button>
                      )}
                    </span>
                  </Table.Cell>
                )}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>

        {filtered.length === 0 && <Text tone="muted">No quotes match &ldquo;{query}&rdquo;.</Text>}
      </Stack>

      {deletingQuote && (
        <DeleteQuoteDialog quote={deletingQuote} open onOpenChange={(next) => !next && setDeletingQuote(null)} />
      )}
    </>
  );
}
