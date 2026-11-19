"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WebBadge, WebCard, WebDataTable, WebInput } from "@yourorg/ui/web";
import { formatDateTimeWeb, formatNumberWeb } from "@/lib/format/web";
import { saveWorkOrderVolumeValue, type WorkOrderVolumeRow } from "../volume-actions";

export interface WorkOrderVolumesChecklistProps {
  workOrderId: string;
  rows: WorkOrderVolumeRow[];
  /** Owner/planner (`asset_volumes` create + delete) and not checked out in the field. */
  canEdit: boolean;
}

const REASON_TEXT: Record<string, string> = {
  below_previous: "Lower than an earlier reading",
  above_next: "Higher than a later reading",
};

const AUTOSAVE_DELAY_MS = 900;

/**
 * The fixed "Volumes" checklist of the Checklist tab (issue #230): one row per
 * counter of the asset model with the value registered on THIS work order.
 * Not editable as a list (no add/remove) — only the values. Editing has no
 * Save button: the integer field saves on blur, on Enter and shortly after the
 * last keystroke, and replaces this work order's reading for the counter.
 */
export function WorkOrderVolumesChecklist({ workOrderId, rows, canEdit }: WorkOrderVolumesChecklistProps) {
  const filled = rows.filter((row) => row.value !== null).length;
  const flagged = rows.filter((row) => row.needsReview).length;

  return (
    <WebCard
      title="Volumes"
      meta={flagged > 0 ? `${filled} / ${rows.length} filled · ${flagged} need review` : `${filled} / ${rows.length} filled`}
    >
      <WebDataTable>
        <thead>
          <tr>
            <th scope="col">Counter</th>
            <th scope="col">Value</th>
            <th scope="col">Previous reading</th>
            <th scope="col">Entered</th>
            <th scope="col">Review</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <VolumeRow key={row.volumeItemId} workOrderId={workOrderId} row={row} canEdit={canEdit} />
          ))}
        </tbody>
      </WebDataTable>
    </WebCard>
  );
}

function VolumeRow({ workOrderId, row, canEdit }: { workOrderId: string; row: WorkOrderVolumeRow; canEdit: boolean }) {
  const router = useRouter();
  const inputId = `wo-volume-${row.volumeItemId}`;
  const serverText = row.value === null ? "" : String(row.value);
  const [draft, setDraft] = useState(serverText);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(serverText);
  const draftRef = useRef(serverText);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Follow fresh server data, but never clobber what is being typed.
  useEffect(() => {
    savedRef.current = serverText;
    if (document.activeElement !== inputRef.current) {
      draftRef.current = serverText;
      setDraft(serverText);
    }
  }, [serverText]);

  // Leaving the page (tab switch, navigation) with a debounced edit still
  // pending must not drop it: flush it by firing the save. commitRef always
  // points at the latest commit (it only reads refs and stable props).
  const commitRef = useRef<() => Promise<void>>(async () => {});
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void commitRef.current();
      }
    },
    [],
  );

  async function commit() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) return;
    const text = draftRef.current.trim();
    if (text === savedRef.current) {
      setError(null);
      return;
    }
    if (text === "") return; // clearing is not a save; the previous value stays
    if (!/^\d{1,12}$/.test(text)) {
      setError("Enter a whole number.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    const result = await saveWorkOrderVolumeValue({ workOrderId, volumeItemId: row.volumeItemId, value: text });
    inFlight.current = false;
    setSaving(false);
    if (!result.data) {
      setError(result.error ?? "Could not save the value.");
      return;
    }
    savedRef.current = String(Number(text));
    router.refresh();
    // Typed further while saving: save that too.
    if (draftRef.current.trim() !== savedRef.current && draftRef.current.trim() !== "") void commit();
  }

  commitRef.current = commit;

  function onChange(next: string) {
    draftRef.current = next;
    setDraft(next);
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void commit(), AUTOSAVE_DELAY_MS);
  }

  const label = row.unitLabel ? `${row.label} (${row.unitLabel})` : row.label;
  const reason = row.reviewReason ? REASON_TEXT[row.reviewReason] : null;

  return (
    <tr>
      <td>
        <label htmlFor={inputId}>{label}</label>
      </td>
      <td>
        {canEdit ? (
          <>
            <WebInput
              id={inputId}
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={draft}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
              onChange={(event) => onChange(event.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commit();
                }
              }}
            />
            {saving ? <span aria-live="polite"> Saving…</span> : null}
            {error ? (
              <div id={`${inputId}-error`} className="web-field-message" role="alert">
                <span className="web-error-mark" aria-hidden="true">
                  !
                </span>
                {error}
              </div>
            ) : null}
          </>
        ) : row.value !== null ? (
          formatNumberWeb(row.value)
        ) : (
          "Not entered"
        )}
      </td>
      <td>
        {row.previousValue !== null
          ? `${formatNumberWeb(row.previousValue)}${row.previousReadAt ? ` · ${formatDateTimeWeb(row.previousReadAt)}` : ""}`
          : "—"}
      </td>
      <td>
        {row.readAt
          ? `${row.enteredByName ? `${row.enteredByName} · ` : ""}${formatDateTimeWeb(row.readAt)}`
          : "—"}
      </td>
      <td>
        {row.needsReview ? (
          <>
            <WebBadge variant="warning">Needs review</WebBadge>
            {reason ? ` ${reason}` : ""}
          </>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}
