"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Breadcrumbs, Button, DetailHero, Stack, Tabs, Text } from "@yourorg/ui";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { QuoteRecord } from "@/app/(app)/quotes/actions";
import type { ClientRecord, SiteRecord } from "../actions";
import type { ContactRecord } from "../contacts-actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { DeleteClientDialog } from "../delete-client-dialog";
import { formatSiteAddress } from "../format-site-address";
import { setLastUsedView } from "@/lib/preferences/actions";
import { usePageHeader } from "@/components/shell/page-header-context";
import { AssetsPanel } from "./assets-panel";
import { CLIENT_DETAIL_VIEW_KEY } from "./constants";
import { ContactsPanel } from "./contacts-panel";
import { ContractsPanel } from "./contracts-panel";
import { QuotesPanel } from "./quotes-panel";
import { SitesPanel } from "./sites-panel";
import { WorkOrdersPanel } from "./work-orders-panel";

export type ClientDetailTab = "sites" | "assets" | "contacts" | "workOrders" | "contracts" | "quotes";

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
  contracts: ContractRecord[];
  contractsEnabled: boolean;
  quotes: QuoteRecord[];
  quotesEnabled: boolean;
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
 *
 * The breadcrumb still lives in the Topbar (`usePageHeader`, see
 * `components/shell/page-header-context.tsx`). The client's own fields are
 * the "Option C" editorial `DetailHero` (`@yourorg/ui`) — an initials hero
 * mark, the client's name as the page's serif `Heading level={1}`, a
 * dot-separated email/phone/primary-address meta line, and "Primary"/
 * "Client since" badges — the now-canonical header pattern for a top-level
 * entity's detail page (see `stories/EditorialDetailPage.stories.tsx` and
 * docs/ARCHITECTURE.md's "Relational detail pages" section). `client.notes`
 * has no slot in that hero (the approved mockup's meta-line doesn't carry
 * it), so it renders as a small muted line just below, only when present.
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
  contracts,
  contractsEnabled,
  quotes,
  quotesEnabled,
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

  // Issue #41 redo ("Sites as client addresses"): `ClientRecord` no longer
  // carries its own address fields — the client's main address is whichever
  // of its `sites` has `is_primary = true` (the server guarantees at most
  // one, and every client with at least one site has exactly one, per
  // `createSite`'s "first site is forced primary" rule). Badged "Primary"
  // here to satisfy "1 adres is het hoofdadres ... ook zichtbaar maken met
  // badge ... op de detailpagina" — the same badge/label `sites-panel.tsx`
  // uses on the matching row in the Sites tab.
  const primarySite = useMemo(() => sites.find((site) => site.is_primary) ?? null, [sites]);

  const breadcrumbItems = useMemo(
    () => [{ label: "Clients", href: "/clients" }, { label: client.name }],
    [client.name],
  );
  // The element itself (not just `breadcrumbItems`) must be memoized — see
  // the "MUST be referentially stable" warning on `usePageHeader`'s doc
  // comment. An inline `<Breadcrumbs items={breadcrumbItems} />` here would
  // be a fresh element every render and infinite-loop.
  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

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

  const heroMeta = [client.email, client.phone, primarySite ? formatSiteAddress(primarySite) : null].filter(
    (item): item is string => Boolean(item),
  );

  return (
    <Stack gap="lg">
      <DetailHero
        avatarLabel={client.name}
        title={client.name}
        meta={heroMeta}
        badges={
          <>
            {primarySite && <Badge variant="accent">Primary</Badge>}
            <Badge variant="muted">{formatClientSince(client.created_at)}</Badge>
          </>
        }
        actions={
          canWrite ? (
            <>
              <Link href={`/clients/${client.id}/edit`}>
                <Button variant="outline" size="sm">
                  Edit
                </Button>
              </Link>
              <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
            </>
          ) : undefined
        }
      />

      {client.notes && <Text tone="muted">{client.notes}</Text>}

      <Tabs value={tab} onValueChange={(next) => selectTab(next as ClientDetailTab)}>
        <Tabs.List aria-label="Client detail">
          <Tabs.Tab value="sites">Sites{sites.length > 0 ? ` (${sites.length})` : ""}</Tabs.Tab>
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
          {contractsEnabled && (
            <Tabs.Tab value="contracts">
              Contracts{contracts.length > 0 ? ` (${contracts.length})` : ""}
            </Tabs.Tab>
          )}
          {quotesEnabled && (
            <Tabs.Tab value="quotes">
              Quotes{quotes.length > 0 ? ` (${quotes.length})` : ""}
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

        {contractsEnabled && (
          <Tabs.Panel value="contracts">
            <ContractsPanel contracts={contracts} />
          </Tabs.Panel>
        )}

        {quotesEnabled && (
          <Tabs.Panel value="quotes">
            <QuotesPanel quotes={quotes} />
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

/** Same "Client since {month} {year}" convention as `clients-table.tsx`'s
 * own `formatClientSince` (not imported from there — that one is a private
 * helper local to the table, not exported) — feeds the hero's "Client
 * since" badge, the only real (non-fabricated) client-tenure signal
 * available on `ClientRecord`. */
function formatClientSince(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Client since —";
  return `Client since ${date.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
}
