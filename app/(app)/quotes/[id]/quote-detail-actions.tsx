"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@yourorg/ui";
import type { QuoteRecord } from "../actions";
import { DeleteQuoteDialog } from "../components/delete-quote-dialog";

export function QuoteDetailActions({
  quote,
  canEdit,
  canDelete,
}: {
  quote: QuoteRecord;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      {canEdit && (
        <Link href={`/quotes/${quote.id}/edit`}>
          <Button type="button" variant="outline">
            Edit
          </Button>
        </Link>
      )}
      {canDelete && (
        <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
          Delete
        </Button>
      )}

      {deleting && <DeleteQuoteDialog quote={quote} open onOpenChange={setDeleting} redirectOnDelete />}
    </>
  );
}
