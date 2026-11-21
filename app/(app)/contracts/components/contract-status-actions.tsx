"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { WebConfirmDialog } from "@yourorg/ui/web-client";
import { setContractStatus, type ContractRecord, type MissingBaselineReading } from "../actions";
import { DialogField } from "../../settings/components/settings-dialog-kit";
import { todayIso } from "./contract-draft";

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
 * Header action of the Contract page (issue #270): Draft -> "Activate" (navy),
 * Active -> "End contract" (confirm dialog asking the end date, default
 * today), Ended -> "Reactivate". Returns
 * the button for `PageHeader`'s `primary` slot plus the dialogs to render once.
 * A refused activation (missing baseline readings) opens a dialog listing each
 * missing asset / counter; any other refusal is a toast with the server's text.
 */
export function useContractStatusActions({ contract, canUpdate }: UseContractStatusActionsOptions): {
  button: ReactNode;
  dialogs: ReactNode;
} {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [missing, setMissing] = useState<MissingBaselineReading[] | null>(null);
  const [missingMessage, setMissingMessage] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
  const [endDate, setEndDate] = useState("");

  async function change(target: "active" | "ended") {
    setPending(true);
    const result = await setContractStatus(contract.id, target, target === "ended" ? { endDate } : {});
    setPending(false);
    if (!result.data) {
      const message = result.error ?? "Could not change the contract status.";
      if (target === "ended") setEndError(message);
      else toast({ title: "Status not changed", description: message, tone: "danger", duration: 6000 });
      return;
    }
    if (!result.data.changed) {
      setMissing(result.data.missingBaseline);
      setMissingMessage(result.data.message);
      router.refresh();
      return;
    }
    setEndOpen(false);
    toast({ title: target === "active" ? "Contract activated" : "Contract ended", tone: "success", duration: 3000 });
    router.refresh();
  }

  let button: ReactNode = null;
  if (canUpdate) {
    if (contract.status === "draft") {
      button = (
        <WebButton variant="primary" loading={pending} onClick={() => void change("active")}>
          Activate
        </WebButton>
      );
    } else if (contract.status === "active") {
      button = (
        <WebButton
          onClick={() => {
            setEndError(null);
            setEndDate(todayIso());
            setEndOpen(true);
          }}
        >
          End contract
        </WebButton>
      );
    } else {
      button = (
        <WebButton loading={pending} onClick={() => void change("active")}>
          Reactivate
        </WebButton>
      );
    }
  }

  const dialogs = (
    <>
      <WebConfirmDialog
        open={endOpen}
        title="End contract"
        confirmLabel="End contract"
        pending={pending}
        error={endError}
        onCancel={() => setEndOpen(false)}
        onConfirm={() => void change("ended")}
      >
        <p>
          <strong>{contract.contract_number}</strong> will no longer be invoiced for new periods and stops giving
          coverage on work orders. After the end date a final counter settlement is generated when it applies. You can
          reactivate it until its end date has passed.
        </p>
        <DialogField id="contract-end-date" label="End date">
          <input
            id="contract-end-date"
            type="date"
            className="web-input"
            value={endDate}
            min={contract.start_date}
            onChange={(event) => setEndDate(event.target.value)}
            required
          />
        </DialogField>
      </WebConfirmDialog>
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

  return { button, dialogs };
}
