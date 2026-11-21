import Link from "next/link";
import { WebCard, WebDataTable, WebHint } from "@yourorg/ui/web";
import { formatDateWeb, formatMoneyWeb, formatNumberWeb } from "@/lib/format/web";
import type { ContractFinalBalanceSummary } from "../end-actions";

export interface ContractFinalBalanceCardProps {
  summary: ContractFinalBalanceSummary;
  /** The viewer can open the Quotes module (the final quote link only renders then). */
  canSeeQuotes: boolean;
}

/**
 * Read-only "Final balance" card of an Ended contract (issue #271): the final
 * settlement quote (link, total, invoice number) and, per settled counter
 * window, what was included, used and billed or credited.
 */
export function ContractFinalBalanceCard({ summary, canSeeQuotes }: ContractFinalBalanceCardProps) {
  const { finalQuote, settlements } = summary;
  const counterRows = settlements.flatMap((entry) =>
    entry.details.map((detail, index) => ({ entry, detail, key: `${entry.id}-${index}` })),
  );

  return (
    <WebCard title="Final balance">
      {finalQuote ? (
        <p className="web-dialog-text">
          Final settlement quote{" "}
          {canSeeQuotes ? <Link href={`/quotes/${finalQuote.id}`}>{finalQuote.quoteNumber ?? finalQuote.name}</Link> : (finalQuote.quoteNumber ?? finalQuote.name)}
          {": "}
          <strong>{formatMoneyWeb(finalQuote.total)}</strong> excl. VAT
          {finalQuote.invoiceNumber ? `, invoiced as ${finalQuote.invoiceNumber}` : ", not invoiced yet"}.
        </p>
      ) : (
        <p className="web-dialog-text">
          The final balance was settled without a quote: there was nothing left to invoice, credit or settle.
        </p>
      )}
      {counterRows.length > 0 ? (
        <WebDataTable>
          <thead>
            <tr>
              <th scope="col">Window</th>
              <th scope="col">Counter</th>
              <th scope="col" data-numeric="true">
                Included
              </th>
              <th scope="col" data-numeric="true">
                Used
              </th>
              <th scope="col" data-numeric="true">
                Overage
              </th>
              <th scope="col" data-numeric="true">
                Under-use credited
              </th>
            </tr>
          </thead>
          <tbody>
            {counterRows.map(({ entry, detail, key }) => (
              <tr key={key}>
                <td>
                  {formatDateWeb(entry.periodStart)} – {formatDateWeb(entry.periodEnd)}
                </td>
                <td>{detail.counterLabel}</td>
                <td data-numeric="true">{formatNumberWeb(detail.included)}</td>
                <td data-numeric="true">{formatNumberWeb(detail.usage)}</td>
                <td data-numeric="true">{formatNumberWeb(detail.overage)}</td>
                <td data-numeric="true">{formatNumberWeb(detail.creditedUnderUse)}</td>
              </tr>
            ))}
          </tbody>
        </WebDataTable>
      ) : null}
      {counterRows.some(({ detail }) => detail.warnings.length > 0) ? (
        <ul className="web-dialog-text">
          {counterRows.flatMap(({ detail, key }) => detail.warnings.map((warning, index) => <li key={`${key}-w${index}`}>{warning}</li>))}
        </ul>
      ) : null}
      <WebHint>This summary is read-only. Nothing more is generated for this contract.</WebHint>
    </WebCard>
  );
}
