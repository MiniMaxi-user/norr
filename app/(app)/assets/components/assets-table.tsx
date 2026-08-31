"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Input, Stack, Table, Text } from "@yourorg/ui";
import type { AssetRecord } from "../actions";
import { AssetFormDialog } from "./asset-form-dialog";
import { DeleteAssetDialog } from "./delete-asset-dialog";

export interface AssetsTableProps {
  assets: AssetRecord[];
  clientNameById: Map<string, string>;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * List view table: client-side search over the current page of `assets`
 * (server-side filtering already narrows by client/site — see
 * `AssetsFilters` — free-text search here is a fast, no-round-trip refinement
 * on top of that). A row click and the row-level Edit action both open the
 * same slide-in `AssetFormDialog` (`mode="edit"`, issue #53, docs/
 * ARCHITECTURE.md "Popup vs. full page — pick by weight, not habit") — issue
 * #105 replaced the old row-click-navigates-to-`/assets/[id]` behavior with
 * this, so a viewer without `canEdit` (Finance/Administratie's plain `read`,
 * or an Engineer without `update_own`) still gets a way to inspect the full
 * record: `AssetFormDialog` renders every field read-only for them instead
 * of the editable form (see that component's own `canEdit` prop doc
 * comment). `/assets/[id]` itself is untouched — other modules still deep
 * link into it. Delete stays a lightweight confirmation `Dialog` (a single
 * flat-record removal, not a relational form).
 *
 * `stickyHeader`/`maxHeight` keep a long page of assets scrolling under a
 * fixed header instead of pushing the pagination row off-screen (docs/
 * ARCHITECTURE.md "Premium UX requirements" — this is the fix for "bij
 * assets scroll hij niet").
 */
export function AssetsTable({ assets, clientNameById, canEdit, canDelete }: AssetsTableProps) {
  const [query, setQuery] = useState("");
  const [deletingAsset, setDeletingAsset] = useState<AssetRecord | null>(null);
  const [editingAsset, setEditingAsset] = useState<AssetRecord | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((asset) =>
      [
        asset.name,
        asset.asset_type?.label,
        asset.asset_brand?.label,
        asset.asset_model?.name,
        asset.external_reference,
        asset.serial_number,
        clientNameById.get(asset.client_id),
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(q)),
    );
  }, [assets, query, clientNameById]);

  const showActionsColumn = canEdit || canDelete;

  return (
    <>
      <Stack gap="md">
        <Input
          aria-label="Search assets on this page"
          placeholder="Search by name, type, brand, model, serial…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <Table stickyHeader maxHeight="65vh">
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell>Client</Table.HeaderCell>
              <Table.HeaderCell>Serial number</Table.HeaderCell>
              <Table.HeaderCell align="center">Status</Table.HeaderCell>
              {/* `align="end"` doesn't typecheck here — `types/yourorg-ui.d.ts`
                  intersects this prop with `ThHTMLAttributes`'s own legacy
                  `align` attribute type, which only overlaps at `"center"`.
                  Pre-existing design-system typing bug (also hit by
                  `app/(app)/clients/clients-table.tsx`) — flagged for the
                  design-system repo rather than patched here. */}
              {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {filtered.map((asset) => (
              <Table.Row key={asset.id} onClick={() => setEditingAsset(asset)}>
                <Table.Cell>{asset.name}</Table.Cell>
                <Table.Cell>{asset.asset_type?.label ?? "—"}</Table.Cell>
                <Table.Cell>{clientNameById.get(asset.client_id) ?? "—"}</Table.Cell>
                <Table.Cell>{asset.serial_number ?? "—"}</Table.Cell>
                <Table.Cell align="center">
                  <Badge color={asset.asset_status?.color} variant="muted">
                    {asset.asset_status?.label ?? "—"}
                  </Badge>
                </Table.Cell>
                {showActionsColumn && (
                  <Table.Cell align="center">
                    {/* Stops the row's own onClick (open the dialog) from
                        also firing — the actual actions below are real
                        buttons. `.ui-row-actions` hover-reveals them (styles.css) so
                        a dense list of assets doesn't repeat two buttons per
                        row at all times; `:focus-within` keeps them visible
                        for keyboard navigation. */}
                    <span className="ui-row-actions" onClick={(event) => event.stopPropagation()}>
                      {canEdit && (
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditingAsset(asset)}>
                          Edit
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          onClick={() => setDeletingAsset(asset)}
                        >
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

        {filtered.length === 0 && <Text tone="muted">No assets match &ldquo;{query}&rdquo;.</Text>}
      </Stack>

      {deletingAsset && (
        <DeleteAssetDialog
          asset={deletingAsset}
          open
          onOpenChange={(next) => !next && setDeletingAsset(null)}
        />
      )}

      {editingAsset && (
        <AssetFormDialog
          asset={editingAsset}
          mode="edit"
          open
          onOpenChange={(next) => !next && setEditingAsset(null)}
          canEdit={canEdit}
        />
      )}
    </>
  );
}
