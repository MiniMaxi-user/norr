"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Heading, Stack, Text, useEscapeToClose } from "@yourorg/ui";
import { listAssets } from "@/app/(app)/assets/actions";
import { deleteSite, type SiteRecord } from "../actions";
import { formatSiteAddress } from "../format-site-address";

/**
 * Delete confirmation for a site. `./actions.ts` (`deleteSite`'s doc
 * comment) deliberately has no dedicated dependency-count helper for sites
 * the way `getClientDependencyCounts` exists for clients — it points at
 * `listAssets({ siteId })` (`app/(app)/assets/actions.ts`, read-only import,
 * not modifying that module) as the accurate count source instead, since
 * assets are already filterable by `siteId`. `limit: 1` is enough — only
 * the returned `count` is used, not the rows.
 */
export function DeleteSiteDialog({
  open,
  onOpenChange,
  site,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: SiteRecord | null;
}) {
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  const [assetCount, setAssetCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCheckingCount, startCheckingCount] = useTransition();
  const [isDeleting, startDeleting] = useTransition();

  useEffect(() => {
    if (!open || !site) {
      setAssetCount(null);
      setError(null);
      return;
    }
    const siteId = site.id;
    startCheckingCount(async () => {
      const result = await listAssets({ siteId, limit: 1 });
      if (result.error || !result.data) {
        setError(result.error ?? "Could not check related assets.");
        return;
      }
      setAssetCount(result.data.count);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, site?.id]);

  function handleDelete() {
    if (!site) return;
    const siteId = site.id;
    startDeleting(async () => {
      const result = await deleteSite(siteId);
      if (result.error || !result.data) {
        setError(result.error ?? "Could not delete this site.");
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Heading level={3}>Delete {formatSiteAddress(site) ?? "this site"}?</Heading>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="sm">
          {error && <Text tone="danger">{error}</Text>}
          {isCheckingCount && <Text tone="muted">Checking related assets…</Text>}
          {!isCheckingCount && assetCount !== null && assetCount > 0 && (
            <Text tone="danger">
              This site has {assetCount} asset{assetCount === 1 ? "" : "s"}. Deleting this site will permanently
              delete {assetCount === 1 ? "it" : "them"} too. This cannot be undone.
            </Text>
          )}
          {!isCheckingCount && assetCount === 0 && (
            <Text tone="muted">This site has no assets. This action cannot be undone.</Text>
          )}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" variant="danger" onClick={handleDelete} disabled={isDeleting || isCheckingCount}>
          {isDeleting ? "Deleting…" : "Delete site"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
