"use client";

import { useState } from "react";
import { Button, EmptyState, Stack, Table, Text } from "@yourorg/ui";
import { Settings } from "@yourorg/ui/icons";
import type { AssetModelRecord } from "@/lib/asset-models/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { AssetModelFormDialog } from "./asset-model-form-dialog";
import { DeleteAssetModelDialog } from "./delete-asset-model-dialog";

export interface AssetModelManagerProps {
  models: AssetModelRecord[];
  /** Non-fatal — `listAssetModels` failing (e.g. transient network) still
   * renders this component with whatever it got (`models` empty), plus this
   * message, rather than crashing the whole tab (same convention
   * `ReferenceListManager` uses for its own `loadError`). */
  loadError?: string;
  /** Owner only, per the `settings` RBAC entry — same as every other
   * reference-list-style manager on this screen. */
  canWrite: boolean;
  brandItems: ReferenceListItemRecord[];
  typeItems: ReferenceListItemRecord[];
  subtypeItems: ReferenceListItemRecord[];
}

/**
 * "Asset Model" tab on the Reference Lists settings screen (issue #54) — a
 * dedicated manager, not the generic `ReferenceListManager`, because a Model
 * has three simultaneous reference-list relationships (Brand/Type/Sub-type)
 * plus its own `default_warranty_months` field (see the design note atop
 * `supabase/migrations/20260826160000_asset_brand_and_models.sql`).
 */
export function AssetModelManager({
  models,
  loadError,
  canWrite,
  brandItems,
  typeItems,
  subtypeItems,
}: AssetModelManagerProps) {
  const [formState, setFormState] = useState<{ open: boolean; model: AssetModelRecord | null }>({
    open: false,
    model: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<AssetModelRecord | null>(null);

  function openAdd() {
    setFormState({ open: true, model: null });
  }

  function openEdit(model: AssetModelRecord) {
    setFormState({ open: true, model });
  }

  return (
    <Stack gap="md">
      {loadError && <Text tone="danger">{loadError}</Text>}

      {canWrite && (
        <div>
          <Button variant="primary" size="sm" onClick={openAdd}>
            Add model
          </Button>
        </div>
      )}

      {models.length === 0 ? (
        <EmptyState
          icon={<Settings />}
          heading="No models yet"
          text={canWrite ? "Add the first model." : "Nothing configured yet."}
          action={
            canWrite ? (
              <Button variant="primary" onClick={openAdd}>
                Add model
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.HeaderCell>Name</Table.HeaderCell>
              <Table.HeaderCell>Brand</Table.HeaderCell>
              <Table.HeaderCell>Type</Table.HeaderCell>
              <Table.HeaderCell>Sub-type</Table.HeaderCell>
              <Table.HeaderCell align="center">Default warranty</Table.HeaderCell>
              {canWrite && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {models.map((model) => (
              <Table.Row key={model.id}>
                <Table.Cell>
                  <Text>{model.name}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text tone="muted">{model.brand?.label ?? "—"}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text tone="muted">{model.type?.label ?? "—"}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text tone="muted">{model.subtype?.label ?? "—"}</Text>
                </Table.Cell>
                <Table.Cell align="center">
                  <Text tone="muted">
                    {model.default_warranty_months} {model.default_warranty_months === 1 ? "month" : "months"}
                  </Text>
                </Table.Cell>
                {canWrite && (
                  <Table.Cell align="center">
                    <Button variant="outline" size="sm" onClick={() => openEdit(model)}>
                      Edit
                    </Button>{" "}
                    <Button variant="danger" size="sm" onClick={() => setDeleteTarget(model)}>
                      Delete
                    </Button>
                  </Table.Cell>
                )}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {canWrite && (
        <>
          <AssetModelFormDialog
            open={formState.open}
            onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
            model={formState.model}
            brandItems={brandItems}
            typeItems={typeItems}
            subtypeItems={subtypeItems}
          />
          <DeleteAssetModelDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            model={deleteTarget}
          />
        </>
      )}
    </Stack>
  );
}
