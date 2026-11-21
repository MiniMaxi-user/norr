"use client";

import { useMemo, useState } from "react";
import { WebButton } from "@yourorg/ui/web";
import { WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import type { AssetModelRecord, VolumeCounterOption } from "@/lib/asset-models/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { AssetModelFormDialog } from "./asset-model-form-dialog";
import { DeleteAssetModelDialog } from "./delete-asset-model-dialog";

export interface AssetModelManagerProps {
  models: AssetModelRecord[];
  /** Non-fatal: `listAssetModels` failing still renders the card (empty) with
   * this message. */
  loadError?: string;
  /** Owner only, per the `settings` RBAC entry. */
  canWrite: boolean;
  brandItems: ReferenceListItemRecord[];
  typeItems: ReferenceListItemRecord[];
  subtypeItems: ReferenceListItemRecord[];
  /** Counters (Volume list items) selectable per model. */
  volumeOptions: VolumeCounterOption[];
  /** `meters` module on: show the counters column/filter/picker (#247). */
  metersEnabled: boolean;
}

/**
 * Asset models (issue #54; design system #222): manufacturer/model
 * combinations, each tied to a Brand, Type, optional Sub-type and counters.
 * One card with FilterBar (search, Brand / Type / Sub-type dropdowns with the
 * Sub-type disabled until a Type is chosen, With volumes / Without volumes /
 * All) and a table; `+ Model` sits in the FilterBar, Edit and Delete in the
 * row's ··· menu (owner only). The create/edit form stays a small dialog.
 */
export function AssetModelManager({
  models,
  loadError,
  canWrite,
  brandItems,
  typeItems,
  subtypeItems,
  volumeOptions,
  metersEnabled,
}: AssetModelManagerProps) {
  const [formState, setFormState] = useState<{ open: boolean; model: AssetModelRecord | null }>({
    open: false,
    model: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<AssetModelRecord | null>(null);

  const volumeLabels = useMemo(() => new Map(volumeOptions.map((option) => [option.id, option.label])), [volumeOptions]);
  const volumeText = (model: AssetModelRecord) =>
    model.volumeItemIds.map((id) => volumeLabels.get(id) ?? "Unknown counter").join(", ");

  const columns = useMemo<WebColumn<AssetModelRecord>[]>(
    () => [
      { id: "name", header: "Name", sortValue: (row) => row.name, render: (row) => row.name },
      {
        id: "brand",
        header: "Brand",
        sortValue: (row) => row.brand?.label ?? "",
        render: (row) => row.brand?.label ?? "—",
      },
      {
        id: "type",
        header: "Type",
        sortValue: (row) => row.type?.label ?? "",
        render: (row) => row.type?.label ?? "—",
      },
      {
        id: "subtype",
        header: "Sub-type",
        sortValue: (row) => row.subtype?.label ?? "",
        render: (row) => row.subtype?.label ?? "—",
      },
      ...(metersEnabled
        ? [
            {
              id: "volumes",
              header: "Volumes",
              render: (row: AssetModelRecord) => (row.volumeItemIds.length === 0 ? "—" : volumeText(row)),
            },
          ]
        : []),
      {
        id: "warranty",
        header: "Default warranty",
        align: "end",
        sortValue: (row) => row.default_warranty_months,
        render: (row) => `${row.default_warranty_months} ${row.default_warranty_months === 1 ? "month" : "months"}`,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [volumeLabels, metersEnabled],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "brand",
        label: "Brand",
        getOptions: (row: AssetModelRecord) => (row.brand ? [{ value: row.brand_item_id, label: row.brand.label }] : []),
      },
      {
        id: "type",
        label: "Type",
        resets: ["subtype"],
        getOptions: (row: AssetModelRecord) => (row.type ? [{ value: row.type_item_id, label: row.type.label }] : []),
      },
      {
        id: "subtype",
        label: "Sub-type",
        disabledWhen: (values: Record<string, string>) => !values.type,
        getOptions: (row: AssetModelRecord) =>
          row.subtype && row.subtype_item_id ? [{ value: row.subtype_item_id, label: row.subtype.label }] : [],
      },
    ],
    [],
  );

  const segment = useMemo(
    () =>
      !metersEnabled
        ? undefined
        : {
      label: "Show asset models",
      defaultValue: "all",
      options: [
        { value: "with", label: "With volumes", match: (row: AssetModelRecord) => row.volumeItemIds.length > 0 },
        { value: "without", label: "Without volumes", match: (row: AssetModelRecord) => row.volumeItemIds.length === 0 },
        { value: "all", label: "All" },
      ] as const,
    },
    [metersEnabled],
  );

  const rowActions = (row: AssetModelRecord): WebMenuItem[] =>
    canWrite
      ? [
          { key: "edit", label: "Edit…", onSelect: () => setFormState({ open: true, model: row }) },
          { type: "separator", key: "sep" },
          { key: "delete", label: "Delete", danger: true, onSelect: () => setDeleteTarget(row) },
        ]
      : [];

  return (
    <div className="web-tab-stack">
      {loadError ? (
        <p className="web-dialog-error" role="alert">
          {loadError}
        </p>
      ) : null}

      <WebDataTableCard
        note="Manufacturer and model combinations for your assets, each tied to a Brand, Type and Sub-type."
        rows={models}
        getRowKey={(row) => row.id}
        columns={columns}
        searchText={(row) =>
          `${row.name} ${row.brand?.label ?? ""} ${row.type?.label ?? ""} ${row.subtype?.label ?? ""} ${metersEnabled ? volumeText(row) : ""}`
        }
        noun="asset models"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="models"
        defaultSort={{ columnId: "name", direction: "asc" }}
        rowActions={canWrite ? rowActions : undefined}
        rowLabel={(row) => row.name}
        add={
          canWrite ? (
            <WebButton size="filter" onClick={() => setFormState({ open: true, model: null })}>
              + Model
            </WebButton>
          ) : undefined
        }
        emptyAction={canWrite ? "Use + Model to add the first one." : undefined}
      />

      {canWrite ? (
        <>
          {formState.open ? (
            <AssetModelFormDialog
              open
              onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
              model={formState.model}
              brandItems={brandItems}
              typeItems={typeItems}
              subtypeItems={subtypeItems}
              volumeOptions={volumeOptions}
              metersEnabled={metersEnabled}
            />
          ) : null}
          <DeleteAssetModelDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            model={deleteTarget}
          />
        </>
      ) : null}
    </div>
  );
}
