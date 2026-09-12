"use client";

import { useRef, useState } from "react";
import { Button, Card, KeyValueList, Stack, Text } from "@yourorg/ui";
import { formatClockHoursMinutes, type ClockSummary } from "@/lib/time/clocks";
import type { LocalSignOff } from "@/lib/offline/db";
import { SignaturePad, type SignaturePadHandle } from "../signature-pad";

/**
 * The "Sign off" tab (issue #170, IMPLEMENTATION.md §4) — a summary
 * (hours/articles/engineer), the signature canvas, `Clear`, and one
 * primary action whose label/style change with whether a signature has
 * been drawn yet: `"Finish work order"` (default/outline) while the canvas
 * is empty, `"Send work receipt"` (accent) once it isn't. Both are the SAME
 * action underneath — closing this order's running clock and, when a
 * signature exists, recording the local sign-off — the copy just tells the
 * engineer which of those two things is about to happen. This mapping
 * isn't spelled out any more explicitly than that one sentence in
 * IMPLEMENTATION.md §4, so it's a deliberate reading of an otherwise
 * slightly underspecified point: a job with no signature can still be
 * "finished" (clock closed, back to Today), it just isn't a signed-off
 * receipt.
 */
export function SignOffSection({
  summary,
  articleCount,
  engineerName,
  existingSignOff,
  onFinish,
}: {
  summary: ClockSummary;
  articleCount: number;
  engineerName: string;
  existingSignOff: LocalSignOff | null;
  onFinish: (signatureDataUrl: string | null) => void | Promise<void>;
}) {
  const padRef = useRef<SignaturePadHandle>(null);
  const [hasSignature, setHasSignature] = useState(Boolean(existingSignOff));
  const [submitting, setSubmitting] = useState(false);

  async function handlePrimaryAction() {
    setSubmitting(true);
    try {
      const dataUrl = padRef.current?.toDataUrl() ?? null;
      await onFinish(dataUrl);
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
          initialDataUrl={existingSignOff?.signatureDataUrl ?? null}
          onHasSignatureChange={setHasSignature}
        />
        <Button variant="ghost" onClick={() => padRef.current?.clear()} style={{ minHeight: 44, alignSelf: "flex-start" }}>
          Clear
        </Button>
      </Stack>

      <Button
        variant={hasSignature ? "primary" : "outline"}
        fullWidth
        disabled={submitting}
        onClick={() => void handlePrimaryAction()}
        style={{ minHeight: 44 }}
      >
        {submitting ? "Saving…" : hasSignature ? "Send work receipt" : "Finish work order"}
      </Button>
    </Stack>
  );
}
