"use client";

import { useState } from "react";
import { Badge, Button, EmptyState, Inline, Stack, Table, Text } from "@yourorg/ui";
import { Boxes } from "@yourorg/ui/icons";
import type { SiteRecord } from "../actions";
import { DeleteSiteDialog } from "../delete-site-dialog";
import { formatSiteAddressShort } from "../format-site-address";
import { SiteFormDialog } from "../site-form-dialog";

export interface SitesPanelProps {
  clientId: string;
  sites: SiteRecord[];
  canWrite: boolean;
  /** Asset count per `site.id`, computed once by the parent from the same
   * `listAssets({ clientId })` fetch the Assets tab uses — keeps "3 assets"
   * here and the Assets tab's own grouping in sync without a second fetch. */
  assetCountBySiteId: Map<string, number>;
  assetsEnabled: boolean;
  /** Switches the parent's active tab to "assets" and scrolls/expands that
   * site's group there — the concrete "interwoven, not siloed" link between
   * the two tabs. Omitted (no "View assets" affordance) when the Assets
   * module isn't visible to this actor/org at all. */
  onViewAssets?: (siteId: string) => void;
}

const PURPOSE_BADGES: {
  key: keyof Pick<SiteRecord, "is_visit_address" | "is_invoice_address" | "is_delivery_address">;
  label: string;
}[] = [
  { key: "is_visit_address", label: "Visit" },
  { key: "is_invoice_address", label: "Invoice" },
  { key: "is_delivery_address", label: "Delivery" },
];

/**
 * Site/address management for a client (issue #41 redo, "Sites as client
 * addresses") — same create/edit/delete flow as before. Full-width `Table`
 * (previously laid out as the approved "Option C" `.sites-grid": table + a
 * narrow "Locations" map side-card — that side-by-side grid is gone as of
 * the client-detail rail redesign: the map now lives in `client-detail.tsx`'s
 * sticky rail, outside the tabs entirely, so it stays visible on every tab
 * instead of only this one; see that file's `mapPins`/`primaryPin`/
 * `otherPins` derivation, moved here almost verbatim). Client/address-
 * specific, not part of the generic `DetailHero` pattern `client-detail.tsx`
 * otherwise builds on — see docs/ARCHITECTURE.md's "Relational detail
 * pages" section.
 *
 * Also still surfaces, unchanged from the prior iteration:
 *  - each site's purpose flags as small badges ("Visit"/"Invoice"/
 *    "Delivery") and a distinct "Primary" badge on whichever site is
 *    `is_primary`;
 *  - an "Assets" column so a site's equipment count is visible without
 *    leaving this tab (docs/ARCHITECTURE.md "interwoven, not siloed").
 */
export function SitesPanel({
  clientId,
  sites,
  canWrite,
  assetCountBySiteId,
  assetsEnabled,
  onViewAssets,
}: SitesPanelProps) {
  const [siteForm, setSiteForm] = useState<{ open: boolean; site: SiteRecord | null }>({
    open: false,
    site: null,
  });
  const [deleteSiteTarget, setDeleteSiteTarget] = useState<SiteRecord | null>(null);

  function openAddSite() {
    setSiteForm({ open: true, site: null });
  }

  return (
    <Stack gap="md">
      {canWrite && (
        <Inline justify="end">
          <Button variant="primary" size="sm" onClick={openAddSite}>
            Add site
          </Button>
        </Inline>
      )}

      {sites.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          heading="No sites yet"
          text="Add this client's first site to begin tracking equipment there."
          action={
            canWrite ? (
              <Button variant="primary" onClick={openAddSite}>
                Add site
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Site</Table.HeaderCell>
              <Table.HeaderCell>Address</Table.HeaderCell>
              <Table.HeaderCell>City</Table.HeaderCell>
              <Table.HeaderCell>Purpose</Table.HeaderCell>
              <Table.HeaderCell align="center">Assets</Table.HeaderCell>
              {canWrite && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {sites.map((site) => {
              const count = assetCountBySiteId.get(site.id) ?? 0;
              return (
                <Table.Row key={site.id} onClick={canWrite ? () => setSiteForm({ open: true, site }) : undefined}>
                  <Table.Cell>
                    <Inline gap="xs" align="center">
                      <Text>{formatSiteAddressShort(site) ?? "—"}</Text>
                      {site.is_primary && <Badge variant="accent">Primary</Badge>}
                    </Inline>
                  </Table.Cell>
                  <Table.Cell>{site.address_line1 || <Text tone="muted">—</Text>}</Table.Cell>
                  <Table.Cell>{site.city || <Text tone="muted">—</Text>}</Table.Cell>
                  <Table.Cell>
                    <Inline gap="xs">
                      {PURPOSE_BADGES.filter((purpose) => site[purpose.key]).map((purpose) => (
                        <Badge key={purpose.key} variant="muted">
                          {purpose.label}
                        </Badge>
                      ))}
                    </Inline>
                  </Table.Cell>
                  <Table.Cell align="center">
                    {assetsEnabled && count > 0 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          onViewAssets?.(site.id);
                        }}
                      >
                        {count} asset{count === 1 ? "" : "s"}
                      </Button>
                    ) : (
                      <Badge variant="muted">{count}</Badge>
                    )}
                  </Table.Cell>
                  {canWrite && (
                    <Table.Cell align="center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSiteForm({ open: true, site });
                        }}
                      >
                        Edit
                      </Button>{" "}
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDeleteSiteTarget(site);
                        }}
                      >
                        Delete
                      </Button>
                    </Table.Cell>
                  )}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      )}

      {canWrite && (
        <>
          <SiteFormDialog
            open={siteForm.open}
            onOpenChange={(open) => setSiteForm((s) => ({ ...s, open }))}
            clientId={clientId}
            site={siteForm.site}
            isFirstSite={sites.length === 0}
            hasPrimarySite={sites.some((s) => s.is_primary)}
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
    </Stack>
  );
}
