"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, toast } from "@yourorg/ui";
import type { WorkOrderRecord } from "../actions";
import { DeleteWorkOrderDialog } from "../components/delete-work-order-dialog";
import { createQuoteFromWorkOrder } from "../create-quote-actions";

/**
 * Toolbar actions for the work order detail page. Issue #89 removed the
 * "Edit" button that used to link to the now-deleted `/work-orders/[id]/edit`
 * route — editing is inline on this same page now (see `page.tsx`'s
 * `WorkOrderFields` usage, gated on that same `canEdit`), so there is no
 * separate edit destination left to link to. Delete stays exactly as before.
 *
 * "Maak Quote" (issue #94) added alongside Delete, same hero-actions
 * placement tier — a work order's own primary action bar, not a separate
 * section. Calls `createQuoteFromWorkOrder` (`../create-quote-actions.ts`)
 * directly (a plain async action, not `useActionState` — there's no form
 * here, just a button) and, on success, navigates to the new quote
 * (`/quotes/{id}`, matching `QuoteForm`'s own post-create redirect in
 * `../../quotes/components/quote-form.tsx`).
 *
 * This toolbar has no room for an inline error banner the way a `Dialog`
 * body does (see `ConfirmDeleteDialog`'s own `error` state, surfaced inside
 * its `Dialog.Body`) — a `toast()` (this codebase's first real caller, see
 * `app/layout.tsx`'s newly-mounted `ToastProvider`) is used for BOTH a
 * failed create AND the success-with-caveat case: when
 * `skippedTimeEntryIds` comes back non-empty, a danger-toned toast surfaces
 * "N time entries could not be priced" — deliberately AFTER the redirect
 * already fires, since a toast (unlike an inline banner on this page)
 * survives navigation, which an inline error never could for a message that
 * needs to still be visible on the quote page the user just landed on.
 */
export function WorkOrderDetailActions({
  workOrder,
  canDelete,
  canCreateQuote,
}: {
  workOrder: WorkOrderRecord;
  canDelete: boolean;
  canCreateQuote: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [isCreatingQuote, startCreatingQuote] = useTransition();

  function handleCreateQuote() {
    startCreatingQuote(async () => {
      const result = await createQuoteFromWorkOrder(workOrder.id);
      if (!result.data) {
        toast({
          tone: "danger",
          title: "Could not create a quote",
          description: result.error ?? "Something went wrong.",
        });
        return;
      }
      const { quoteId, skippedTimeEntryIds } = result.data;
      if (skippedTimeEntryIds.length > 0) {
        toast({
          tone: "danger",
          title: "Some time entries were left off this quote",
          description: `${skippedTimeEntryIds.length} time ${skippedTimeEntryIds.length === 1 ? "entry" : "entries"} could not be priced (no rate configured for that engineer or client) and ${skippedTimeEntryIds.length === 1 ? "was" : "were"} not added to the quote. Set a rate under Settings > Team or on the client, then add ${skippedTimeEntryIds.length === 1 ? "it" : "them"} manually if needed.`,
          duration: 0,
        });
      } else {
        toast({ tone: "success", title: "Quote created", description: workOrder.title });
      }
      router.push(`/quotes/${quoteId}`);
    });
  }

  return (
    <>
      {canCreateQuote && (
        <Button type="button" variant="primary" onClick={handleCreateQuote} disabled={isCreatingQuote}>
          {isCreatingQuote ? "Creating quote…" : "Create Quote"}
        </Button>
      )}

      {canDelete && (
        <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
          Delete
        </Button>
      )}

      {deleting && <DeleteWorkOrderDialog workOrder={workOrder} open onOpenChange={setDeleting} redirectOnDelete />}
    </>
  );
}
