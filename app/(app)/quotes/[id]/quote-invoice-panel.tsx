import { Card, KeyValueList, SectionHeader, Stack, Text, type KeyValueListItem } from "@yourorg/ui";
import { Receipt } from "@yourorg/ui/icons";
import type { InvoiceSummary } from "../invoice-actions";
import { formatDateTime } from "@/lib/format/date";

/**
 * Read-only invoice summary for an invoiced quote (issue #211): invoice
 * number, when it was generated and the email outcome. Only the *persisted*
 * outcome is known here (`invoices.emailed_to/emailed_at/email_error`); a
 * "skipped" send (no invoice contact / address) leaves all three empty, which
 * reads as "not sent".
 */
export function QuoteInvoicePanel({ invoice }: { invoice: InvoiceSummary }) {
  let emailOutcome: React.ReactNode;
  if (invoice.emailedTo) {
    emailOutcome = (
      <Text tone="success">
        Sent to {invoice.emailedTo}
        {invoice.emailedAt ? ` on ${formatDateTime(invoice.emailedAt)}` : ""}
      </Text>
    );
  } else if (invoice.emailError) {
    emailOutcome = <Text tone="danger">Failed: {invoice.emailError}</Text>;
  } else {
    emailOutcome = <Text tone="muted">Not sent - no invoice contact or invoice email address was set.</Text>;
  }

  const items: KeyValueListItem[] = [
    { key: "number", label: "Invoice number", value: invoice.invoiceNumber },
    { key: "generated", label: "Generated", value: formatDateTime(invoice.generatedAt) },
    { key: "email", label: "Email", value: emailOutcome },
  ];

  return (
    <Card>
      <Stack gap="sm">
        <SectionHeader icon={Receipt} title="Invoice" />
        <KeyValueList items={items} />
      </Stack>
    </Card>
  );
}
