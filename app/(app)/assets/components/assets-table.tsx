"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Stack, Table, Text } from "@yourorg/ui";
import type { AssetRecord } from "../actions";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import { AssetFormDialog } from "./asset-form-dialog";
import { DeleteAssetDialog } from "./delete-asset-dialog";

function statusLabel(status: AssetRecord["status"]): string {
  return status === "active" ? "Active" : "Decommissioned";
}

export interface AssetsTableProps {
  assets: AssetRecord[];
  clients: ClientRecord[];
  clientNameById: Map<string, string>;
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * List view table: client-side search over the current page of `assets`
 * (server-side filtering already narrows by client/site — see
 * `AssetsFilters` — free-text search here is a fast, no-round-trip refinement
 * on top of that). Row click navigates to the detail page; row-level
 * edit/delete actions are stopPropagation'd so they don't also trigger the
 * navigation.
 */
export function AssetsTable({ assets, clients, clientNameById, canEdit, canDelete }: AssetsTableProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [editingAsset, setEditingAsset] = useState<AssetRecord | null>(null);
  const [deletingAsset, setDeletingAsset] = useState<AssetRecord | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((asset) =>
      [
        asset.name,
        asset.type,
        asset.manufacturer,
        asset.model,
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
          placeholder="Search by name, type, manufacturer, serial…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <Table>
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
              <Table.Row key={asset.id} onClick={() => router.push(`/assets/${asset.id}`)}>
                <Table.Cell>{asset.name}</Table.Cell>
                <Table.Cell>{asset.type}</Table.Cell>
                <Table.Cell>{clientNameById.get(asset.client_id) ?? "—"}</Table.Cell>
                <Table.Cell>{asset.serial_number ?? "—"}</Table.Cell>
                <Table.Cell align="center">
                  <Badge variant={asset.status === "active" ? "success" : "muted"}>
                    {statusLabel(asset.status)}
                  </Badge>
                </Table.Cell>
                {showActionsColumn && (
                  <Table.Cell align="center">
                    {/* Stops the row's own onClick (navigation) from also
                        firing — the actual actions below are real buttons. */}
                    <span onClick={(event) => event.stopPropagation()}>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingAsset(asset)}
                        >
                          Edit
                        </Button>
                      )}{" "}
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

      {editingAsset && (
        <AssetFormDialog
          mode="edit"
          asset={editingAsset}
          clients={clients}
          open
          onOpenChange={(next) => !next && setEditingAsset(null)}
        />
      )}

      {deletingAsset && (
        <DeleteAssetDialog
          asset={deletingAsset}
          open
          onOpenChange={(next) => !next && setDeletingAsset(null)}
        />
      )}
    </>
  );
}
