"use client";

import { useEffect, useMemo } from "react";
import { Disclosure, EmptyState, SectionHeader, Stack, Text } from "@yourorg/ui";
import { Boxes } from "@yourorg/ui/icons";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import { CreateAssetButton } from "@/app/(app)/assets/components/create-asset-button";
import type { SiteRecord } from "../actions";
import { formatSiteAddressShort } from "../format-site-address";
import { SiteAssetsTable } from "./site-assets-table";

export interface AssetsPanelProps {
  clientId: string;
  sites: SiteRecord[];
  assets: AssetRecord[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Set (and bumped via `focusToken`, since the same site can be re-picked
   * twice in a row) by the Sites tab's "View assets" action — expands and
   * scrolls to that one site's group. `null`/unchanged otherwise. */
  focusSiteId: string | null;
  focusToken: number;
}

function disclosureId(siteId: string): string {
  return `site-assets-${siteId}`;
}

/**
 * Every asset across this client's sites, grouped by site (a client has
 * sites, sites have assets — docs/ARCHITECTURE.md calls for showing that
 * real hierarchy rather than one flat table that happens to be filtered to
 * this client). Each site is a `Disclosure` so a client with many sites
 * doesn't turn into one huge scroll of unrelated equipment — collapse the
 * ones you're not looking at.
 */
export function AssetsPanel({
  clientId,
  sites,
  assets,
  canCreate,
  canEdit,
  canDelete,
  focusSiteId,
  focusToken,
}: AssetsPanelProps) {
  const assetsBySiteId = useMemo(() => {
    const map = new Map<string, AssetRecord[]>();
    for (const asset of assets) {
      const bucket = map.get(asset.site_id);
      if (bucket) bucket.push(asset);
      else map.set(asset.site_id, [asset]);
    }
    return map;
  }, [assets]);

  // Imperatively force-open + scroll to the site picked from the Sites tab's
  // "View assets" button. `<details>`'s `open` is a real DOM property (not
  // just an attribute), so this is a plain, safe DOM read/write — no need to
  // make `Disclosure` a controlled/stateful primitive just for this one
  // cross-tab jump.
  useEffect(() => {
    if (!focusSiteId) return;
    const element = document.getElementById(disclosureId(focusSiteId));
    if (!(element instanceof HTMLDetailsElement)) return;
    element.open = true;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    // `focusToken` (not just `focusSiteId`) is in the deps so picking the
    // same site twice in a row still re-triggers the scroll/expand.
  }, [focusSiteId, focusToken]);

  if (sites.length === 0) {
    return (
      <EmptyState
        icon={<Boxes />}
        heading="Add a site first"
        text="Assets attach to a site — add this client's first site from the Sites tab, then come back here to add equipment."
      />
    );
  }

  return (
    <Stack gap="md">
      <SectionHeader
        icon={Boxes}
        title="Assets"
        actions={canCreate && <CreateAssetButton clientId={clientId} size="sm" label="+ Asset" />}
      />

      {assets.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          heading="No assets yet"
          text="Add this client's first piece of equipment to start tracking it."
        />
      ) : (
        <Stack gap="sm">
          {sites.map((site) => {
            const siteAssets = assetsBySiteId.get(site.id) ?? [];
            return (
              <Disclosure key={site.id} id={disclosureId(site.id)} defaultOpen>
                <Disclosure.Summary
                  meta={
                    <Text tone="muted">
                      {siteAssets.length} asset{siteAssets.length === 1 ? "" : "s"}
                    </Text>
                  }
                >
                  {formatSiteAddressShort(site) ?? "Unnamed site"}
                </Disclosure.Summary>
                <Disclosure.Content>
                  {siteAssets.length === 0 ? (
                    <Text tone="muted">No assets at this site yet.</Text>
                  ) : (
                    <SiteAssetsTable assets={siteAssets} canEdit={canEdit} canDelete={canDelete} />
                  )}
                </Disclosure.Content>
              </Disclosure>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
