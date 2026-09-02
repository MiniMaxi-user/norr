"use client";

import { useState } from "react";
import { Button } from "@yourorg/ui";
import type { QuoteRecord } from "../actions";
import { DeleteQuoteDialog } from "../components/delete-quote-dialog";

/**
 * Hero-band actions for the Quote detail page — Delete only. The old Edit
 * link to `/quotes/[id]/edit` is gone (Pattern A migration): the quote's own
 * header fields (name/client/site/valid-until/notes) are all inline-editable
 * directly on the detail page now, same "no separate edit route once a
 * detail page has room for its own fields" precedent
 * `docs/ARCHITECTURE.md`'s "Popup vs. full page" section documents for Work
 * Orders (issue #89) — see `quote-detail.tsx`'s own doc comment.
 */
export function QuoteDetailActions({ quote, canDelete }: { quote: QuoteRecord; canDelete: boolean }) {
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      {canDelete && (
        <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
          Delete
        </Button>
      )}

      {deleting && <DeleteQuoteDialog quote={quote} open onOpenChange={setDeleting} redirectOnDelete />}
    </>
  );
}
