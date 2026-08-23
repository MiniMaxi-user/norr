"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@yourorg/ui";
import type { ContractRecord } from "../actions";
import { DeleteContractDialog } from "../components/delete-contract-dialog";

export function ContractDetailActions({
  contract,
  canEdit,
  canDelete,
}: {
  contract: ContractRecord;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      {canEdit && (
        <Link href={`/contracts/${contract.id}/edit`}>
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

      {deleting && <DeleteContractDialog contract={contract} open onOpenChange={setDeleting} redirectOnDelete />}
    </>
  );
}
