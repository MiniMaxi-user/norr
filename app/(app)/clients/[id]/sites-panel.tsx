"use client";

import { useState } from "react";
import { Badge, Button, EmptyState, Stack, Table, Text } from "@yourorg/ui";
import { Boxes } from "@yourorg/ui/icons";
import type { SiteRecord } from "../actions";
import { DeleteSiteDialog } from "../delete-site-dialog";
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

/**
 * Site management for a client — same create/edit/delete flow as before,
 * plus an "Assets" column so a site's equipment count is visible without
 * leaving the Sites tab (docs/ARCHITECTURE.md "interwoven, not siloed").
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
    <Stack gap="sm">
      {canWrite && (
        <div>
          <Button variant="primary" size="sm" onClick={openAddSite}>
            Add site
          </Button>
        </div>
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
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Address</Table.HeaderCell>
              <Table.HeaderCell>City</Table.HeaderCell>
              <Table.HeaderCell align="center">Assets</Table.HeaderCell>
              {canWrite && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {sites.map((site) => {
              const count = assetCountBySiteId.get(site.id) ?? 0;
              return (
                <Table.Row key={site.id}>
                  <Table.Cell>{site.name}</Table.Cell>
                  <Table.Cell>{site.address_line1 || <Text tone="muted">—</Text>}</Table.Cell>
                  <Table.Cell>{site.city || <Text tone="muted">—</Text>}</Table.Cell>
                  <Table.Cell align="center">
                    {assetsEnabled && count > 0 ? (
                      <Button variant="outline" size="sm" onClick={() => onViewAssets?.(site.id)}>
                        {count} asset{count === 1 ? "" : "s"}
                      </Button>
                    ) : (
                      <Badge variant="muted">{count}</Badge>
                    )}
                  </Table.Cell>
                  {canWrite && (
                    <Table.Cell align="center">
                      <Button variant="outline" size="sm" onClick={() => setSiteForm({ open: true, site })}>
                        Edit
                      </Button>{" "}
                      <Button variant="danger" size="sm" onClick={() => setDeleteSiteTarget(site)}>
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
