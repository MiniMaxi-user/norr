import Link from "next/link";
import { Badge, EmptyState, SectionHeader, Stack, Table, Text } from "@yourorg/ui";
import { Receipt } from "@yourorg/ui/icons";
import type { ContractQuoteRecord } from "@/app/(app)/quotes/contract-quote-actions";
import { formatDate } from "@/lib/format/date";
import { formatCurrency } from "@/lib/format/currency";

export interface ContractQuotesPanelProps {
  quotes: ContractQuoteRecord[];
}

/**
 * "Quotes" panel on the contract detail page (issue #211 item 7): every quote
 * generated for this contract (drafts and invoiced alike), newest first, with
 * its invoiced period, status, total and - once invoiced - the invoice
 * number. Read-only; creating/invoicing happens from the Quotes module.
 * Same flat `SectionHeader` + table shape as `ContractAssetsPanel`.
 */
export function ContractQuotesPanel({ quotes }: ContractQuotesPanelProps) {
  return (
    <Stack gap="md">
      <SectionHeader icon={Receipt} title="Quotes" />

      {quotes.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          heading="No quotes yet"
          text="Quotes generated for this contract (via Generate contract quotes on the Quotes page) show up here."
        />
      ) : (
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Quote</Table.HeaderCell>
              <Table.HeaderCell>Period</Table.HeaderCell>
              <Table.HeaderCell align="center">Status</Table.HeaderCell>
              <Table.HeaderCell>Total</Table.HeaderCell>
              <Table.HeaderCell>Invoice</Table.HeaderCell>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {quotes.map((quote) => (
              <Table.Row key={quote.id}>
                <Table.Cell>
                  <Link href={`/quotes/${quote.id}`}>{quote.name}</Link>
                </Table.Cell>
                <Table.Cell>
                  {quote.contract_period_start && quote.contract_period_end
                    ? `${formatDate(quote.contract_period_start)} - ${formatDate(quote.contract_period_end)}`
                    : "—"}
                </Table.Cell>
                <Table.Cell align="center">
                  <Badge color={quote.status?.color} variant="muted">
                    {quote.status?.label ?? "—"}
                  </Badge>
                </Table.Cell>
                <Table.Cell>{formatCurrency(quote.total)}</Table.Cell>
                <Table.Cell>{quote.invoice_number ?? <Text tone="muted">—</Text>}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </Stack>
  );
}
