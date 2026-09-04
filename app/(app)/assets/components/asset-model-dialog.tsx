"use client";

import { useMemo, useRef, useState } from "react";
import { Button, Combobox, Dialog, Label, Stack, Text } from "@yourorg/ui";
import type { AssetModelRecord } from "@/lib/asset-models/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { AssetDraft } from "./asset-draft";

export interface AssetModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: Pick<AssetDraft, "modelId" | "brandItemId" | "typeId" | "subtypeId" | "installedAt" | "warrantyUntil">;
  assetModels: AssetModelRecord[];
  assetBrands: ReferenceListItemRecord[];
  onSave: (
    patch: Partial<Pick<AssetDraft, "modelId" | "brandItemId" | "typeId" | "subtypeId" | "warrantyUntil">>,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * The Model card's edit popup (asset new/edit design handoff v3) — the exact
 * Model + Manufacturer `Combobox` pair `asset-form-screen.tsx`'s old
 * Equipment section used to own, relocated here rather than rebuilt: the
 * mock's "Model" relation card visually folds Manufacturer into it (e.g.
 * "Kyocera ECOSYS M5526cdw"), but `brandItemId` stays its own independently-
 * settable field (you can know the manufacturer without knowing the exact
 * model), so this popup keeps both pickers together instead of forcing a
 * single-value field that doesn't exist in the schema. Ported fill-up/fill-
 * down logic, unchanged: picking a Model fills Type + Sub-type + Brand (and
 * proposes a warranty date when one isn't already set); changing Manufacturer
 * clears a now-mismatched Model.
 */
export function AssetModelDialog({ open, onOpenChange, draft, assetModels, assetBrands, onSave }: AssetModelDialogProps) {
  const [modelId, setModelId] = useState(draft.modelId);
  const [brandId, setBrandId] = useState(draft.brandItemId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same "was a warranty date already known when this popup opened" rule
  // `asset-form-screen.tsx`'s `warrantyTouchedRef` used — an existing,
  // already-set warranty is treated as manually touched so re-picking a
  // model here never silently overwrites it; a still-empty one gets the
  // model's own `default_warranty_months` proposal.
  const warrantyTouchedRef = useRef(Boolean(draft.warrantyUntil));

  const [typeId, setTypeId] = useState(draft.typeId);
  const [subtypeId, setSubtypeId] = useState(draft.subtypeId);
  const [warrantyUntil, setWarrantyUntil] = useState(draft.warrantyUntil);

  const brandOptions = useMemo(() => assetBrands.map((item) => ({ value: item.id, label: item.label })), [assetBrands]);
  const modelOptions = useMemo(
    () =>
      assetModels
        .filter((model) => (!typeId || model.type_item_id === typeId) && (!brandId || model.brand_item_id === brandId))
        .map((model) => ({ value: model.id, label: model.name })),
    [assetModels, typeId, brandId],
  );

  function handleModelChange(nextModelId: string) {
    setModelId(nextModelId);
    if (!nextModelId) return;
    const model = assetModels.find((candidate) => candidate.id === nextModelId);
    if (!model) return;
    setTypeId(model.type_item_id);
    setBrandId(model.brand_item_id);
    setSubtypeId(model.subtype_item_id ?? "");

    if (!warrantyTouchedRef.current && draft.installedAt) {
      const base = new Date(`${draft.installedAt}T00:00:00`);
      if (!Number.isNaN(base.getTime())) {
        base.setMonth(base.getMonth() + model.default_warranty_months);
        setWarrantyUntil(base.toISOString().slice(0, 10));
      }
    }
  }

  function handleBrandChange(nextBrandId: string) {
    setBrandId(nextBrandId);
    setModelId((prev) => {
      if (!prev) return prev;
      const model = assetModels.find((candidate) => candidate.id === prev);
      if (!model) return prev;
      const stillMatches = model.brand_item_id === nextBrandId && (!typeId || model.type_item_id === typeId);
      return stillMatches ? prev : "";
    });
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const result = await onSave({
      modelId,
      brandItemId: brandId,
      typeId: typeId || draft.typeId,
      subtypeId,
      warrantyUntil,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save.");
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>Model &amp; manufacturer</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="xs">
            <Label htmlFor="asset-model-dialog-model">Model</Label>
            <Combobox
              id="asset-model-dialog-model"
              options={modelOptions}
              value={modelId}
              onChange={handleModelChange}
              placeholder="Search models…"
              clearable
              emptyMessage="No matching models — add one from Settings first."
            />
          </Stack>
          <Stack gap="xs">
            <Label htmlFor="asset-model-dialog-brand">Manufacturer</Label>
            <Combobox
              id="asset-model-dialog-brand"
              options={brandOptions}
              value={brandId}
              onChange={handleBrandChange}
              placeholder="Search manufacturers…"
              clearable
              emptyMessage="No manufacturers yet — add one on the Asset Brand tab first."
            />
          </Stack>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
