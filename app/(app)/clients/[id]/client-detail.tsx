"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Breadcrumbs, Button, Card, Heading, Stack, Tabs, Text } from "@yourorg/ui";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import type { ClientRecord, SiteRecord } from "../actions";
import type { ContactRecord } from "../contacts-actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { DeleteClientDialog } from "../delete-client-dialog";
import { setLastUsedView } from "@/lib/preferences/actions";
import { AssetsPanel } from "./assets-panel";
import { CLIENT_DETAIL_VIEW_KEY } from "./constants";
import { ContactsPanel } from "./contacts-panel";
import { SitesPanel } from "./sites-panel";
import { WorkOrdersPanel } from "./work-orders-panel";

export type ClientDetailTab = "sites" | "assets" | "contacts" | "workOrders";

export interface ClientDetailProps {
  client: ClientRecord;
  sites: SiteRecord[];
  canWrite: boolean;
  assets: AssetRecord[];
  assetsEnabled: boolean;
  canCreateAssets: boolean;
  canEditAssets: boolean;
  canDeleteAssets: boolean;
  contacts: ContactRecord[];
  contactRoles: ReferenceListItemRecord[];
  workOrders: WorkOrderRecord[];
  workOrdersEnabled: boolean;
  defaultTab: ClientDetailTab;
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
  canCreateAssets,
  canEditAssets,
  canDeleteAssets,
  contacts,
  contactRoles,
  workOrders,
  workOrdersEnabled,
  defaultTab,
}: ClientDetailProps) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tab, setTab] = useState<ClientDetailTab>(defaultTab);
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

  function selectTab(next: ClientDetailTab) {
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
      <Breadcrumbs items={[{ label: "Clients", href: "/clients" }, { label: client.name }]} />

      <Card>
        <Stack gap="md">
          <Heading level={1}>{client.name}</Heading>
          {canWrite && (
            <div>
              <Link href={`/clients/${client.id}/edit`}>
                <Button variant="outline" size="sm">
                  Edit
                </Button>
              </Link>{" "}
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

      <Tabs value={tab} onValueChange={(next) => selectTab(next as ClientDetailTab)}>
        <Tabs.List aria-label="Client detail">
          <Tabs.Tab value="sites">Sites</Tabs.Tab>
          {assetsEnabled && (
            <Tabs.Tab value="assets">
              Assets{assets.length > 0 ? ` (${assets.length})` : ""}
            </Tabs.Tab>
          )}
          <Tabs.Tab value="contacts">
            Contacts{contacts.length > 0 ? ` (${contacts.length})` : ""}
          </Tabs.Tab>
          {workOrdersEnabled && (
            <Tabs.Tab value="workOrders">
              Work Orders{workOrders.length > 0 ? ` (${workOrders.length})` : ""}
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="sites">
          <SitesPanel
            clientId={client.id}
            sites={sites}
            canWrite={canWrite}
            assetCountBySiteId={assetCountBySiteId}
            assetsEnabled={assetsEnabled}
            onViewAssets={assetsEnabled ? viewAssetsForSite : undefined}
          />
        </Tabs.Panel>

        {assetsEnabled && (
          <Tabs.Panel value="assets">
            <AssetsPanel
              clientId={client.id}
              sites={sites}
              assets={assets}
              canCreate={canCreateAssets}
              canEdit={canEditAssets}
              canDelete={canDeleteAssets}
              focusSiteId={focusSite.siteId}
              focusToken={focusSite.token}
            />
          </Tabs.Panel>
        )}

        <Tabs.Panel value="contacts">
          <ContactsPanel clientId={client.id} contacts={contacts} contactRoles={contactRoles} canWrite={canWrite} />
        </Tabs.Panel>

        {workOrdersEnabled && (
          <Tabs.Panel value="workOrders">
            <WorkOrdersPanel workOrders={workOrders} />
          </Tabs.Panel>
        )}
      </Tabs>

      {canWrite && (
        <DeleteClientDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          client={client}
          onDeleted={() => router.push("/clients")}
        />
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
