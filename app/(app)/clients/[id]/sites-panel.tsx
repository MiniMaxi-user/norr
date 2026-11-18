"use client";

import { useMemo, useState } from "react";
import { WebButton } from "@yourorg/ui/web";
import { WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { SiteRecord } from "../actions";
import type { ContactRecord } from "../contacts-actions";
import { DeleteSiteDialog } from "../components/delete-site-dialog";
import { formatSiteAddressShort } from "../format-site-address";
import { SiteFormDialog } from "../components/site-form-dialog";

export interface SitesPanelProps {
  clientId: string;
  sites: SiteRecord[];
  canWrite: boolean;
  /** This client's own contacts, and this org's `contact_role` picklist —
   * issue #52's per-purpose (visit/invoice/delivery) contact-person picker,
   * threaded straight through to `SiteFormDialog` (single dialog instance
   * shared by the "+ Site" button, the row click and the row menu). */
  contacts: ContactRecord[];
  contactRoles: ReferenceListItemRecord[];
  /** Asset count per `site.id`, computed once by the parent from the same
   * `listAssets({ clientId })` fetch the Assets tab uses. */
  assetCountBySiteId: Map<string, number>;
  assetsEnabled: boolean;
  /** Switches the parent's active tab to "assets" filtered to that site (the
   * "interwoven, not siloed" cross-tab link). Omitted when the Assets module
   * isn't visible to this actor/org. */
  onViewAssets?: (siteId: string) => void;
}

const PURPOSES: {
  key: keyof Pick<SiteRecord, "is_visit_address" | "is_invoice_address" | "is_delivery_address">;
  value: string;
  label: string;
}[] = [
  { key: "is_visit_address", value: "visit", label: "Visit" },
  { key: "is_invoice_address", value: "invoice", label: "Invoice" },
  { key: "is_delivery_address", value: "delivery", label: "Delivery" },
];

function purposesOf(site: SiteRecord) {
  return PURPOSES.filter((purpose) => site[purpose.key]);
}

/**
 * Sites tab (issue #41 redo; design-system table pattern, issue #222): ONE
 * card with a FilterBar and a sortable table. "+ Site" lives in the FilterBar;
 * edit (row click / ··· menu) and delete (··· menu) reuse the same dialogs as
 * before. The map moved to the page rail long ago, so the tab is just this
 * table. The "Assets" count links to the Assets tab filtered to that site.
 */
export function SitesPanel({
  clientId,
  sites,
  canWrite,
  assetCountBySiteId,
  assetsEnabled,
  onViewAssets,
  contacts,
  contactRoles,
}: SitesPanelProps) {
  const [siteForm, setSiteForm] = useState<{ open: boolean; site: SiteRecord | null }>({ open: false, site: null });
  const [deleteSiteTarget, setDeleteSiteTarget] = useState<SiteRecord | null>(null);

  function openAddSite() {
    setSiteForm({ open: true, site: null });
  }

  const columns = useMemo<WebColumn<SiteRecord>[]>(
    () => [
      {
        id: "address",
        header: "Address",
        primary: true,
        sortValue: (site) => formatSiteAddressShort(site) ?? "",
        render: (site) => (
          <>
            {formatSiteAddressShort(site) ?? "—"}
            {site.is_primary ? <span className="web-muted-cell"> · Primary</span> : null}
          </>
        ),
      },
      { id: "city", header: "City", sortValue: (site) => site.city ?? "", render: (site) => site.city || "—" },
      {
        id: "purpose",
        header: "Purpose",
        render: (site) =>
          purposesOf(site)
            .map((purpose) => purpose.label)
            .join(" · ") || "—",
      },
      {
        id: "assets",
        header: "Assets",
        align: "end",
        sortValue: (site) => assetCountBySiteId.get(site.id) ?? 0,
        render: (site) => {
          const count = assetCountBySiteId.get(site.id) ?? 0;
          return assetsEnabled && count > 0 && onViewAssets ? (
            <button type="button" className="web-cell-link" onClick={() => onViewAssets(site.id)}>
              {count}
            </button>
          ) : (
            count
          );
        },
      },
    ],
    [assetCountBySiteId, assetsEnabled, onViewAssets],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "city",
        label: "City",
        getOptions: (site: SiteRecord) => (site.city ? [{ value: site.city, label: site.city }] : []),
      },
      {
        id: "purpose",
        label: "Purpose",
        getOptions: (site: SiteRecord) => purposesOf(site).map(({ value, label }) => ({ value, label })),
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show sites",
      defaultValue: "all",
      options: [
        { value: "primary", label: "Primary", match: (site: SiteRecord) => site.is_primary },
        { value: "other", label: "Other", match: (site: SiteRecord) => !site.is_primary },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  function rowActions(site: SiteRecord): WebMenuItem[] {
    if (!canWrite) return [];
    return [
      { key: "edit", label: "Edit site", onSelect: () => setSiteForm({ open: true, site }) },
      { key: "delete", label: "Delete site", danger: true, onSelect: () => setDeleteSiteTarget(site) },
    ];
  }

  return (
    <>
      <WebDataTableCard
        title="Sites"
        meta={String(sites.length)}
        rows={sites}
        getRowKey={(site) => site.id}
        columns={columns}
        searchText={(site) =>
          [site.address_line1, site.address_line2, site.postal_code, site.city, site.country, site.phone]
            .filter(Boolean)
            .join(" ")
        }
        noun="sites"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="sites"
        defaultSort={{ columnId: "address", direction: "asc" }}
        onRowClick={canWrite ? (site) => setSiteForm({ open: true, site }) : undefined}
        rowActions={canWrite ? rowActions : undefined}
        rowLabel={(site) => formatSiteAddressShort(site) ?? "site"}
        add={
          canWrite ? (
            <WebButton size="filter" onClick={openAddSite}>
              + Site
            </WebButton>
          ) : undefined
        }
        emptyAction={
          canWrite ? (
            <button type="button" className="web-rail-link" onClick={openAddSite}>
              Add site
            </button>
          ) : undefined
        }
      />

      {canWrite && (
        <>
          <SiteFormDialog
            open={siteForm.open}
            onOpenChange={(open) => setSiteForm((s) => ({ ...s, open }))}
            clientId={clientId}
            site={siteForm.site}
            isFirstSite={sites.length === 0}
            hasPrimarySite={sites.some((s) => s.is_primary)}
            contacts={contacts}
            contactRoles={contactRoles}
          />
          <DeleteSiteDialog
            open={Boolean(deleteSiteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteSiteTarget(null);
            }}
            site={deleteSiteTarget}
          />
        </>
      )}
    </>
  );
}
