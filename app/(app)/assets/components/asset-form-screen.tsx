"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Badge,
  Breadcrumbs,
  Button,
  Callout,
  Card,
  CascadingSelect,
  Combobox,
  DetailColumns,
  FormGrid,
  FormSaveBar,
  FormSection,
  Input,
  KeyValueList,
  Label,
  RecordHeroBand,
  RelationCard,
  SectionHeader,
  Select,
  Stack,
  Text,
  Textarea,
  type BreadcrumbItem,
} from "@yourorg/ui";
import {
  Boxes,
  Building2,
  CalendarDays,
  CircleHelp,
  ClipboardList,
  FileText,
  MapPin,
  ShieldCheck,
} from "@yourorg/ui/icons";
import type { AssetRecord } from "../actions";
import { createAssetFormAction, updateAssetFormAction, type AssetFormState } from "../asset-form-actions";
import { getClient, listClients, listSites, type ClientRecord, type SiteRecord } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { listReferenceItems, type ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { listAssetModels, type AssetModelRecord } from "@/lib/asset-models/actions";
import { formatDate, formatDateTime } from "@/lib/format/date";
import { usePageHeader } from "@/components/shell/page-header-context";
import { AssetRelationsDialog } from "./asset-relations-dialog";
import { DeleteAssetDialog } from "./delete-asset-dialog";

const initialState: AssetFormState = { ok: false };

export interface AssetLinkedRecordsSummary {
  canSeeWorkOrders: boolean;
  workOrderCount: number;
  canSeeContracts: boolean;
  contractCount: number;
  canSeeActivities: boolean;
  activityCount: number;
  canCreateActivity: boolean;
}

export interface AssetFormScreenProps {
  mode: "create" | "edit";
  /** Built by the server `page.tsx` ("Assets / New asset" for create,
   * "Assets / {asset name}" for edit) and pushed into the Topbar via
   * `usePageHeader` — never rendered inline, same pattern
   * `asset-detail.tsx`/`WorkOrderScreen` already use. */
  breadcrumbItems: BreadcrumbItem[];
  /** Required for `mode: "edit"`. */
  asset?: AssetRecord;
  /** Pre-scopes and LOCKS the Client relation card (hides its picker
   * entirely in `AssetRelationsDialog`) — the Clients detail page's Assets
   * tab, or `/assets/new?clientId=...`. */
  lockedClientId?: string;
  /** Pre-selects (but doesn't lock) the site. */
  initialSiteId?: string;
  /** Where Cancel navigates — the Assets list, the locked client's own page,
   * or (edit mode) this asset's own detail page. */
  cancelHref: string;
  /** Edit mode only — `can(actor, "assets", "delete")`. */
  canDelete?: boolean;
  /** Edit mode only — see `[id]/edit/page.tsx` for how each count/gate is
   * resolved server-side (each a separately-entitled module, checked before
   * the count is even fetched, same "don't fetch/render what can't be seen"
   * rule every other cross-module surface in this codebase follows).
   * `undefined` in create mode (nothing to link yet). */
  linkedRecords?: AssetLinkedRecordsSummary;
}

/**
 * Full-page create/edit screen for an Asset (asset new/edit design handoff,
 * variant A — "form-first") — replaces the `AssetFormDialog` slide-in panel
 * (issue #53), per the product owner's confirmed reversal of that decision;
 * see `docs/ARCHITECTURE.md`'s "Popup vs. full page" section. One shared
 * screen behind both `/assets/new` and `/assets/[id]/edit`, same "one real
 * screen, not two" shape `WorkOrderScreen` already established for Work
 * Orders.
 *
 * Structurally split into this outer component (owns `useActionState`, so a
 * failed submit's `error`/`fieldErrors` survive across whatever else
 * re-renders) and `AssetFormScreenBody` below (owns every other piece of
 * local state — selected client/site/type/brand/subtype/model, fetched
 * reference-data lists, dirty tracking), same split `asset-form-dialog.tsx`
 * used between `AssetFormDialog`/`AssetFormBody`.
 */
export function AssetFormScreen(props: AssetFormScreenProps) {
  const { mode, asset } = props;
  const isEdit = mode === "edit" && Boolean(asset);
  const action = isEdit && asset ? updateAssetFormAction.bind(null, asset.id) : createAssetFormAction;
  const [state, formAction] = useActionState(action, initialState);

  return <AssetFormScreenBody {...props} formAction={formAction} state={state} />;
}

function SaveButton({ mode, disabled }: { mode: "create" | "edit"; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending || disabled}>
      {pending ? "Saving…" : mode === "create" ? "Create asset" : "Save changes"}
    </Button>
  );
}

interface AssetFormScreenBodyProps extends AssetFormScreenProps {
  formAction: (formData: FormData) => void;
  state: AssetFormState;
}

function AssetFormScreenBody({
  mode,
  breadcrumbItems,
  asset,
  lockedClientId,
  initialSiteId,
  cancelHref,
  canDelete,
  linkedRecords,
  formAction,
  state,
}: AssetFormScreenBodyProps) {
  const isEdit = mode === "edit" && Boolean(asset);
  const router = useRouter();

  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  useEffect(() => {
    if (state.ok && state.asset) {
      router.push(`/assets/${state.asset.id}`);
    }
    // Depends on the whole `state` object — same reasoning as
    // `AssetFormDialog`'s identical effect (a second successful save in the
    // same session would otherwise produce a new `state` object whose `ok`
    // field is still literally `true`, which a `[state.ok]` dependency can't
    // tell apart from "no change"). Not a concern for THIS page (it navigates
    // away on success, so there's no "same instance, second save" case) but
    // kept consistent with the pattern this was ported from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const [dirty, setDirty] = useState(false);
  function markDirty() {
    setDirty(true);
  }

  // Warns on a hard refresh/tab close while dirty — the closest equivalent
  // this codebase has today to a real in-app "block navigation" guard (no
  // such router-level guard exists anywhere else in the app to reuse or
  // extend; building one from scratch is out of scope for this UI-only
  // migration). In-app navigation (Cancel, the sidebar, a breadcrumb) is NOT
  // intercepted.
  useEffect(() => {
    if (!dirty) return undefined;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  // ---- Relations (Client/Site) ---------------------------------------
  const [selectedClientId, setSelectedClientId] = useState(lockedClientId ?? asset?.client_id ?? "");
  const [selectedSiteId, setSelectedSiteId] = useState(asset?.site_id ?? initialSiteId ?? "");
  // The client currently being scoped for the SITES list — mirrors
  // `selectedClientId` except while `AssetRelationsDialog` is open and the
  // user is previewing a different candidate client (see `onClientChange`
  // below); same "committed vs. scoping" split `WorkOrderScreen`'s
  // `scopingClientId` uses for its own relation cards.
  const [scopingClientId, setScopingClientId] = useState(selectedClientId);
  useEffect(() => {
    setScopingClientId(selectedClientId);
  }, [selectedClientId]);

  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [relationsOpen, setRelationsOpen] = useState(false);

  useEffect(() => {
    if (!scopingClientId) {
      setSites([]);
      return;
    }
    let cancelled = false;
    setLoadingSites(true);
    listSites(scopingClientId)
      .then((result) => {
        if (!cancelled) setSites(result.data?.sites ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoadingSites(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scopingClientId]);

  // Issue #53's "primary visit address prefills on create" default, ported
  // from `asset-form-dialog.tsx`'s `autoPrimaryVisitSiteId` — applied ONCE,
  // for the initial (locked or pre-selected) client only, not re-applied
  // every time `scopingClientId` changes (that would also fire while a user
  // is merely PREVIEWING a different candidate client inside
  // `AssetRelationsDialog`, before ever clicking that dialog's own Save).
  const autoSiteAppliedRef = useRef(false);
  useEffect(() => {
    if (isEdit || autoSiteAppliedRef.current) return;
    if (scopingClientId !== selectedClientId) return;
    if (selectedSiteId) {
      autoSiteAppliedRef.current = true;
      return;
    }
    if (loadingSites) return;
    const auto = sites.find((site) => site.is_primary && site.is_visit_address);
    if (auto) setSelectedSiteId(auto.id);
    autoSiteAppliedRef.current = true;
  }, [isEdit, scopingClientId, selectedClientId, selectedSiteId, loadingSites, sites]);

  function handleRelationsSave(patch: { clientId: string; siteId: string }) {
    setSelectedClientId(patch.clientId);
    setSelectedSiteId(patch.siteId);
    markDirty();
  }

  // ---- Reference data + cascading Type/Sub-type/Brand/Model -----------
  const [selectedTypeId, setSelectedTypeId] = useState(asset?.type_id ?? "");
  const [selectedSubtypeId, setSelectedSubtypeId] = useState(asset?.subtype_id ?? "");
  const [selectedBrandId, setSelectedBrandId] = useState(asset?.brand_item_id ?? "");
  const [selectedModelId, setSelectedModelId] = useState(asset?.model_id ?? "");

  const [name, setName] = useState(asset?.name ?? "");
  const [installedAt, setInstalledAt] = useState(asset?.installed_at ?? "");
  const [warrantyUntil, setWarrantyUntil] = useState(asset?.warranty_until ?? "");
  const warrantyTouchedRef = useRef(Boolean(asset?.warranty_until));

  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [lockedClientRecord, setLockedClientRecord] = useState<ClientRecord | null>(null);
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
      lockedClientId ? getClient(lockedClientId) : Promise.resolve(null),
      lockedClientId ? Promise.resolve(null) : listClients({ limit: 200 }),
      listReferenceItems("asset_type"),
      listReferenceItems("asset_status"),
      listReferenceItems("asset_subtype"),
      listReferenceItems("asset_brand"),
      listAssetModels(),
    ])
      .then(([lockedClientResult, clientsResult, typesResult, statusesResult, subtypesResult, brandsResult, modelsResult]) => {
        if (cancelled) return;
        setLockedClientRecord(lockedClientResult?.data?.client ?? null);
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
    // Runs once on mount only, same reasoning `asset-form-dialog.tsx`'s
    // identical effect documents — this screen mounts fresh per navigation
    // (a real route, not a reused Dialog instance), so there's no case where
    // `lockedClientId` changes under an already-mounted instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const defaultStatus = assetStatuses.find((item) => item.is_default);

  const resolvedClient = selectedClientId
    ? (clients.find((client) => client.id === selectedClientId) ??
        (lockedClientRecord?.id === selectedClientId ? lockedClientRecord : null))
    : null;
  const resolvedSite = sites.find((site) => site.id === selectedSiteId) ?? null;

  const brandOptions = useMemo(
    () => assetBrands.map((item) => ({ value: item.id, label: item.label })),
    [assetBrands],
  );

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

  const selectedModel = assetModels.find((model) => model.id === selectedModelId);
  const selectedType = assetTypes.find((item) => item.id === selectedTypeId);

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
    markDirty();
  }

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
    markDirty();
  }

  /** Fill-up (Type/Sub-type/Brand) ported as-is from `asset-form-dialog.tsx`.
   * Also proposes a warranty date — `installedAt + model.default_warranty_months`
   * — per the design handoff's documented "Model → Warranty" interaction,
   * genuinely new (not in the dialog this replaces): only fills a still-empty
   * or not-yet-manually-edited `warrantyUntil`, and only when an install date
   * is already known to compute from. */
  function handleModelChange(nextModelId: string) {
    setSelectedModelId(nextModelId);
    markDirty();
    if (!nextModelId) return;
    const model = assetModels.find((candidate) => candidate.id === nextModelId);
    if (!model) return;
    setSelectedTypeId(model.type_item_id);
    setSelectedBrandId(model.brand_item_id);
    setSelectedSubtypeId(model.subtype_item_id ?? "");

    if (!warrantyTouchedRef.current && installedAt) {
      const base = new Date(`${installedAt}T00:00:00`);
      if (!Number.isNaN(base.getTime())) {
        base.setMonth(base.getMonth() + model.default_warranty_months);
        setWarrantyUntil(base.toISOString().slice(0, 10));
      }
    }
  }

  const missingRequired: string[] = [];
  if (!selectedClientId) missingRequired.push("Client");
  if (!selectedSiteId) missingRequired.push("Site");
  if (!selectedTypeId) missingRequired.push("Type");

  const footerLabel =
    missingRequired.length > 0
      ? `Required: ${missingRequired.join(", ")}`
      : dirty
        ? "Unsaved changes"
        : mode === "edit"
          ? "All changes saved"
          : "Ready to create";

  const [deleting, setDeleting] = useState(false);

  const heroMeta: ReactNode[] = [];
  if (resolvedSite) {
    heroMeta.push(
      <>
        <MapPin /> {formatSiteAddressShort(resolvedSite) ?? "Unnamed site"}
      </>,
    );
  }
  if (installedAt) {
    heroMeta.push(
      <>
        <CalendarDays /> Installed {formatDate(installedAt, { month: "long" })}
      </>,
    );
  }

  const heroActions = (
    <>
      <Button type="button" variant="outline" onClick={() => router.push(cancelHref)}>
        Cancel
      </Button>
      {isEdit && canDelete && (
        <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
          Delete
        </Button>
      )}
      <SaveButton mode={mode} disabled={loadingOptions} />
    </>
  );

  return (
    <form action={formAction}>
      <RecordHeroBand
        noStats
        title={<h1 className="ui-record-hero-band-title">{name.trim() || "New asset"}</h1>}
        meta={[
          <span className="ui-record-hero-band-meta-badges" key="status-mode">
            {isEdit && asset ? (
              <Badge color={asset.asset_status?.color} variant="muted">
                {asset.asset_status?.label ?? "—"}
              </Badge>
            ) : null}
            <Badge variant={isEdit ? "muted" : "accent"}>{isEdit ? "Editing" : "Draft"}</Badge>
          </span>,
          ...heroMeta,
        ]}
        actions={heroActions}
      />

      <Stack gap="lg">
        {state.error && <Text tone="danger">{state.error}</Text>}

        {/* The only relation field actually SUBMITTED — `formDataToAssetInput`
            reads `siteId` straight off `FormData` (`asset-form-actions.ts`);
            Client is never sent at all, it's derived from the site's own
            `client_id` at the DB layer (see `asset-form-actions.ts`'s own doc
            comment). Client/Site are edited exclusively via
            `AssetRelationsDialog` below (no free `<select>` on the page per
            the design), so this hidden input is the only thing that actually
            wires `selectedSiteId` into the real form submission. */}
        <input type="hidden" name="siteId" value={selectedSiteId} />

        <FormGrid columns={2}>
          <RelationCard
            icon={Building2}
            label="Client"
            loading={loadingOptions && Boolean(selectedClientId) && !resolvedClient}
            title={resolvedClient?.name}
            emptyText="No client selected yet"
            onEdit={() => setRelationsOpen(true)}
          />
          <RelationCard
            icon={MapPin}
            label="Site"
            loading={loadingSites && Boolean(selectedSiteId) && !resolvedSite}
            title={resolvedSite ? (formatSiteAddressShort(resolvedSite) ?? "Unnamed site") : undefined}
            subtitle={resolvedSite?.is_primary ? "Primary" : undefined}
            emptyText="No site selected yet"
            onEdit={() => setRelationsOpen(true)}
          />
        </FormGrid>

        <DetailColumns
          left={
            <Stack gap="lg">
              <FormSection title="Equipment" icon={<Boxes />}>
                <FormGrid columns={2}>
                  <Stack gap="xs">
                    <Label htmlFor="asset-serial">Serial number</Label>
                    <Input
                      id="asset-serial"
                      name="serialNumber"
                      defaultValue={asset?.serial_number ?? ""}
                      maxLength={200}
                      onChange={markDirty}
                    />
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
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        markDirty();
                      }}
                      maxLength={200}
                      placeholder="Leave blank to auto-generate, e.g. AST-00042"
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
                      onChange={(event) => {
                        setSelectedSubtypeId(event.target.value);
                        markDirty();
                      }}
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

              <FormSection title="Status & warranty" icon={<ShieldCheck />}>
                <FormGrid columns={2}>
                  <Stack gap="xs">
                    <Label htmlFor="asset-status">Status</Label>
                    <Select
                      id="asset-status"
                      name="statusId"
                      defaultValue={asset?.status_id ?? ""}
                      disabled={loadingOptions}
                      onChange={markDirty}
                    >
                      <option value="">
                        {defaultStatus ? `Use default (${defaultStatus.label})` : "Use organization default"}
                      </option>
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
                      onChange={markDirty}
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
                    <Input
                      id="asset-installed"
                      name="installedAt"
                      type="date"
                      value={installedAt}
                      onChange={(event) => {
                        setInstalledAt(event.target.value);
                        markDirty();
                      }}
                    />
                    {state.fieldErrors?.installedAt?.map((message) => (
                      <Text key={message} tone="danger">
                        {message}
                      </Text>
                    ))}
                  </Stack>
                  <Stack gap="xs">
                    <Label htmlFor="asset-warranty">Warranty until</Label>
                    <Input
                      id="asset-warranty"
                      name="warrantyUntil"
                      type="date"
                      value={warrantyUntil}
                      onChange={(event) => {
                        warrantyTouchedRef.current = true;
                        setWarrantyUntil(event.target.value);
                        markDirty();
                      }}
                    />
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
                  <Textarea id="asset-notes" name="notes" defaultValue={asset?.notes ?? ""} rows={3} onChange={markDirty} />
                </Stack>
              </FormSection>
            </Stack>
          }
          right={
            <Stack gap="lg">
              <Card>
                <Stack gap="md">
                  <SectionHeader icon={ClipboardList} title="Summary" />
                  <KeyValueList
                    items={[
                      { label: "Asset ID", value: <Text>{name.trim() || "Auto-generated on save"}</Text> },
                      { label: "Type", value: <Text>{selectedType?.label ?? "—"}</Text> },
                      { label: "Model", value: <Text>{selectedModel?.name ?? "—"}</Text> },
                      {
                        label: "Warranty",
                        value: <Text>{warrantyUntil ? formatDate(warrantyUntil, { month: "long" }) : "—"}</Text>,
                      },
                    ]}
                  />
                </Stack>
              </Card>

              {isEdit &&
                asset &&
                linkedRecords &&
                (linkedRecords.canSeeWorkOrders ||
                  linkedRecords.canSeeContracts ||
                  linkedRecords.canSeeActivities ||
                  linkedRecords.canCreateActivity) && (
                <Card>
                  <Stack gap="md">
                    <SectionHeader
                      icon={FileText}
                      title="Linked records"
                      actions={
                        linkedRecords.canCreateActivity && (
                          <Link href={`/activities/new?assetId=${asset.id}`}>
                            <Button type="button" variant="primary" size="sm">
                              New activity
                            </Button>
                          </Link>
                        )
                      }
                    />
                    <KeyValueList
                      items={[
                        ...(linkedRecords.canSeeWorkOrders
                          ? [{ key: "work-orders", label: "Work orders", value: <Text>{linkedRecords.workOrderCount}</Text> }]
                          : []),
                        ...(linkedRecords.canSeeContracts
                          ? [{ key: "contracts", label: "Contracts", value: <Text>{linkedRecords.contractCount}</Text> }]
                          : []),
                        ...(linkedRecords.canSeeActivities
                          ? [{ key: "activities", label: "Activities", value: <Text>{linkedRecords.activityCount}</Text> }]
                          : []),
                      ]}
                    />
                  </Stack>
                </Card>
              )}

              {isEdit && asset && (
                <Card>
                  <Stack gap="md">
                    <SectionHeader icon={CalendarDays} title="Record" />
                    <KeyValueList
                      items={[
                        { key: "created", label: "Created", value: <Text>{formatDateTime(asset.created_at, { month: "long" })}</Text> },
                        {
                          key: "last-modified",
                          label: "Last modified",
                          value: <Text>{formatDateTime(asset.updated_at, { month: "long" })}</Text>,
                        },
                      ]}
                    />
                  </Stack>
                </Card>
              )}

              <Callout icon={CircleHelp}>
                Types, sub-types, brands, models and statuses are configured per organization —{" "}
                <Link href="/settings/reference-lists">manage them from Settings</Link>.
              </Callout>
            </Stack>
          }
        />
      </Stack>

      <FormSaveBar
        label={<Text tone={missingRequired.length > 0 ? "danger" : "muted"}>{footerLabel}</Text>}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => router.push(cancelHref)}>
              Cancel
            </Button>
            <SaveButton mode={mode} disabled={loadingOptions} />
          </>
        }
      />

      {relationsOpen && (
        <AssetRelationsDialog
          open
          onOpenChange={setRelationsOpen}
          clientId={selectedClientId}
          siteId={selectedSiteId}
          clients={clients}
          lockedClientId={lockedClientId}
          sites={sites}
          loadingSites={loadingSites}
          onClientChange={setScopingClientId}
          onSave={handleRelationsSave}
        />
      )}

      {isEdit && asset && deleting && (
        <DeleteAssetDialog asset={asset} open onOpenChange={setDeleting} redirectOnDelete />
      )}
    </form>
  );
}
