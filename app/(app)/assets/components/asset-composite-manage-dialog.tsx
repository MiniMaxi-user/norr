"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Combobox,
  Dialog,
  FormGrid,
  Inline,
  Input,
  Label,
  RowCard,
  Stack,
  Text,
} from "@yourorg/ui";
import { listAssets, type AssetRecord } from "../actions";
import {
  addAssetComponent,
  listAssetComponents,
  removeAssetComponent,
  updateAssetComponent,
  type AssetComponentLineRecord,
} from "../components-actions";

const CANDIDATE_FETCH_LIMIT = 200;

export interface AssetCompositeManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentAssetId: string;
  parentAssetName: string;
  /** Fired after any add/remove/quantity change so the caller can refresh
   * both this dialog's own data (handled internally) AND the page's tree
   * view, which this dialog does not itself render. */
  onChange: () => void;
}

/**
 * The popup behind the "Composite assets" section's "Manage" button (issue
 * #125) — per `docs/ARCHITECTURE.md`'s "Popup vs. full page" rule, this is a
 * small sub-relationship-management surface (like Contacts/Sites on a
 * client), not a top-level module record, so it stays a `Dialog` rather than
 * a route. Scoped to exactly one parent asset: lists its own DIRECT
 * components only (one level — the page's own tree view, not this dialog,
 * is what shows the whole multi-level composition), with quantity-edit +
 * Remove per row, plus an "Add component" picker.
 *
 * The candidate picker is a `Combobox` backed by this org's assets
 * (`listAssets({ limit: 200 })`), fetched once per mount — same "caller
 * passes the full option list, `Combobox` filters client-side" contract
 * `ArticleComponentsEditor` already relies on (see that file's own doc
 * comment for why a remote-search mode isn't in scope here). Deliberately
 * does NOT pre-filter out assets already installed as someone else's
 * component (the org-wide `component_asset_id` uniqueness this feature's own
 * migration enforces) — only the parent itself and whatever's already added
 * to THIS parent are excluded client-side; attempting to add an
 * already-installed asset anyway surfaces `addAssetComponent`'s own clean
 * `mapAssetComponentDbError` message instead.
 */
export function AssetCompositeManageDialog({
  open,
  onOpenChange,
  parentAssetId,
  parentAssetName,
  onChange,
}: AssetCompositeManageDialogProps) {
  const [components, setComponents] = useState<AssetComponentLineRecord[]>([]);
  const [loadingComponents, setLoadingComponents] = useState(true);
  const [candidates, setCandidates] = useState<AssetRecord[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingComponents(true);
    listAssetComponents(parentAssetId)
      .then((result) => {
        if (cancelled) return;
        setComponents(result.data?.components ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingComponents(false);
      });
    setLoadingCandidates(true);
    listAssets({ limit: CANDIDATE_FETCH_LIMIT })
      .then((result) => {
        if (cancelled) return;
        setCandidates(result.data?.assets ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingCandidates(false);
      });
    return () => {
      cancelled = true;
    };
    // Runs once on mount only — this dialog is only ever mounted fresh
    // (conditional rendering from its own trigger), never reused across a
    // different `parentAssetId` via a prop update, same "mounts fresh"
    // precedent `ArticleComponentsEditor`'s identical effect documents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addedComponentAssetIds = useMemo(
    () => new Set(components.map((component) => component.component_asset_id)),
    [components],
  );
  const options = useMemo(
    () =>
      candidates
        .filter((candidate) => candidate.id !== parentAssetId && !addedComponentAssetIds.has(candidate.id))
        .map((candidate) => ({
          value: candidate.id,
          label: candidate.serial_number ? `${candidate.name} — ${candidate.serial_number}` : candidate.name,
        })),
    [candidates, parentAssetId, addedComponentAssetIds],
  );

  function handleAdd() {
    if (!selectedAssetId) {
      setError("Select an asset to add as a component.");
      return;
    }
    const parsedQuantity = Number(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setError("Enter a quantity greater than zero.");
      return;
    }
    setError(null);
    setAdding(true);
    addAssetComponent(parentAssetId, { componentAssetId: selectedAssetId, quantity: parsedQuantity })
      .then((result) => {
        if (!result.data) {
          setError(result.error ?? "Could not add this component.");
          return;
        }
        setComponents((current) => [...current, result.data!.component]);
        setSelectedAssetId("");
        setQuantity("1");
        onChange();
      })
      .finally(() => setAdding(false));
  }

  async function handleRemove(component: AssetComponentLineRecord) {
    setError(null);
    const result = await removeAssetComponent(component.id);
    if (result.error) {
      setError(result.error);
      return;
    }
    setComponents((current) => current.filter((item) => item.id !== component.id));
    onChange();
  }

  function handleQuantityChange(componentId: string, nextQuantity: number) {
    setComponents((current) =>
      current.map((item) => (item.id === componentId ? { ...item, quantity: nextQuantity } : item)),
    );
    onChange();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg">
      <Dialog.Header>
        <Text>Composite assets — {parentAssetName}</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}

          {loadingComponents ? (
            <Text tone="muted">Loading components…</Text>
          ) : components.length === 0 ? (
            <Text tone="muted">No components added yet.</Text>
          ) : (
            <Stack gap="xs">
              {components.map((component) => (
                <ComponentRow
                  key={component.id}
                  component={component}
                  onRemove={handleRemove}
                  onQuantityChange={handleQuantityChange}
                />
              ))}
            </Stack>
          )}

          <FormGrid columns={3}>
            <Stack gap="xs">
              <Label htmlFor="asset-component-picker">Add component</Label>
              <Combobox
                id="asset-component-picker"
                options={options}
                value={selectedAssetId}
                onChange={setSelectedAssetId}
                placeholder={loadingCandidates ? "Loading assets…" : "Search assets…"}
                disabled={loadingCandidates}
                clearable
                emptyMessage="No matching assets."
              />
            </Stack>
            <Stack gap="xs">
              <Label htmlFor="asset-component-quantity">Quantity</Label>
              <Input
                id="asset-component-quantity"
                type="number"
                min="0.001"
                step="0.001"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </Stack>
            <Stack gap="xs">
              <Label>&nbsp;</Label>
              <Button type="button" variant="outline" size="sm" onClick={handleAdd} disabled={adding || loadingCandidates}>
                {adding ? "Adding…" : "Add component"}
              </Button>
            </Stack>
          </FormGrid>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="primary" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}

function ComponentRow({
  component,
  onRemove,
  onQuantityChange,
}: {
  component: AssetComponentLineRecord;
  onRemove: (component: AssetComponentLineRecord) => void;
  onQuantityChange: (componentId: string, quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState(String(component.quantity));
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    const parsed = Number(quantity);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed === component.quantity) {
      setQuantity(String(component.quantity));
      return;
    }
    setSaving(true);
    setError(null);
    const result = await updateAssetComponent(component.id, { quantity: parsed });
    setSaving(false);
    if (!result.data) {
      setError(result.error ?? "Could not update quantity.");
      setQuantity(String(component.quantity));
      return;
    }
    onQuantityChange(component.id, result.data.component.quantity);
  }

  async function handleRemoveClick() {
    setRemoving(true);
    await onRemove(component);
    setRemoving(false);
  }

  return (
    <RowCard>
      <div className="ui-row-main">
        <Inline gap="xs" align="center">
          <Text className="ui-row-title">{component.component_asset?.name ?? "—"}</Text>
          {component.component_asset?.asset_status && (
            <Badge color={component.component_asset.asset_status.color}>{component.component_asset.asset_status.label}</Badge>
          )}
        </Inline>
        {component.component_asset?.serial_number && <Text tone="muted">{component.component_asset.serial_number}</Text>}
        {error && <Text tone="danger">{error}</Text>}
      </div>
      <Inline gap="xs" align="center">
        <Input
          aria-label="Quantity"
          type="number"
          min="0.001"
          step="0.001"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          onBlur={commit}
          disabled={saving || removing}
        />
        <Button type="button" variant="danger" size="sm" onClick={handleRemoveClick} disabled={saving || removing}>
          {removing ? "Removing…" : "Remove"}
        </Button>
      </Inline>
    </RowCard>
  );
}
