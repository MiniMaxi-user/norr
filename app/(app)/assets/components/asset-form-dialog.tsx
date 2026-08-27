"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Button,
  CascadingSelect,
  Combobox,
  Dialog,
  FormGrid,
  FormSection,
  Heading,
  Input,
  Label,
  Select,
  Stack,
  Text,
  Textarea,
} from "@yourorg/ui";
import { Boxes, FileText, MapPin, ShieldCheck } from "@yourorg/ui/icons";
import type { AssetRecord } from "../actions";
import { createAssetFormAction, updateAssetFormAction, type AssetFormState } from "../asset-form-actions";
import { listClients, listSites, type ClientRecord, type SiteRecord } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { useEscapeToClose } from "@/app/(app)/clients/use-escape-to-close";
import { listReferenceItems, type ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { listAssetModels, type AssetModelRecord } from "@/lib/asset-models/actions";

const initialState: AssetFormState = { ok: false };

export interface AssetFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** Required for `mode: "edit"`. */
  asset?: AssetRecord;
  /** Pre-scopes the site picker to a single client's sites and hides the
   * client selector entirely — used when this dialog is opened in a
   * client-scoped context (the Clients detail page's Assets tab). */
  lockedClientId?: string;
  /** Pre-selects (but doesn't lock) the site — the user can still change it
   * to any other site of the same (locked or picked) client. */
  initialSiteId?: string;
}

/**
 * Create/edit dialog for an asset (issue #53 — "Asset edit pagina is
 * omgebouwd als slider popup"). An explicit, product-owner-confirmed
 * override of the general "top-level module records get a real page, not a
 * Dialog" rule (docs/ARCHITECTURE.md "Popup vs. full page") — the same kind
 * of carve-out already granted to Clients (issue #43/#46), just for Assets
 * this time; see that doc section's own note. Replaces the previous
 * full-page `/assets/new` and `/assets/[id]/edit` routes (both deleted) —
 * every trigger (`CreateAssetButton`, `AssetDetailActions`, `AssetsTable`,
 * `SiteAssetsTable`) now owns local `open`/`asset` dialog state instead of
 * navigating, matching how `SiteFormDialog`/`ContactFormDialog` already work.
 *
 * Self-fetches every reference-data list it needs (clients, asset types/
 * statuses/sub-types/brands, asset models) on open, the same way `listSites`
 * was already called directly from client code in the old `asset-form.tsx` —
 * this keeps every call site a thin trigger with no page-level prop-threading
 * of picklists required.
 *
 * Structurally split into this outer component (owns `useActionState`, so a
 * failed submit's error/fieldErrors survive across whatever else re-renders)
 * and `AssetFormBody` below (owns every other piece of local state —
 * selected client/type/brand/model/sub-type, fetched sites/options — which
 * lives INSIDE `<Dialog>`'s children and therefore gets a guaranteed-fresh
 * remount every time the dialog opens, even when this same `AssetFormDialog`
 * instance is reused across different rows/assets, since `Dialog` itself
 * returns `null` while `open` is false). Same split `site-form-dialog.tsx`
 * uses for its own `SiteFormBody`, for the same reason.
 */
export function AssetFormDialog({ open, onOpenChange, mode, asset, lockedClientId, initialSiteId }: AssetFormDialogProps) {
  const isEdit = mode === "edit" && Boolean(asset);
  const router = useRouter();
  useEscapeToClose(open, onOpenChange);

  const action = isEdit && asset ? updateAssetFormAction.bind(null, asset.id) : createAssetFormAction;
  const [state, formAction] = useActionState(action, initialState);

  useEffect(() => {
    if (state.ok) {
      onOpenChange(false);
      router.refresh();
    }
    // Depends on the whole `state` object, not `state.ok` — same reasoning as
    // `ContactFormDialog`'s identical fix (see its own doc comment): this
    // dialog instance is reused across multiple opens (different rows), so a
    // second successful save in the same session would otherwise produce a
    // new `state` object whose `ok` field is still literally `true`, which a
    // `[state.ok]` dependency can't tell apart from "no change".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="panel">
      <Dialog.Header>
        <Heading level={3}>{isEdit ? `Edit ${asset?.name ?? "asset"}` : "Add asset"}</Heading>
      </Dialog.Header>
      <AssetFormBody
        mode={mode}
        asset={asset}
        lockedClientId={lockedClientId}
        initialSiteId={initialSiteId}
        formAction={formAction}
        state={state}
        onCancel={() => onOpenChange(false)}
      />
    </Dialog>
  );
}

function SubmitButton({ mode, disabled }: { mode: "create" | "edit"; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending || disabled}>
      {pending ? "Saving…" : mode === "create" ? "Add asset" : "Save changes"}
    </Button>
  );
}

interface AssetFormBodyProps {
  mode: "create" | "edit";
  asset?: AssetRecord;
  lockedClientId?: string;
  initialSiteId?: string;
  formAction: (formData: FormData) => void;
  state: AssetFormState;
  onCancel: () => void;
}

/**
 * The actual `<form>` — every field, plus the cascading Brand/Type/Sub-type/
 * Model logic (issue #53's fill-up/fill-down acceptance criteria). Lives
 * inside `<Dialog>`'s children (see `AssetFormDialog`'s doc comment above),
 * so its `useState`s and the fetch-on-mount effect below are guaranteed
 * fresh every time the dialog opens.
 *
 * Field order follows issue #53 exactly: "Serialnumber, Asset ID, Model,
 * manufacturer, dan de rest" — the first `FormGrid` pairs Serial number +
 * Asset ID, the second pairs Model + Manufacturer, everything else follows
 * in whatever order reads well across the remaining `FormSection`s (mirrors
 * `site-form-dialog.tsx`'s own "group related fields, 2-column where the
 * panel is wide enough" convention).
 */
function AssetFormBody({ mode, asset, lockedClientId, initialSiteId, formAction, state, onCancel }: AssetFormBodyProps) {
  const isEdit = mode === "edit" && Boolean(asset);

  const [selectedClientId, setSelectedClientId] = useState(lockedClientId ?? asset?.client_id ?? "");
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);

  // Controlled (not `defaultValue`/remount-via-`key`, unlike the old
  // full-page form's Sub-type field) because selecting a Model needs to be
  // able to push a value into Type/Sub-type/Brand simultaneously (the
  // "fill-up" cascade below) — a single controlled set of ids is far simpler
  // to keep in sync than juggling multiple independent remount keys.
  const [selectedTypeId, setSelectedTypeId] = useState(asset?.type_id ?? "");
  const [selectedSubtypeId, setSelectedSubtypeId] = useState(asset?.subtype_id ?? "");
  const [selectedBrandId, setSelectedBrandId] = useState(asset?.brand_item_id ?? "");
  const [selectedModelId, setSelectedModelId] = useState(asset?.model_id ?? "");

  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [assetTypes, setAssetTypes] = useState<ReferenceListItemRecord[]>([]);
  const [assetStatuses, setAssetStatuses] = useState<ReferenceListItemRecord[]>([]);
  const [assetSubtypes, setAssetSubtypes] = useState<ReferenceListItemRecord[]>([]);
  const [assetBrands, setAssetBrands] = useState<ReferenceListItemRecord[]>([]);
  const [assetModels, setAssetModels] = useState<AssetModelRecord[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingOptions(true);
    Promise.all([
      lockedClientId ? Promise.resolve(null) : listClients({ limit: 200 }),
      listReferenceItems("asset_type"),
      listReferenceItems("asset_status"),
      listReferenceItems("asset_subtype"),
      listReferenceItems("asset_brand"),
      listAssetModels(),
    ])
      .then(([clientsResult, typesResult, statusesResult, subtypesResult, brandsResult, modelsResult]) => {
        if (cancelled) return;
        setClients(clientsResult?.data?.clients ?? []);
        setAssetTypes(typesResult.data?.items ?? []);
        setAssetStatuses(statusesResult.data?.items ?? []);
        setAssetSubtypes(subtypesResult.data?.items ?? []);
        setAssetBrands(brandsResult.data?.items ?? []);
        setAssetModels(modelsResult.data?.models ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
    // Runs once on mount only — this component remounts fresh every dialog
    // open (see `AssetFormDialog`'s doc comment), so there's no case where
    // `lockedClientId` changes under an already-mounted instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedClientId) {
      setSites([]);
      return;
    }
    let cancelled = false;
    setLoadingSites(true);
    listSites(selectedClientId)
      .then((result) => {
        if (cancelled) return;
        setSites(result.data?.sites ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingSites(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedClientId]);

  const defaultStatus = assetStatuses.find((item) => item.is_default);

  // Issue #53: "Bij het aanmaken van een asset wordt het primary adres
  // voorgevuld (als dit een bezoekadres is)" — on create only, once this
  // client's sites are loaded, default the Site select to whichever one is
  // flagged both primary AND a visit address, unless a site was already
  // implied some other way (editing an existing asset, or an explicit
  // `initialSiteId`).
  const autoPrimaryVisitSiteId = !isEdit
    ? sites.find((site) => site.is_primary && site.is_visit_address)?.id
    : undefined;
  const defaultSiteId = asset?.site_id ?? initialSiteId ?? autoPrimaryVisitSiteId ?? "";

  const brandOptions = useMemo(
    () => assetBrands.map((item) => ({ value: item.id, label: item.label })),
    [assetBrands],
  );

  // Cascading-filtered by whichever of Type/Brand is currently selected
  // (issue #53: Model is "cascading-filtered by the currently-selected Brand
  // and Type") — neither is required first, since picking a Model can itself
  // fill Type/Brand in (the fill-up handler below).
  const modelOptions = useMemo(
    () =>
      assetModels
        .filter(
          (model) =>
            (!selectedTypeId || model.type_item_id === selectedTypeId) &&
            (!selectedBrandId || model.brand_item_id === selectedBrandId),
        )
        .map((model) => ({ value: model.id, label: model.name })),
    [assetModels, selectedTypeId, selectedBrandId],
  );

  const subtypeCascadeOptions = useMemo(
    () => assetSubtypes.map((item) => ({ id: item.id, label: item.label, parentId: item.parent_item_id ?? "" })),
    [assetSubtypes],
  );

  /** Fill-down: changing Type clears a now-mismatched Sub-type (already the
   * case before this issue) AND a now-mismatched Model — new for issue #53,
   * since Model sits "under" both Type and Brand. */
  function handleTypeChange(nextTypeId: string) {
    setSelectedTypeId(nextTypeId);
    setSelectedSubtypeId((prev) => {
      if (!prev) return prev;
      const item = assetSubtypes.find((candidate) => candidate.id === prev);
      return item?.parent_item_id === nextTypeId ? prev : "";
    });
    setSelectedModelId((prev) => {
      if (!prev) return prev;
      const model = assetModels.find((candidate) => candidate.id === prev);
      if (!model) return prev;
      const stillMatches =
        model.type_item_id === nextTypeId && (!selectedBrandId || model.brand_item_id === selectedBrandId);
      return stillMatches ? prev : "";
    });
  }

  /** Fill-down: changing Manufacturer (Brand) clears a now-mismatched Model. */
  function handleBrandChange(nextBrandId: string) {
    setSelectedBrandId(nextBrandId);
    setSelectedModelId((prev) => {
      if (!prev) return prev;
      const model = assetModels.find((candidate) => candidate.id === prev);
      if (!model) return prev;
      const stillMatches =
        model.brand_item_id === nextBrandId && (!selectedTypeId || model.type_item_id === selectedTypeId);
      return stillMatches ? prev : "";
    });
  }

  /** Fill-up: selecting a Model auto-fills Type, Sub-type, and Manufacturer
   * (Brand) from that model's own reference-item ids — already resolved
   * client-side from the `listAssetModels()` fetch above, no extra round
   * trip needed. */
  function handleModelChange(nextModelId: string) {
    setSelectedModelId(nextModelId);
    if (!nextModelId) return;
    const model = assetModels.find((candidate) => candidate.id === nextModelId);
    if (!model) return;
    setSelectedTypeId(model.type_item_id);
    setSelectedBrandId(model.brand_item_id);
    setSelectedSubtypeId(model.subtype_item_id ?? "");
  }

  const siteField = (
    <Stack gap="xs">
      <Label htmlFor="asset-site">Site</Label>
      <Select
        id="asset-site"
        name="siteId"
        key={selectedClientId}
        defaultValue={defaultSiteId}
        required
        disabled={!selectedClientId || loadingSites}
      >
        <option value="" disabled>
          {loadingSites ? "Loading sites…" : "Select a site…"}
        </option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {formatSiteAddressShort(site) ?? "Unnamed site"}
          </option>
        ))}
      </Select>
      {state.fieldErrors?.siteId?.map((message) => (
        <Text key={message} tone="danger">
          {message}
        </Text>
      ))}
      {selectedClientId && !loadingSites && sites.length === 0 && (
        <Text tone="muted">This client has no sites yet — add one from the Clients module first.</Text>
      )}
    </Stack>
  );

  return (
    <form action={formAction}>
      <Dialog.Body>
        <Stack gap="lg">
          {state.error && <Text tone="danger">{state.error}</Text>}

          <FormSection title="Equipment" icon={<Boxes />}>
            <FormGrid columns={2}>
              <Stack gap="xs">
                <Label htmlFor="asset-serial">Serial number</Label>
                <Input id="asset-serial" name="serialNumber" defaultValue={asset?.serial_number ?? ""} maxLength={200} />
                {state.fieldErrors?.serialNumber?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
              <Stack gap="xs">
                <Label htmlFor="asset-name">Asset ID</Label>
                <Input
                  id="asset-name"
                  name="name"
                  defaultValue={asset?.name}
                  required
                  maxLength={200}
                  placeholder="e.g. AST-00042"
                />
                {state.fieldErrors?.name?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
            </FormGrid>

            <FormGrid columns={2}>
              <Stack gap="xs">
                <Label htmlFor="asset-model">Model</Label>
                <Combobox
                  id="asset-model"
                  name="modelId"
                  options={modelOptions}
                  value={selectedModelId}
                  onChange={handleModelChange}
                  placeholder="Search models…"
                  disabled={loadingOptions}
                  clearable
                  emptyMessage="No matching models — add one from Settings first."
                />
                {state.fieldErrors?.modelId?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
              <Stack gap="xs">
                <Label htmlFor="asset-manufacturer">Manufacturer</Label>
                <Combobox
                  id="asset-manufacturer"
                  name="brandItemId"
                  options={brandOptions}
                  value={selectedBrandId}
                  onChange={handleBrandChange}
                  placeholder="Search manufacturers…"
                  disabled={loadingOptions}
                  clearable
                  emptyMessage="No manufacturers yet — add one on the Asset Brand tab first."
                />
                {state.fieldErrors?.brandItemId?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
            </FormGrid>

            <FormGrid columns={2}>
              <Stack gap="xs">
                <Label htmlFor="asset-type">Type</Label>
                <Select
                  id="asset-type"
                  name="typeId"
                  value={selectedTypeId}
                  onChange={(event) => handleTypeChange(event.target.value)}
                  required
                  disabled={loadingOptions}
                >
                  <option value="" disabled>
                    Select a type…
                  </option>
                  {assetTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
                {state.fieldErrors?.typeId?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
                {!loadingOptions && assetTypes.length === 0 && (
                  <Text tone="muted">No asset types configured yet — add one from Settings first.</Text>
                )}
              </Stack>
              <Stack gap="xs">
                <Label htmlFor="asset-subtype">Sub-type</Label>
                <CascadingSelect
                  id="asset-subtype"
                  name="subtypeId"
                  value={selectedSubtypeId}
                  onChange={(event) => setSelectedSubtypeId(event.target.value)}
                  parentValue={selectedTypeId}
                  options={subtypeCascadeOptions}
                  placeholder="No sub-type"
                  emptyParentPlaceholder="Select a type first…"
                  disabled={loadingOptions}
                />
                {state.fieldErrors?.subtypeId?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
            </FormGrid>
          </FormSection>

          <FormSection title="Location" icon={<MapPin />}>
            {lockedClientId ? (
              siteField
            ) : (
              <FormGrid columns={2}>
                <Stack gap="xs">
                  <Label htmlFor="asset-client">Client</Label>
                  <Select
                    id="asset-client"
                    value={selectedClientId}
                    onChange={(event) => setSelectedClientId(event.target.value)}
                    required
                    disabled={loadingOptions}
                  >
                    <option value="" disabled>
                      Select a client…
                    </option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </Select>
                </Stack>
                {siteField}
              </FormGrid>
            )}
          </FormSection>

          <FormSection title="Status & warranty" icon={<ShieldCheck />}>
            <FormGrid columns={2}>
              <Stack gap="xs">
                <Label htmlFor="asset-status">Status</Label>
                <Select
                  id="asset-status"
                  name="statusId"
                  defaultValue={asset?.status_id ?? ""}
                  disabled={loadingOptions}
                >
                  <option value="">{defaultStatus ? `Use default (${defaultStatus.label})` : "Use organization default"}</option>
                  {assetStatuses.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
                {state.fieldErrors?.statusId?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
              <Stack gap="xs">
                <Label htmlFor="asset-external-reference">External reference</Label>
                <Input
                  id="asset-external-reference"
                  name="externalReference"
                  defaultValue={asset?.external_reference ?? ""}
                  maxLength={200}
                />
                {state.fieldErrors?.externalReference?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
            </FormGrid>

            <FormGrid columns={2}>
              <Stack gap="xs">
                <Label htmlFor="asset-installed">Installed on</Label>
                <Input id="asset-installed" name="installedAt" type="date" defaultValue={asset?.installed_at ?? ""} />
                {state.fieldErrors?.installedAt?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
              <Stack gap="xs">
                <Label htmlFor="asset-warranty">Warranty until</Label>
                <Input id="asset-warranty" name="warrantyUntil" type="date" defaultValue={asset?.warranty_until ?? ""} />
                {state.fieldErrors?.warrantyUntil?.map((message) => (
                  <Text key={message} tone="danger">
                    {message}
                  </Text>
                ))}
              </Stack>
            </FormGrid>
          </FormSection>

          <FormSection title="Notes" icon={<FileText />}>
            <Stack gap="xs">
              <Label htmlFor="asset-notes">Notes</Label>
              <Textarea id="asset-notes" name="notes" defaultValue={asset?.notes ?? ""} rows={3} />
            </Stack>
          </FormSection>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton mode={mode} disabled={loadingOptions} />
      </Dialog.Footer>
    </form>
  );
}
