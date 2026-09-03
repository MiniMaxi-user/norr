"use client";

import { useState } from "react";
import { Button } from "@yourorg/ui";
import type { QuoteRecord } from "../actions";
import type { InvoiceSummary } from "../invoice-actions";
import { DeleteQuoteDialog } from "../components/delete-quote-dialog";
import { QuoteInvoiceActions } from "./quote-invoice-actions";

/**
 * Hero-band actions for the Quote detail page — the invoicing cluster
 * (issue #119, `./quote-invoice-actions.tsx`) plus the quote's own Delete.
 * The old Edit link to `/quotes/[id]/edit` is gone (Pattern A migration):
 * the quote's own header fields (name/client/site/valid-until/notes) are
 * all inline-editable directly on the detail page now, same "no separate
 * edit route once a detail page has room for its own fields" precedent
 * `docs/ARCHITECTURE.md`'s "Popup vs. full page" section documents for Work
 * Orders (issue #89) — see `quote-detail.tsx`'s own doc comment.
 */
export function QuoteDetailActions({
  quote,
  canDelete,
  invoice,
  canGenerateInvoice,
  canDeleteInvoice,
}: {
  quote: QuoteRecord;
  canDelete: boolean;
  invoice: InvoiceSummary | null;
  canGenerateInvoice: boolean;
  canDeleteInvoice: boolean;
}) {
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <QuoteInvoiceActions
        quoteId={quote.id}
        invoice={invoice}
        canGenerate={canGenerateInvoice}
        canDelete={canDeleteInvoice}
      />

      {canDelete && (
        <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
          Delete
        </Button>
      )}

      {deleting && <DeleteQuoteDialog quote={quote} open onOpenChange={setDeleting} redirectOnDelete />}
    </>
  );
}
