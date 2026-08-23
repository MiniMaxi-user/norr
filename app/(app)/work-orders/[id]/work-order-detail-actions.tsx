"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@yourorg/ui";
import type { WorkOrderRecord } from "../actions";
import { DeleteWorkOrderDialog } from "../components/delete-work-order-dialog";

export function WorkOrderDetailActions({
  workOrder,
  canEdit,
  canDelete,
}: {
  workOrder: WorkOrderRecord;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      {canEdit && (
        <Link href={`/work-orders/${workOrder.id}/edit`}>
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

      {deleting && <DeleteWorkOrderDialog workOrder={workOrder} open onOpenChange={setDeleting} redirectOnDelete />}
    </>
  );
}
