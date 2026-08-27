"use client";

import { useState } from "react";
import { Button, Dialog, Heading, Stack, Text } from "@yourorg/ui";
import type { ContactRecord } from "../contacts-actions";
import { disableTenantAccess } from "../platform-access-actions";

/**
 * Confirmation dialog behind the Access tab's "Disable access" button
 * (issue #48). Mirrors `DeleteContactDialog`'s shape (plain confirm, no
 * dependency check) rather than being inlined in `AccessPanel` — same
 * per-action-dialog convention as every other `delete-*-dialog.tsx` in this
 * app, even though this one revokes rather than deletes a row.
 */
export function DisableAccessDialog({
  open,
  onOpenChange,
  clientId,
  contact,
  onDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  contact: ContactRecord | null;
  /** Lets `AccessPanel` update its local status map without a full page
   * refresh — this tab's data is server-fetched once per mount (see
   * `AccessPanelProps.statusByEmail`'s comment), so there's no `router
   * .refresh()`-driven re-fetch to lean on here. */
  onDisabled: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isDisabling, setIsDisabling] = useState(false);

  async function handleDisable() {
    if (!contact?.email) return;
    setIsDisabling(true);
    setError(null);
    const result = await disableTenantAccess(clientId, contact.email);
    setIsDisabling(false);
    if (result.error || !result.data) {
      setError(result.error ?? "Could not disable access.");
      return;
    }
    onDisabled();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Disable access for {contact?.name ?? "this contact"}?</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          {error && <Text tone="danger">{error}</Text>}
          <Text tone="muted">
            They will no longer be able to log in to this client&apos;s account. You can grant access again at any
            time via Request access.
          </Text>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isDisabling}>
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={handleDisable} disabled={isDisabling}>
          {isDisabling ? "Disabling…" : "Disable access"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
