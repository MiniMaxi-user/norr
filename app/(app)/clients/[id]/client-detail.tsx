"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Heading, Stack, Tabs, Text } from "@yourorg/ui";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "../actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { ClientFormDialog } from "../client-form-dialog";
import { DeleteClientDialog } from "../delete-client-dialog";
import { setLastUsedView } from "@/lib/preferences/actions";
import { AssetsPanel } from "./assets-panel";
import { CLIENT_DETAIL_VIEW_KEY } from "./constants";
import { SitesPanel } from "./sites-panel";

export interface ClientDetailProps {
  client: ClientRecord;
  sites: SiteRecord[];
  canWrite: boolean;
  assets: AssetRecord[];
  assetsEnabled: boolean;
  assetTypes: ReferenceListItemRecord[];
  assetStatuses: ReferenceListItemRecord[];
  canCreateAssets: boolean;
  canEditAssets: boolean;
  canDeleteAssets: boolean;
  defaultTab: "sites" | "assets";
}

/**
 * Client detail: the client's own fields, plus its Sites and Assets shown
 * together on one page via `Tabs` instead of siloed screens (the "ik
 * verwacht dat je bij clients gelijk ook de assets kan zien" requirement).
 * The two tabs aren't just glued side by side — a site row's "Assets" count
 * (`SitesPanel`) jumps straight to that site's expanded group in the Assets
 * tab (`AssetsPanel`, grouped by site via `Disclosure`), so the real
 * client -> sites -> assets hierarchy stays visible from either tab instead
 * of being flattened into one generic list.
 */
export function ClientDetail({
  client,
  sites,
  canWrite,
  assets,
  assetsEnabled,
  assetTypes,
  assetStatuses,
  canCreateAssets,
  canEditAssets,
  canDeleteAssets,
  defaultTab,
}: ClientDetailProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tab, setTab] = useState<"sites" | "assets">(defaultTab);
  const [focusSite, setFocusSite] = useState<{ siteId: string | null; token: number }>({
    siteId: null,
    token: 0,
  });
  const [, startTransition] = useTransition();

  const assetCountBySiteId = useMemo(() => {
    const map = new Map<string, number>();
    for (const asset of assets) {
      map.set(asset.site_id, (map.get(asset.site_id) ?? 0) + 1);
    }
    return map;
  }, [assets]);

  function selectTab(next: "sites" | "assets") {
    setTab(next);
    startTransition(() => {
      void setLastUsedView(CLIENT_DETAIL_VIEW_KEY, next);
    });
  }

  function viewAssetsForSite(siteId: string) {
    setFocusSite((current) => ({ siteId, token: current.token + 1 }));
    selectTab("assets");
  }

  return (
    <Stack gap="lg">
      <div>
        <Link href="/clients">&larr; Back to clients</Link>
      </div>

      <Card>
        <Stack gap="md">
          <Heading level={1}>{client.name}</Heading>
          {canWrite && (
            <div>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                Edit
              </Button>{" "}
              <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
            </div>
          )}

          <Stack gap="xs">
            <DetailRow label="Email" value={client.email} />
            <DetailRow label="Phone" value={client.phone} />
            <DetailRow label="Address" value={formatAddress(client)} />
            <DetailRow label="Notes" value={client.notes} />
          </Stack>
        </Stack>
      </Card>

      {assetsEnabled ? (
        <Tabs value={tab} onValueChange={(next) => selectTab(next as "sites" | "assets")}>
          <Tabs.List aria-label="Client detail">
            <Tabs.Tab value="sites">Sites</Tabs.Tab>
            <Tabs.Tab value="assets">
              Assets{assets.length > 0 ? ` (${assets.length})` : ""}
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="sites">
            <SitesPanel
              clientId={client.id}
              sites={sites}
              canWrite={canWrite}
              assetCountBySiteId={assetCountBySiteId}
              assetsEnabled={assetsEnabled}
              onViewAssets={viewAssetsForSite}
            />
          </Tabs.Panel>

          <Tabs.Panel value="assets">
            <AssetsPanel
              clientId={client.id}
              sites={sites}
              assets={assets}
              assetTypes={assetTypes}
              assetStatuses={assetStatuses}
              canCreate={canCreateAssets}
              canEdit={canEditAssets}
              canDelete={canDeleteAssets}
              focusSiteId={focusSite.siteId}
              focusToken={focusSite.token}
            />
          </Tabs.Panel>
        </Tabs>
      ) : (
        <Stack gap="sm">
          <Heading level={2}>Sites</Heading>
          <SitesPanel
            clientId={client.id}
            sites={sites}
            canWrite={canWrite}
            assetCountBySiteId={assetCountBySiteId}
            assetsEnabled={false}
          />
        </Stack>
      )}

      {canWrite && (
        <>
          <ClientFormDialog open={editOpen} onOpenChange={setEditOpen} client={client} />
          <DeleteClientDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            client={client}
            onDeleted={() => router.push("/clients")}
          />
        </>
      )}
    </Stack>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <Text tone="muted">{label}</Text>
      <Text>{value || "—"}</Text>
    </div>
  );
}

function formatAddress(client: ClientRecord): string | null {
  const cityLine = [client.postal_code, client.city].filter(Boolean).join(" ");
  const parts = [client.address_line1, client.address_line2, cityLine, client.country].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length ? parts.join(", ") : null;
}
