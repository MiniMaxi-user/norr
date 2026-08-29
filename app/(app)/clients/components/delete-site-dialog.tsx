"use client";

import { useRouter } from "next/navigation";
import { ConfirmDeleteDialog, Text } from "@yourorg/ui";
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

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${formatSiteAddress(site) ?? "this site"}?`}
      checkKey={site?.id ?? null}
      checkingMessage="Checking related assets…"
      checkDependencies={async () => {
        if (!site) return { message: null };
        const result = await listAssets({ siteId: site.id, limit: 1 });
        if (result.error || !result.data) {
          return { error: result.error ?? "Could not check related assets." };
        }
        const assetCount = result.data.count;
        if (assetCount > 0) {
          return {
            message: (
              <Text tone="danger">
                This site has {assetCount} asset{assetCount === 1 ? "" : "s"}. Deleting this site will permanently
                delete {assetCount === 1 ? "it" : "them"} too. This cannot be undone.
              </Text>
            ),
          };
        }
        return { message: <Text tone="muted">This site has no assets. This action cannot be undone.</Text> };
      }}
      onConfirm={async () => {
        if (!site) return { error: "No site selected." };
        const result = await deleteSite(site.id);
        return { error: result.error };
      }}
      onDeleted={() => router.refresh()}
      confirmLabel="Delete site"
    />
  );
}
