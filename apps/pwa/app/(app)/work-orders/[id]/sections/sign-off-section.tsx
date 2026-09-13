"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Callout, Card, Inline, KeyValueList, Stack, Text } from "@yourorg/ui";
import { AlertTriangle } from "@yourorg/ui/icons";
import { formatClockHoursMinutes, type ClockSummary } from "@/lib/time/clocks";
import type { LocalSignOff } from "@/lib/offline/db";
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
 * for the full sequence. A signature is optional, not required to finish.
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
 */
export function SignOffSection({
  summary,
  articleCount,
  engineerName,
  existingSignOff,
  signatureDraft,
  onSignatureDraftChange,
  onFinish,
}: {
  summary: ClockSummary;
  articleCount: number;
  engineerName: string;
  existingSignOff: LocalSignOff | null;
  signatureDraft: string | null;
  onSignatureDraftChange: (dataUrl: string | null) => void;
  onFinish: (signatureDataUrl: string | null) => void | Promise<void>;
}) {
  const padRef = useRef<SignaturePadHandle>(null);
  const [hasSignature, setHasSignature] = useState(Boolean(existingSignOff || signatureDraft));
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

  const totalMs = summary.travelMs + summary.workMs;

  return (
    <Stack gap="md">
      <Card>
        <KeyValueList
          items={[
            { label: "Hours", value: <Text style={{ fontVariantNumeric: "tabular-nums" }}>{formatClockHoursMinutes(totalMs)}</Text> },
            { label: "Articles", value: <Text>{articleCount}</Text> },
            { label: "Engineer", value: <Text>{engineerName}</Text> },
          ]}
        />
      </Card>

      <Stack gap="sm">
        <Text tone="muted">Signature</Text>
        <SignaturePad
          ref={padRef}
          initialDataUrl={signatureDraft ?? existingSignOff?.signatureDataUrl ?? null}
          onHasSignatureChange={setHasSignature}
        />
        <Inline justify="between" align="center">
          <Text tone="muted">{hasSignature ? "Signature added" : "No signature yet"}</Text>
          <Button
            variant="ghost"
            onClick={() => {
              padRef.current?.clear();
              onSignatureDraftChange(null);
            }}
            style={{ minHeight: 44 }}
          >
            Clear
          </Button>
        </Inline>
      </Stack>

      {error && <Callout icon={AlertTriangle}>{error}</Callout>}

      <Button variant="primary" fullWidth disabled={submitting} onClick={() => void handlePrimaryAction()} style={{ minHeight: 44 }}>
        {submitting ? "Finishing…" : "Finish workitem"}
      </Button>
    </Stack>
  );
}
