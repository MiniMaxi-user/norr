"use client";

import { useEffect, useRef, useState } from "react";
import { Callout } from "@yourorg/ui";
import {
  PwaActionBar,
  PwaCardPad,
  PwaKeyValue,
  PwaStack,
  WebButton,
  WebCard,
  WebStatusBadge,
} from "@yourorg/ui/web";
import { AlertTriangle } from "@yourorg/ui/icons";
import { formatClockHoursMinutes, type ClockSummary } from "@/lib/time/clocks";
import type { LocalSignOff } from "@/lib/offline/db";
import type { VolumeProgress } from "@/lib/asset-volumes/progress";
import type { ChecklistProgress } from "@/lib/checklists/use-work-order-checklist";
import { SignaturePad, type SignaturePadHandle } from "../signature-pad";

/** How often the drawn-so-far signature is pushed up to `work-order-
 * detail.tsx`'s lifted `signatureDraft` state (product feedback,
 * 2026-09-13) — frequent enough that switching tabs mid-signature never
 * loses more than a stroke or two, infrequent enough that it's a cheap
 * `canvas.toDataURL()` poll, not a re-render on every pointer-move. */
const SIGNATURE_AUTOSAVE_MS = 500;

/**
 * The "Sign off" tab (issue #170, IMPLEMENTATION.md §4) — a summary
 * (hours/articles/engineer), the signature canvas, `Clear`, and one
 * primary action: `Finish workitem`. Closes this order's running clock,
 * records the local sign-off (when a signature was drawn), and marks the
 * work order `completed` server-side (`POST /api/work-orders/[id]/finish`)
 * before returning to Today — see `work-order-detail.tsx`'s `handleFinish`
 * for the full sequence.
 *
 * Issue #225/#230: finishing requires a Solution, a drawn signature, every
 * required item of the standard checklist ticked ("Checklist: n of m
 * required") and, for every counter of the asset's model, a volume reading on
 * this work order (server or queued locally, "Volumes: n of m"); a missing
 * item jumps to the Checklist tab. A checklist at the top shows what's done/missing (a
 * missing item jumps to the right tab) and the Finish button stays disabled
 * until all of it is met. If the counters were never loaded (offline, no
 * cache) volumes count as unknown and block finishing.
 *
 * Product feedback (2026-09-12) simplified this from the original
 * two-label design (`"Finish work order"` while unsigned, `"Send work
 * receipt"` once signed, same action either way) to one constant label —
 * finishing now always does the same real thing (mark the order completed,
 * go back to Today), so the label no longer needs to describe which of two
 * things is about to happen. The signed/not-signed state still gets a
 * plain-text line below the canvas (not folded into the button anymore) —
 * a non-canvas-only signal that a signature exists, for anyone who can't
 * see the canvas itself.
 *
 * "Solution" (product feedback, 2026-09-13) moved to the Work tab, under
 * Description — this section no longer owns it, only reads it via
 * `onFinish`'s closure over `work-order-detail.tsx`'s lifted state.
 *
 * The signature itself is autosaved the same lifted-state way (product
 * feedback, 2026-09-13 — it used to vanish on switching tabs away from Sign
 * and back, since `SignaturePad`'s canvas unmounts with this section): every
 * `SIGNATURE_AUTOSAVE_MS`, a fresh `toDataUrl()` snapshot goes up to
 * `signatureDraft`/`onSignatureDraftChange`, and `initialDataUrl` below
 * reads it straight back — so a remount picks up wherever the last snapshot
 * left off, not a blank canvas.
 *
 * Bug report, 2026-09-13: `existingSignOff?.pendingSync` surfaces a "Not
 * synced" badge here too, not just on the Today card — this tab is exactly
 * where an engineer who just tapped Finish while offline would otherwise
 * see nothing explaining why the app didn't seem to do anything.
 */
export function SignOffSection({
  summary,
  articleCount,
  engineerName,
  existingSignOff,
  signatureDraft,
  onSignatureDraftChange,
  onFinish,
  solutionDone,
  volumeProgress,
  checklistProgress,
  onJumpToSection,
}: {
  summary: ClockSummary;
  articleCount: number;
  engineerName: string;
  existingSignOff: LocalSignOff | null;
  signatureDraft: string | null;
  onSignatureDraftChange: (dataUrl: string | null) => void;
  onFinish: (signatureDataUrl: string | null) => void | Promise<void>;
  solutionDone: boolean;
  volumeProgress: VolumeProgress;
  checklistProgress: ChecklistProgress;
  onJumpToSection: (section: "work" | "checklist") => void;
}) {
  const padRef = useRef<SignaturePadHandle>(null);
  const [hasSignature, setHasSignature] = useState(Boolean(signatureDraft || existingSignOff?.signatureDataUrl));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      onSignatureDraftChange(padRef.current?.toDataUrl() ?? null);
    }, SIGNATURE_AUTOSAVE_MS);
    return () => clearInterval(interval);
    // `onSignatureDraftChange` is `work-order-detail.tsx`'s `setSignatureDraft`
    // — stable across renders, so this interval is set up once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const volumesRequired = !volumeProgress.known || volumeProgress.total > 0;
  const volumesDone = volumeProgress.known && volumeProgress.complete;
  // Issue #230: only is_required items of the standard checklist count.
  const checklistRequired = checklistProgress.present && checklistProgress.total > 0;
  const canFinish =
    solutionDone &&
    hasSignature &&
    checklistProgress.complete &&
    (volumeProgress.known ? volumeProgress.complete : false);

  async function handlePrimaryAction() {
    setSubmitting(true);
    setError(null);
    try {
      const dataUrl = padRef.current?.toDataUrl() ?? null;
      await onFinish(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't finish this work order.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PwaStack>
        <WebCard size="touch" title="Before you can finish">
          <PwaCardPad>
            <div className="pwa-pick-list">
              <ChecklistRow label="Solution" done={solutionDone} onOpen={() => onJumpToSection("work")} />
              <ChecklistRow label="Signature" done={hasSignature} />
              {checklistRequired && (
                <ChecklistRow
                  label={`Checklist: ${checklistProgress.done} of ${checklistProgress.total} required`}
                  done={checklistProgress.complete}
                  onOpen={() => onJumpToSection("checklist")}
                />
              )}
              {volumesRequired && (
                <ChecklistRow
                  label={volumeProgress.known ? `Volumes: ${volumeProgress.done} of ${volumeProgress.total}` : "Volumes"}
                  done={volumesDone}
                  onOpen={volumeProgress.known ? () => onJumpToSection("checklist") : undefined}
                />
              )}
            </div>
            {!volumeProgress.known && (
              <Callout icon={AlertTriangle}>Open this work order once while online to load its counters.</Callout>
            )}
          </PwaCardPad>
        </WebCard>

        <WebCard size="touch" title="Summary">
          <PwaKeyValue
            rows={[
              { label: "Work", value: formatClockHoursMinutes(summary.workMs) },
              { label: "Travel", value: formatClockHoursMinutes(summary.travelMs) },              { label: "Articles", value: articleCount },
              { label: "Engineer", value: engineerName },
            ]}
          />
        </WebCard>

        <WebCard size="touch" title="Signature">
          <PwaCardPad>
            <div className="pwa-signature">
              <SignaturePad
                ref={padRef}
                initialDataUrl={signatureDraft ?? existingSignOff?.signatureDataUrl ?? null}
                onHasSignatureChange={setHasSignature}
              />
              {!hasSignature && <span className="pwa-signature-hint">Sign here</span>}
            </div>
            <div className="pwa-signature-footer">
              <span className="pwa-row">
                <WebStatusBadge tone={hasSignature ? "success" : "neutral"} size="touch">
                  {hasSignature ? "Signature added" : "No signature yet"}
                </WebStatusBadge>
                {existingSignOff?.pendingSync && (
                  <WebStatusBadge tone="warning" size="touch">
                    Sync pending
                  </WebStatusBadge>
                )}
              </span>
              <WebButton
                size="touch"
                onClick={() => {
                  padRef.current?.clear();
                  onSignatureDraftChange(null);
                }}
              >
                Clear
              </WebButton>
            </div>
          </PwaCardPad>
        </WebCard>

        {error && <Callout icon={AlertTriangle}>{error}</Callout>}
      </PwaStack>

      {/* The one primary action of the screen, in the fixed action bar above
          the bottom bar. */}
      <PwaActionBar>
        <WebButton variant="primary" size="touch" block disabled={submitting || !canFinish} onClick={() => void handlePrimaryAction()}>
          {submitting ? "Finishing…" : "Finish workitem"}
        </WebButton>
      </PwaActionBar>
    </>
  );
}

/** One checklist line: a done item is plain; a missing one is a button that
 * jumps to the tab where it can be fixed (when `onOpen` is given). */
function ChecklistRow({ label, done, onOpen }: { label: string; done: boolean; onOpen?: () => void }) {
  const badge = (
    <WebStatusBadge tone={done ? "success" : "warning"} size="touch">
      {done ? "Done" : "Missing"}
    </WebStatusBadge>
  );
  if (done || !onOpen) {
    return (
      <div className="pwa-pick-row">
        <span>{label}</span>
        {badge}
      </div>
    );
  }
  return (
    <button type="button" className="pwa-pick-row" onClick={onOpen}>
      <span>{label}</span>
      {badge}
    </button>
  );
}
