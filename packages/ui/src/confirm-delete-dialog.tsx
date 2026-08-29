"use client";
// Genuinely interactive (owns checking/error/deleting state), so — same as
// client.tsx/tabs.tsx/toast.tsx/combobox.tsx — it needs its OWN dedicated
// "use client" tsup build entry rather than living in the hook-free main
// index.js bundle Server Components import; see tsup.config.ts's
// top-of-file comment for the full "why a sibling file, not inlined into
// index.ts" story. Lives at the top level of `src/` (not under
// `src/components/`), same as those four — required, not just cosmetic,
// per that same comment.

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Button } from "./components/button";
import { Dialog, type DialogSize } from "./components/dialog";
import { Heading } from "./components/typography";
import { Stack } from "./components/stack";
import { Text } from "./components/typography";
import { useEscapeToClose } from "./use-escape-to-close";

export interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: DialogSize;
  title: ReactNode;
  /**
   * Optional: runs once whenever the dialog opens (and whenever `checkKey`
   * changes while it's open) to look up whether deleting this record would
   * cascade-delete related records — e.g. a client's sites/assets. While
   * pending, `checkingMessage` is shown. Once resolved, `message` replaces
   * it (typically "This will also delete N related records." or "This
   * record has no related X. This action cannot be undone."); `error`
   * instead surfaces the same way a delete failure does, but — matching
   * every dialog this replaced — does NOT block the delete button, since a
   * failed dependency check is informational, not a validation gate.
   * Omit entirely for a plain "cannot be undone" confirm with no check.
   */
  checkDependencies?: () => Promise<{ message?: ReactNode; error?: string }>;
  /** Include the record's own id (or any other value that should re-run
   * `checkDependencies`) so re-opening for a different record re-checks
   * instead of showing the previous record's stale result. */
  checkKey?: string | number | null;
  checkingMessage?: ReactNode;
  /** Shown immediately (no checking phase) when `checkDependencies` is
   * omitted. Defaults to "This action cannot be undone." */
  fallbackMessage?: ReactNode;
  /** Perform the actual delete. Return `{ error }` on failure (any falsy
   * `error` — including omitting it — is treated as success). */
  onConfirm: () => Promise<{ error?: string }>;
  /** Called after a successful delete, once the dialog has already closed
   * itself — e.g. to `router.refresh()` or navigate away. Not this
   * component's job to know about routing. */
  onDeleted?: () => void;
  /** e.g. "Delete client" / "Delete site" / "Delete contact". */
  confirmLabel: string;
  deletingLabel?: ReactNode;
}

/**
 * Shared delete-confirmation dialog (issue #77) — replaces three near-
 * identical hand-rolled copies in the Clients module (client, site, and
 * contact delete dialogs), which differed only in their title, whether they
 * ran a dependency check first, and their button label.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  size = "sm",
  title,
  checkDependencies,
  checkKey,
  checkingMessage = "Checking related records…",
  fallbackMessage = "This action cannot be undone.",
  onConfirm,
  onDeleted,
  confirmLabel,
  deletingLabel = "Deleting…",
}: ConfirmDeleteDialogProps) {
  useEscapeToClose(open, onOpenChange);

  const [dependencyMessage, setDependencyMessage] = useState<ReactNode>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, startChecking] = useTransition();
  const [isDeleting, startDeleting] = useTransition();

  useEffect(() => {
    if (!open || !checkDependencies) {
      setDependencyMessage(null);
      setError(null);
      return;
    }
    setError(null);
    startChecking(async () => {
      const result = await checkDependencies();
      if (result.error) {
        setError(result.error);
        return;
      }
      setDependencyMessage(result.message ?? null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, checkKey]);

  function handleDelete() {
    startDeleting(async () => {
      const result = await onConfirm();
      if (result.error) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      onDeleted?.();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size={size}>
      <Dialog.Header>
        <Heading level={3}>{title}</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          {error && <Text tone="danger">{error}</Text>}
          {checkDependencies ? (
            isChecking ? (
              <Text tone="muted">{checkingMessage}</Text>
            ) : (
              dependencyMessage
            )
          ) : (
            <Text tone="muted">{fallbackMessage}</Text>
          )}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={handleDelete} disabled={isDeleting || isChecking}>
          {isDeleting ? deletingLabel : confirmLabel}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
