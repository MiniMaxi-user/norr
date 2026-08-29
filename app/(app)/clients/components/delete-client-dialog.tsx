"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
import { deleteClient, getClientDependencyCounts, type ClientRecord } from "../actions";
import { useEscapeToClose } from "../use-escape-to-close";

/**
 * Delete confirmation for a client. Calls `getClientDependencyCounts` first
 * (per the task spec) so the warning accurately reflects the cascade —
 * `sites`/`assets` both have `on delete cascade` onto `clients` at the DB
 * level (see the doc comment on `deleteClient` in `./actions.ts`).
 */
export function DeleteClientDialog({
  open,
  onOpenChange,
  client,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientRecord | null;
  /** Called after a successful delete, in addition to `router.refresh()` —
   * e.g. the detail page uses this to navigate back to `/clients` since the
   * record it was showing no longer exists. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  const [counts, setCounts] = useState<{ sites: number; assets: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCheckingCounts, startCheckingCounts] = useTransition();
  const [isDeleting, startDeleting] = useTransition();

  useEffect(() => {
    if (!open || !client) {
      setCounts(null);
      setError(null);
      return;
    }
    const clientId = client.id;
    startCheckingCounts(async () => {
      const result = await getClientDependencyCounts(clientId);
      if (result.error || !result.data) {
        setError(result.error ?? "Could not check related sites and assets.");
        return;
      }
      setCounts(result.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.id]);

  function handleDelete() {
    if (!client) return;
    const clientId = client.id;
    startDeleting(async () => {
      const result = await deleteClient(clientId);
      if (result.error || !result.data) {
        setError(result.error ?? "Could not delete this client.");
        return;
      }
      onOpenChange(false);
      onDeleted?.();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Delete {client?.name ?? "client"}?</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          {error && <Text tone="danger">{error}</Text>}
          {isCheckingCounts && <Text tone="muted">Checking related sites and assets…</Text>}
          {!isCheckingCounts && counts && (counts.sites > 0 || counts.assets > 0) && (
            <Text tone="danger">
              This client has {counts.sites} site{counts.sites === 1 ? "" : "s"} and {counts.assets} asset
              {counts.assets === 1 ? "" : "s"}. Deleting this client will permanently delete all of them too. This
              cannot be undone.
            </Text>
          )}
          {!isCheckingCounts && counts && counts.sites === 0 && counts.assets === 0 && (
            <Text tone="muted">This client has no sites or assets. This action cannot be undone.</Text>
          )}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={handleDelete} disabled={isDeleting || isCheckingCounts}>
          {isDeleting ? "Deleting…" : "Delete client"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
