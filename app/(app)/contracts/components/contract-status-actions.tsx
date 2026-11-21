"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { WebConfirmDialog, type WebMenuItem } from "@yourorg/ui/web-client";
import { setContractStatus, type ContractRecord, type MissingBaselineReading } from "../actions";
import { cancelScheduledContractEnd } from "../end-actions";

/** `Asset – Counter` list; each asset links to the asset's Volumes tab, where
 * the baseline reading is entered. */
export function MissingBaselineList({ missing }: { missing: MissingBaselineReading[] }) {
  return (
    <ul>
      {missing.map((row) => (
        <li key={`${row.assetId}|${row.volumeItemId}`}>
          <Link href={`/assets/${row.assetId}?tab=volumes`}>{row.assetName}</Link> – {row.counterLabel}
        </li>
      ))}
    </ul>
  );
}

export interface UseContractStatusActionsOptions {
  contract: ContractRecord;
  canUpdate: boolean;
}

/**
 * Status actions of the Contract page (issue #270). Draft -> "Activate" is
 * returned as `activate` for the LivePanel (the action the user has to take
 * now); Active -> "End contract" (opens the End contract page, issue #271:
 * end date, closing readings, final balance) and Ended -> "Reactivate" (only
 * while no final settlement quote exists) are `overflow` items for the
 * header's ··· menu, next to Delete. `cancelEnding` undoes a scheduled ending
 * (shown in the LivePanel). Also returns the dialogs to render once.
 * A refused activation (missing baseline readings) opens a dialog listing each
 * missing asset / counter; any other refusal is a toast with the server's text.
 */
export function useContractStatusActions({ contract, canUpdate }: UseContractStatusActionsOptions): {
  activate: () => void;
  cancelEnding: () => void;
  overflow: WebMenuItem[];
  dialogs: ReactNode;
} {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [missing, setMissing] = useState<MissingBaselineReading[] | null>(null);
  const [missingMessage, setMissingMessage] = useState<string | null>(null);

  async function change(target: "active") {
    setPending(true);
    const result = await setContractStatus(contract.id, target);
    setPending(false);
    if (!result.data) {
      const message = result.error ?? "Could not change the contract status.";
      toast({ title: "Status not changed", description: message, tone: "danger", duration: 6000 });
      return;
    }
    if (!result.data.changed) {
      setMissing(result.data.missingBaseline);
      setMissingMessage(result.data.message);
      router.refresh();
      return;
    }
    toast({ title: "Contract activated", tone: "success", duration: 3000 });
    router.refresh();
  }

  const cancelEnding = useCallback(() => {
    if (pending) return;
    setPending(true);
    void cancelScheduledContractEnd(contract.id).then((result) => {
      setPending(false);
      if (!result.data) {
        toast({ title: "Ending not cancelled", description: result.error ?? "Could not cancel the ending.", tone: "danger", duration: 6000 });
        return;
      }
      toast({ title: "Scheduled ending cancelled", tone: "success", duration: 3000 });
      router.refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, contract.id]);

  const activate = useCallback(() => {
    if (!pending) void change("active");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, contract.id]);

  const overflow: WebMenuItem[] = [];
  if (canUpdate) {
    if (contract.status === "active") {
      overflow.push({
        key: "end",
        label: "End contract",
        onSelect: () => router.push(`/contracts/${contract.id}/end`),
      });
    } else if (contract.status === "ended") {
      overflow.push({ key: "reactivate", label: "Reactivate contract", onSelect: () => void change("active") });
    }
  }

  const dialogs = (
    <>
      <WebConfirmDialog
        open={missing !== null}
        title="Baseline readings required"
        confirmLabel="Close"
        cancelLabel="Dismiss"
        onCancel={() => setMissing(null)}
        onConfirm={() => setMissing(null)}
      >
        {missingMessage && (missing?.length ?? 0) === 0 ? (
          missingMessage
        ) : (
          <>
            The contract cannot be activated until these counters have a reading on or before the start date. Open the
            asset to enter it.
            {missing ? <MissingBaselineList missing={missing} /> : null}
          </>
        )}
      </WebConfirmDialog>
    </>
  );

  return { activate, cancelEnding, overflow, dialogs };
}
