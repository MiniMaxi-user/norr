import { StatStrip } from "@yourorg/ui";
import { WebCard, WebDataTableEmpty, WebLinkButton, WebListPage } from "@yourorg/ui/web";
import { listClients, type ClientRecord } from "@/app/(app)/clients/actions";
import { formatMoneyWeb } from "@/lib/format/web";
import { listInvoices, type InvoiceKpis } from "../actions";
import { INVOICE_PERIOD_OPTIONS, INVOICES_EXPORT_CSV_URL, parseInvoicesQuery, type InvoicesSearchParams } from "./invoices-query";
import { InvoicesTable } from "./invoices-table";

function Kpis({ kpis, periodLabel }: { kpis: InvoiceKpis; periodLabel: string }) {
  const count = (n: number) => `${n} ${n === 1 ? "invoice" : "invoices"}`;
  return (
    <StatStrip
      compact
      items={[
        { label: "Invoiced in period", value: formatMoneyWeb(kpis.invoicedInPeriod), hint: `${periodLabel} · ${count(kpis.invoicedInPeriodCount)}` },
        { label: "Outstanding", value: formatMoneyWeb(kpis.outstandingAmount), hint: count(kpis.outstandingCount) },
        {
          label: "Overdue",
          value: formatMoneyWeb(kpis.overdueAmount),
          hint: kpis.overdueCount > 0 ? `${count(kpis.overdueCount)} past due date` : "none past due date",
          hintTone: kpis.overdueCount > 0 ? "accent" : "muted",
        },
      ]}
    />
  );
}

/**
 * Data-fetching heart of the Invoices overview (issue #234), rendered inside
 * `Suspense` by `page.tsx`: list-page shell with the KPI header and one
 * server-driven table (`listInvoices`, params in `invoices-query.ts`).
 */
export async function InvoicesScreen({ params }: { params: InvoicesSearchParams }) {
  const { page, period, filters, noMatch } = parseInvoicesQuery(params);

  const [clientsResult, result] = await Promise.all([
    listClients({ limit: 200 }),
    listInvoices(noMatch ? { ...filters, limit: 1 } : filters),
  ]);

  if (!result.data) {
    return (
      <WebListPage module="Invoices" title="Invoices">
        <WebCard title="Invoices">
          <WebDataTableEmpty>{result.error ?? "Could not load invoices."}</WebDataTableEmpty>
        </WebCard>
      </WebListPage>
    );
  }

  const clients: ClientRecord[] = clientsResult.data?.clients ?? [];
  const clientOptions = clients.map((client) => ({ value: client.id, label: client.name }));
  const { invoices, count, kpis } = result.data;
  const exportParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value) exportParams.set(key, value);
  }
  const exportQuery = exportParams.toString();
  const exportHref = exportQuery ? `${INVOICES_EXPORT_CSV_URL}?${exportQuery}` : INVOICES_EXPORT_CSV_URL;
  const periodLabel = INVOICE_PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? "All time";

  return (
    <WebListPage
      module="Invoices"
      title="Invoices"
      count={noMatch ? 0 : count}
      stats={<Kpis kpis={kpis} periodLabel={periodLabel} />}
      actions={
        <WebLinkButton href={exportHref} download>
          Export CSV
        </WebLinkButton>
      }
    >
      <InvoicesTable
        invoices={noMatch ? [] : invoices}
        server={{ total: noMatch ? 0 : count, page, clientOptions }}
      />
    </WebListPage>
  );
}
