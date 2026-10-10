"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Stack, Text, useEscapeToClose } from "@yourorg/ui";
import { generateContractQuotes, type GenerateContractQuotesResult } from "../contract-quote-actions";

/**
 * "Generate contract quotes" (issue #210): confirm dialog, then shows the
 * outcome (created / skipped counts + per-contract errors) in the same
 * dialog and refreshes the list when it is dismissed.
 */
export function GenerateContractQuotesButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GenerateContractQuotesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (running) return;
    setOpen(next);
    if (!next) {
      if (result) router.refresh();
      setResult(null);
      setError(null);
    }
  }

  useEscapeToClose(open, handleOpenChange);

  async function handleGenerate() {
    setRunning(true);
    setError(null);
    const response = await generateContractQuotes();
    setRunning(false);
    if (!response.data) {
      setError(response.error ?? "Could not generate contract quotes.");
      return;
    }
    setResult(response.data);
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Generate contract quotes
      </Button>

      {open && (
        <Dialog open onOpenChange={handleOpenChange} size="sm">
          <Dialog.Header>
            <Text>Generate contract quotes</Text>
          </Dialog.Header>
          <Dialog.Body>
            <Stack gap="md">
              {!result && (
                <Text>
                  This creates a draft quote for every contract whose next invoice date is today or earlier. The
                  contract&apos;s next invoice date is only moved forward once the quote is invoiced.
                </Text>
              )}
              {error && <Text tone="danger">{error}</Text>}
              {result && (
                <Stack gap="sm">
                  <Text tone={result.errors.length > 0 ? undefined : "success"}>
                    Created {result.created}, skipped {result.skipped}
                    {result.errors.length > 0 ? `, ${result.errors.length} failed` : ""}.
                  </Text>
                  {result.errors.length > 0 && (
                    <Stack gap="xs">
                      {result.errors.map((entry) => (
                        <Text key={entry.contractId} tone="danger">
                          {entry.contractName}: {entry.error}
                        </Text>
                      ))}
                    </Stack>
                  )}
                </Stack>
              )}
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            {result ? (
              <Button type="button" variant="primary" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={running}>
                  Cancel
                </Button>
                <Button type="button" variant="primary" onClick={handleGenerate} disabled={running}>
                  {running ? "Generating…" : "Generate"}
                </Button>
              </>
            )}
          </Dialog.Footer>
        </Dialog>
      )}
    </>
  );
}
