"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Table } from "@yourorg/ui";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import { DeleteAssetDialog } from "@/app/(app)/assets/components/delete-asset-dialog";

export interface SiteAssetsTableProps {
  assets: AssetRecord[];
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * The asset rows nested inside one site's `Disclosure` on the Clients detail
 * page's Assets tab — deliberately a smaller sibling of
 * `app/(app)/assets/components/assets-table.tsx` rather than that component
 * reused as-is: there's no "Client" column here (every row already belongs
 * to the site/client this whole page is about). A row click and its Edit
 * button both navigate to the full-page `/assets/[id]/edit` (asset new/edit
 * design handoff) — replaces the `AssetFormDialog` slide-in panel this used
 * to open (issue #56, reversed by the product owner; see
 * docs/ARCHITECTURE.md "Popup vs. full page"). A viewer without `canEdit`
 * now navigates to the read-only `/assets/[id]` detail page instead of the
 * row being inert — that page is trivially reachable now that it's a real
 * route, unlike when this tab was `AssetFormDialog`'s only "inspect a record
 * you can't edit" surface. Delete stays a lightweight confirmation `Dialog`
 * (a single flat-record removal, not a relational form).
 */
export function SiteAssetsTable({ assets, canEdit, canDelete }: SiteAssetsTableProps) {
  const router = useRouter();
  const [deletingAsset, setDeletingAsset] = useState<AssetRecord | null>(null);
  const showActionsColumn = canEdit || canDelete;

  function goToAsset(asset: AssetRecord) {
    router.push(canEdit ? `/assets/${asset.id}/edit` : `/assets/${asset.id}`);
  }

  return (
    <>
      <Table>
        <Table.Head>
          <Table.Row>
            <Table.HeaderCell>Name</Table.HeaderCell>
            <Table.HeaderCell>Type</Table.HeaderCell>
            <Table.HeaderCell>Serial number</Table.HeaderCell>
            <Table.HeaderCell align="center">Status</Table.HeaderCell>
            {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {assets.map((asset) => (
            <Table.Row key={asset.id} onClick={() => goToAsset(asset)}>
              <Table.Cell>{asset.name}</Table.Cell>
              <Table.Cell>{asset.asset_type?.label ?? "—"}</Table.Cell>
              <Table.Cell>{asset.serial_number ?? "—"}</Table.Cell>
              <Table.Cell align="center">
                <Badge color={asset.asset_status?.color} variant="muted">
                  {asset.asset_status?.label ?? "—"}
                </Badge>
              </Table.Cell>
              {showActionsColumn && (
                <Table.Cell align="center">
                  <span className="ui-row-actions" onClick={(event) => event.stopPropagation()}>
                    {canEdit && (
                      <Button type="button" variant="outline" size="sm" onClick={() => goToAsset(asset)}>
                        Edit
                      </Button>
                    )}
                    {canDelete && (
                      <Button type="button" variant="danger" size="sm" onClick={() => setDeletingAsset(asset)}>
                        Delete
                      </Button>
                    )}
                  </span>
                </Table.Cell>
              )}
            </Table.Row>
          ))}
        </Table.Body>
      </Table>

      {deletingAsset && (
        <DeleteAssetDialog asset={deletingAsset} open onOpenChange={(next) => !next && setDeletingAsset(null)} />
      )}
    </>
  );
}
