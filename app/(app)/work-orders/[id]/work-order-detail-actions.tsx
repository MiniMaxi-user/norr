"use client";

import { useState } from "react";
import { Button } from "@yourorg/ui";
import type { WorkOrderRecord } from "../actions";
import { DeleteWorkOrderDialog } from "../components/delete-work-order-dialog";

/**
 * Toolbar actions for the work order detail page. Issue #89 removed the
 * "Edit" button that used to link to the now-deleted `/work-orders/[id]/edit`
 * route — editing is inline on this same page now (see `page.tsx`'s
 * `WorkOrderFields` usage, gated on that same `canEdit`), so there is no
 * separate edit destination left to link to. Delete stays exactly as before.
 */
export function WorkOrderDetailActions({
  workOrder,
  canDelete,
}: {
  workOrder: WorkOrderRecord;
  canDelete: boolean;
}) {
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      {canDelete && (
        <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
          Delete
        </Button>
      )}

      {deleting && <DeleteWorkOrderDialog workOrder={workOrder} open onOpenChange={setDeleting} redirectOnDelete />}
    </>
  );
}
