import { WebCard, WebDataTableEmpty, WebFigures, WebListPage } from "@yourorg/ui/web";
import { listClients, type ClientRecord } from "@/app/(app)/clients/actions";
import { formatMoneyWeb } from "@/lib/format/web";
import { listInvoices, type InvoiceKpis } from "../actions";
import { INVOICE_PERIOD_OPTIONS, parseInvoicesQuery, type InvoicesSearchParams } from "./invoices-query";
import { InvoicesTable } from "./invoices-table";

function Kpis({ kpis, periodLabel }: { kpis: InvoiceKpis; periodLabel: string }) {
  const count = (n: number) => `${n} ${n === 1 ? "invoice" : "invoices"}`;
  return (
    <WebFigures
      items={[
        { label: "Invoiced in period", value: formatMoneyWeb(kpis.invoicedInPeriod), hint: `${periodLabel} · ${count(kpis.invoicedInPeriodCount)}` },
        { label: "Outstanding", value: formatMoneyWeb(kpis.outstandingAmount), hint: count(kpis.outstandingCount) },
        { label: "Overdue", value: formatMoneyWeb(kpis.overdueAmount), hint: count(kpis.overdueCount) },
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
  const periodLabel = INVOICE_PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? "All time";

  return (
    <WebListPage module="Invoices" title="Invoices" count={noMatch ? 0 : count}>
      <Kpis kpis={kpis} periodLabel={periodLabel} />
      <InvoicesTable
        invoices={noMatch ? [] : invoices}
        server={{ total: noMatch ? 0 : count, page, clientOptions }}
      />
    </WebListPage>
  );
}
