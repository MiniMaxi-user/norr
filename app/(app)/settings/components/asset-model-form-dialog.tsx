"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Combobox } from "@yourorg/ui";
import { createAssetModel, updateAssetModel, type AssetModelRecord, type VolumeCounterOption } from "@/lib/asset-models/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { DialogField, SettingsFormDialog } from "./settings-dialog-kit";

interface FormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: boolean;
}

const initialState: FormState = {};

export interface AssetModelFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present for edit, absent for create — same `isEdit = Boolean(model)`
   * convention as `ReferenceItemFormDialog`. */
  model?: AssetModelRecord | null;
  brandItems: ReferenceListItemRecord[];
  typeItems: ReferenceListItemRecord[];
  /** Every org's `asset_subtype` items, across every Type — filtered down to
   * the selected Type's own children below (docs/ARCHITECTURE.md "Domain
   * completeness"'s cascading-select pattern), re-filtered whenever the
   * Type field changes. */
  subtypeItems: ReferenceListItemRecord[];
  /** Counters (Volume list items). Retired ones are only offered when
   * already configured on this model. */
  volumeOptions: VolumeCounterOption[];
  /** `meters` module on: show the counters picker and send counters (#247). */
  metersEnabled: boolean;
}

/**
 * Create/edit dialog for a single `public.asset_models` row (issue #54).
 * Not built on the generic `ReferenceItemFormDialog`/`ReferenceListManager`
 * pair — a Model has three simultaneous reference-list relationships
 * (Brand/Type/Sub-type) plus its own `default_warranty_months` field, none
 * of which that generic single-list mechanism knows about (see the design
 * note atop `supabase/migrations/20260826160000_asset_brand_and_models.sql`).
 * Every field is a real `@yourorg/ui` `Combobox` (issue #54's own acceptance
 * criteria: "Alle zoekvelden zijn Search velden met dropdown met opties")
 * rather than a plain `Select`, matching this codebase's small/secondary
 * "a Dialog is still fine" bar (docs/ARCHITECTURE.md "Popup vs. full page")
 * since Asset Model is a sub-entity reached from Settings, not a top-level
 * module record.
 */
export function AssetModelFormDialog({
  open,
  onOpenChange,
  model,
  brandItems,
  typeItems,
  subtypeItems,
  volumeOptions,
  metersEnabled,
}: AssetModelFormDialogProps) {
  const isEdit = Boolean(model);
  const router = useRouter();

  const [brandItemId, setBrandItemId] = useState(model?.brand_item_id ?? "");
  const [typeItemId, setTypeItemId] = useState(model?.type_item_id ?? "");
  const [subtypeItemId, setSubtypeItemId] = useState(model?.subtype_item_id ?? "");
  const [volumeItemIds, setVolumeItemIds] = useState<string[]>(model?.volumeItemIds ?? []);

  useEffect(() => {
    setBrandItemId(model?.brand_item_id ?? "");
    setTypeItemId(model?.type_item_id ?? "");
    setSubtypeItemId(model?.subtype_item_id ?? "");
    setVolumeItemIds(model?.volumeItemIds ?? []);
  }, [model]);

  const selectableVolumes = useMemo(
    () => volumeOptions.filter((option) => option.isActive || volumeItemIds.includes(option.id)),
    [volumeOptions, volumeItemIds],
  );

  function toggleVolume(id: string, checked: boolean) {
    setVolumeItemIds((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  }

  const brandOptions = useMemo(
    () => brandItems.map((item) => ({ value: item.id, label: item.label })),
    [brandItems],
  );
  const typeOptions = useMemo(() => typeItems.map((item) => ({ value: item.id, label: item.label })), [typeItems]);
  // Cascading-select filter (docs/ARCHITECTURE.md "Domain completeness"):
  // only Sub-type items whose own `parent_item_id` equals the currently
  // selected Type, re-derived whenever `typeItemId` changes.
  const subtypeOptions = useMemo(
    () =>
      subtypeItems
        .filter((item) => item.parent_item_id === typeItemId)
        .map((item) => ({ value: item.id, label: item.label })),
    [subtypeItems, typeItemId],
  );

  function handleTypeChange(nextTypeItemId: string) {
    setTypeItemId(nextTypeItemId);
    // A Sub-type carried over from the PREVIOUS Type is no longer valid
    // under the new one — clear it every time Type changes, the same
    // cascade-integrity rule `validate_asset_model_reference_items` enforces
    // server-side (a stale Sub-type from a different Type would otherwise
    // violate that trigger on save).
    setSubtypeItemId("");
  }

  async function action(_prevState: FormState, formData: FormData): Promise<FormState> {
    const input = {
      brandItemId: formData.get("brandItemId"),
      typeItemId: formData.get("typeItemId"),
      subtypeItemId: formData.get("subtypeItemId") || undefined,
      name: formData.get("name"),
      defaultWarrantyMonths: formData.get("defaultWarrantyMonths"),
      // Meters off: leave the model's counters untouched (omitted = unchanged on edit).
      ...(metersEnabled ? { volumeItemIds } : {}),
    };
    const result = isEdit ? await updateAssetModel(model!.id, input) : await createAssetModel(input);
    if (result.error || !result.data) {
      return { error: result.error ?? "Something went wrong.", fieldErrors: result.fieldErrors };
    }
    return { success: true };
  }

  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success) {
      onOpenChange(false);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <SettingsFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit model" : "Add model"}
      submitLabel={isEdit ? "Save changes" : "Add model"}
      formAction={formAction}
      error={state.error}
    >
      <DialogField id="asset-model-brand" label="Brand" errors={state.fieldErrors?.brandItemId}>
        <Combobox
          id="asset-model-brand"
          name="brandItemId"
          options={brandOptions}
          value={brandItemId}
          onChange={setBrandItemId}
          placeholder="Search brands…"
          required
          emptyMessage="No brand values yet — add one on the Asset Brand list first."
        />
      </DialogField>

      <DialogField id="asset-model-type" label="Type" errors={state.fieldErrors?.typeItemId}>
        <Combobox
          id="asset-model-type"
          name="typeItemId"
          options={typeOptions}
          value={typeItemId}
          onChange={handleTypeChange}
          placeholder="Search types…"
          required
          emptyMessage="No type values yet — add one on the Asset Type list first."
        />
      </DialogField>

      <DialogField
        id="asset-model-subtype"
        label="Sub-type"
        hint="Optional — only sub-types that belong under the selected Type are shown."
        errors={state.fieldErrors?.subtypeItemId}
      >
        <Combobox
          id="asset-model-subtype"
          name="subtypeItemId"
          options={subtypeOptions}
          value={subtypeItemId}
          onChange={setSubtypeItemId}
          placeholder={typeItemId ? "Search sub-types… (optional)" : "Select a type first…"}
          disabled={!typeItemId}
          clearable
          emptyMessage="No sub-type values under this type."
        />
      </DialogField>

      <DialogField id="asset-model-name" label="Name" errors={state.fieldErrors?.name}>
        <input
          id="asset-model-name"
          className="web-input"
          name="name"
          defaultValue={model?.name}
          required
          maxLength={200}
          placeholder="e.g. TASKalfa 3554ci"
        />
      </DialogField>

      <DialogField id="asset-model-warranty" label="Default warranty (months)" errors={state.fieldErrors?.defaultWarrantyMonths}>
        <input
          id="asset-model-warranty"
          className="web-input"
          name="defaultWarrantyMonths"
          type="number"
          data-numeric="true"
          min={1}
          max={600}
          step={1}
          defaultValue={model?.default_warranty_months ?? 24}
          required
        />
      </DialogField>

      {metersEnabled ? (
      <DialogField
        id="asset-model-volumes"
        label="Volumes (counters)"
        hint="Counters whose readings can be recorded on assets of this model."
        errors={state.fieldErrors?.volumeItemIds}
      >
        {selectableVolumes.length === 0 ? (
          <p className="web-rail-empty">No counters yet — add one under Settings, Reference Lists, Volume first.</p>
        ) : (
          <div className="web-dialog-form" role="group" aria-label="Volumes (counters)" id="asset-model-volumes">
            {selectableVolumes.map((option) => (
              <label key={option.id} className="web-field-checkbox">
                <input
                  type="checkbox"
                  checked={volumeItemIds.includes(option.id)}
                  onChange={(event) => toggleVolume(option.id, event.target.checked)}
                />
                {option.label}
                {option.unitLabel ? ` (${option.unitLabel})` : ""}
                {option.isActive ? "" : " — retired"}
              </label>
            ))}
          </div>
        )}
      </DialogField>
      ) : null}
    </SettingsFormDialog>
  );
}
