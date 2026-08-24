"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Stack, Table, Text } from "@yourorg/ui";
import type { QuoteRecord } from "../actions";
import { DeleteQuoteDialog } from "./delete-quote-dialog";

export interface QuotesTableProps {
  quotes: QuoteRecord[];
  clientNameById: Map<string, string>;
  canEdit: boolean;
  canDelete: boolean;
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
 * List view table for Quotes — same shape as
 * `app/(app)/contracts/components/contracts-table.tsx`: client-side search
 * over the current page, row click navigates to the detail page, row-level
 * Edit navigates to a real page (`/quotes/[id]/edit`, docs/ARCHITECTURE.md
 * "Popup vs. full page"), Delete stays a lightweight confirm `Dialog`.
 */
export function QuotesTable({ quotes, clientNameById, canEdit, canDelete }: QuotesTableProps) {
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
                <Table.Cell>{quote.name}</Table.Cell>
                <Table.Cell>{clientNameById.get(quote.client_id) ?? "—"}</Table.Cell>
                <Table.Cell align="center">
                  <Badge color={quote.quote_status?.color} variant="muted">
                    {quote.quote_status?.label ?? "—"}
                  </Badge>
                </Table.Cell>
                <Table.Cell>{formatDate(quote.valid_until)}</Table.Cell>
                <Table.Cell>{formatTotal(quote.total)}</Table.Cell>
                {showActionsColumn && (
                  <Table.Cell align="center">
                    <span className="ui-row-actions" onClick={(event) => event.stopPropagation()}>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/quotes/${quote.id}/edit`)}
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
