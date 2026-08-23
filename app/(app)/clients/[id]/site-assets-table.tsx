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
 * to the site/client this whole page is about). Edit navigates to the full
 * `/assets/[id]/edit` page (docs/ARCHITECTURE.md "Popup vs. full page — pick
 * by weight, not habit"), same as the standalone Assets module; delete stays
 * a lightweight confirmation `Dialog` (a single flat-record removal, not a
 * relational form).
 */
export function SiteAssetsTable({ assets, canEdit, canDelete }: SiteAssetsTableProps) {
  const router = useRouter();
  const [deletingAsset, setDeletingAsset] = useState<AssetRecord | null>(null);
  const showActionsColumn = canEdit || canDelete;

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
            <Table.Row key={asset.id} onClick={() => router.push(`/assets/${asset.id}`)}>
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
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/assets/${asset.id}/edit`)}
                      >
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
