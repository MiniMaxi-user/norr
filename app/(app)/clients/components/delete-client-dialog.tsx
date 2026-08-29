"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog, Text } from "@yourorg/ui";
import { deleteClient, getClientDependencyCounts, type ClientRecord } from "../actions";

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

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${client?.name ?? "client"}?`}
      checkKey={client?.id ?? null}
      checkingMessage="Checking related sites and assets…"
      checkDependencies={async () => {
        if (!client) return { message: null };
        const result = await getClientDependencyCounts(client.id);
        if (result.error || !result.data) {
          return { error: result.error ?? "Could not check related sites and assets." };
        }
        const { sites, assets } = result.data;
        if (sites > 0 || assets > 0) {
          return {
            message: (
              <Text tone="danger">
                This client has {sites} site{sites === 1 ? "" : "s"} and {assets} asset{assets === 1 ? "" : "s"}.
                Deleting this client will permanently delete all of them too. This cannot be undone.
              </Text>
            ),
          };
        }
        return { message: <Text tone="muted">This client has no sites or assets. This action cannot be undone.</Text> };
      }}
      onConfirm={async () => {
        if (!client) return { error: "No client selected." };
        const result = await deleteClient(client.id);
        return { error: result.error };
      }}
      onDeleted={() => {
        onDeleted?.();
        router.refresh();
      }}
      confirmLabel="Delete client"
    />
  );
}
