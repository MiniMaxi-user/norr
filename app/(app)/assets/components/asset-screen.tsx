"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumbs, Button, DetailColumns, Inline, Stack, Text, type BreadcrumbItem, type StatStripItem } from "@yourorg/ui";
import { createAsset, updateAsset, type AssetRecord } from "../actions";
import { getClient, listClients, type ClientRecord, type SiteRecord } from "@/app/(app)/clients/actions";
import { listReferenceItems, type ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { listAssetModels, type AssetModelRecord } from "@/lib/asset-models/actions";
import { formatDate, formatDateTime } from "@/lib/format/date";
import { usePageHeader } from "@/components/shell/page-header-context";
import { CreateActivityButton } from "@/app/(app)/activities/components/create-activity-button";
import { useClientScopedLists } from "@/app/(app)/work-orders/components/use-client-scoped-lists";
import { draftFromAsset, draftToInput, emptyDraft, type AssetDraft } from "./asset-draft";
import { AssetHero } from "./asset-hero";
import { AssetEquipmentSection } from "./asset-equipment-section";
import { AssetStatusWarrantySection } from "./asset-status-warranty-section";
import { AssetNotesSection } from "./asset-notes-section";
import { AssetRecentActivities, type RecentAssetActivityItem } from "./asset-recent-activities";
import { useAssetContracts } from "./use-asset-contracts";
import { DeleteAssetDialog } from "./delete-asset-dialog";

export interface AssetScreenProps {
  mode: "create" | "edit";
  /** Built by the server `page.tsx` and pushed into the Topbar via
   * `usePageHeader` — never rendered inline, same pattern
   * `WorkOrderScreen`/`client-detail.tsx` already use. */
  breadcrumbItems: BreadcrumbItem[];

  /** Required for `mode: "edit"`. */
  asset?: AssetRecord;
  client?: ClientRecord | null;
  site?: SiteRecord | null;
  /** Never render an edit affordance RLS would reject — a viewer with `read`/
   * `read_own` but no `update`/`update_own` gets a fully read-only render
   * (no pencils anywhere), same convention `RelationCard.onEdit`'s own doc
   * comment states. */
  readOnly?: boolean;
  lockedClientId?: string;
  initialSiteId?: string;
  cancelHref?: string;

  // ---- edit-mode-only ----
  canDelete?: boolean;
  canCreateActivityFromAsset?: boolean;
  /** Work order/contract/activity counts for the hero's "Work orders" KPI
   * tile — each already gated by its own module's feature flag + RBAC
   * server-side (`[id]/page.tsx`), 0 when not entitled/visible. */
  workOrderCount?: number;
  contractCount?: number;
  activityCount?: number;
  recentItems?: RecentAssetActivityItem[];
  /** The asset's own client's Activities tab — the closest honest
   * destination for "View all" (see `AssetRecentActivities`'s own doc
   * comment for why `/assets/[id]` itself can't be it). Omitted when there's
   * truly nowhere to send it. */
  viewAllHref?: string;
}

/**
 * The single shared screen behind `/assets/new` (`mode: "create"`),
 * `/assets/[id]` and `/assets/[id]/edit` (`mode: "edit"`, identical props —
 * NOT a distinct third mode; see both those routes' own `page.tsx`) — one
 * real screen, not three, mirroring `WorkOrderScreen`'s own "one screen, not
 * two" shape exactly (asset new/edit design handoff v3, superseding the
 * previous page-wide-`<form>` pass).
 *
 * Owns one flat `AssetDraft` (`./asset-draft.ts`) as the source of truth for
 * every editable field; every section reads from it and writes back through
 * `commitPatch` below — in `mode: "edit"` that's an immediate `updateAsset`
 * call (small, section-scoped, saved the instant that section's own Save is
 * clicked — no page-wide Save/Cancel), in `mode: "create"` it's a local-only
 * merge until the hero's own "Save asset" action fires `createAsset` with the
 * whole accumulated draft and navigates to the new record.
 *
 * *** The hero's "Edit header" pencil *** (next to the status/type badges)
 * does not open a third editing surface — Status lives in the Status &
 * warranty section, Type/Sub-type live in Equipment, so a dedicated header
 * popup would just duplicate fields already editable elsewhere. It simply
 * opens BOTH of those sections into their inline-edit state at once (a
 * "jump to edit everything in the header" shortcut) via `equipmentEditing`/
 * `statusEditing` below, owned here (not by either section, and not by
 * `AssetHero`) since the pencil needs to set both simultaneously.
 *
 * In `mode: "create"`, `equipmentEditing`/`statusEditing` start (and stay)
 * `true` — both sections' own components refuse to close themselves in
 * create mode (nothing exists yet for their read view to source from), same
 * "sections just accumulate into local draft state" pattern `WorkOrderScreen`
 * already establishes for its own create-mode sections.
 */
export function AssetScreen({
  mode,
  breadcrumbItems,
  asset,
  client = null,
  site = null,
  readOnly,
  lockedClientId,
  initialSiteId,
  cancelHref,
  canDelete,
  canCreateActivityFromAsset,
  workOrderCount = 0,
  contractCount = 0,
  activityCount = 0,
  recentItems = [],
  viewAllHref,
}: AssetScreenProps) {
  const router = useRouter();

  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  const [draft, setDraft] = useState<AssetDraft>(() =>
    asset ? draftFromAsset(asset) : emptyDraft({ lockedClientId, initialSiteId }),
  );

  // The client currently being PREVIEWED for the relation cards + the
  // relations popup's own site picker — kept separate from `draft.clientId`
  // so opening the popup and trying a different client updates both live,
  // without touching the actually-saved value until Save is clicked. Same
  // "committed vs. scoping" split `WorkOrderScreen`'s `scopingClientId` uses.
  const [scopingClientId, setScopingClientId] = useState(draft.clientId);
  useEffect(() => {
    setScopingClientId(draft.clientId);
  }, [draft.clientId]);
  const clientScoped = useClientScopedLists(scopingClientId, !readOnly);

  // The asset's own linked contracts (`contract_assets`) — needed for the
  // Contract relation card's display even for a `readOnly` viewer (unlike
  // Model/Equipment, there is no resolved embed on `AssetRecord` itself for
  // this many-to-many; see `use-asset-contracts.ts`'s own doc comment).
  const assetContracts = useAssetContracts(asset?.id, mode === "edit");

  // ---- Reference data (Type/Sub-type/Brand/Model/Status + Clients) -------
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [lockedClientRecord, setLockedClientRecord] = useState<ClientRecord | null>(null);
  const [assetTypes, setAssetTypes] = useState<ReferenceListItemRecord[]>([]);
  const [assetStatuses, setAssetStatuses] = useState<ReferenceListItemRecord[]>([]);
  const [assetSubtypes, setAssetSubtypes] = useState<ReferenceListItemRecord[]>([]);
  const [assetBrands, setAssetBrands] = useState<ReferenceListItemRecord[]>([]);
  const [assetModels, setAssetModels] = useState<AssetModelRecord[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(!readOnly);

  useEffect(() => {
    // A `readOnly` viewer never sees a single edit affordance, so none of
    // these lists can ever render anything — same "don't fetch what can't
    // render" convention `use-client-scoped-lists.ts`'s own `enabled` flag
    // documents.
    if (readOnly) return;
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
    // Runs once on mount only — this screen mounts fresh per navigation (a
    // real route, not a reused Dialog instance), same reasoning
    // `asset-form-screen.tsx`'s identical effect documented for itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolvedClients = lockedClientId
    ? lockedClientRecord
      ? [lockedClientRecord]
      : client
        ? [client]
        : []
    : clients;

  // ---- Section edit-open state (see this component's own doc comment) ---
  const [equipmentEditing, setEquipmentEditing] = useState(mode === "create");
  const [statusEditing, setStatusEditing] = useState(mode === "create");
  const [notesEditing, setNotesEditing] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  /** Every section's own "Save" ultimately calls this. `mode: "edit"`
   * persists immediately (`updateAsset`) and refreshes the server-rendered
   * data (`router.refresh()`); `mode: "create"` only ever merges into local
   * draft state — see this component's own module doc comment. */
  async function commitPatch(patch: Partial<AssetDraft>): Promise<{ ok: boolean; error?: string }> {
    if (mode === "edit" && asset) {
      const result = await updateAsset(asset.id, draftToInput(patch));
      if (!result.data) return { ok: false, error: result.error };
      setDraft((prev) => ({ ...prev, ...patch }));
      router.refresh();
      return { ok: true };
    }
    setDraft((prev) => ({ ...prev, ...patch }));
    return { ok: true };
  }

  async function handleCreate() {
    if (!draft.siteId) {
      setCreateError("Select a client and site.");
      return;
    }
    if (!draft.typeId) {
      setCreateError("Select a type.");
      return;
    }
    setCreateError(null);
    setCreating(true);
    const result = await createAsset(draftToInput(draft));
    setCreating(false);
    if (!result.data) {
      setCreateError(result.error ?? "Could not create this asset.");
      return;
    }
    router.push(`/assets/${result.data.asset.id}`);
  }

  function handleContractsChange() {
    assetContracts.refresh();
    router.refresh();
  }

  const stats: StatStripItem[] = useMemo(() => {
    const resolvedModel =
      assetModels.find((candidate) => candidate.id === draft.modelId) ??
      (draft.modelId && asset?.model_id === draft.modelId ? asset.asset_model : null);
    const resolvedBrandLabel =
      assetBrands.find((candidate) => candidate.id === draft.brandItemId)?.label ??
      (draft.brandItemId && asset?.brand_item_id === draft.brandItemId ? asset?.asset_brand?.label : undefined) ??
      undefined;

    const warrantyStart = draft.installedAt ? new Date(`${draft.installedAt}T00:00:00`).getTime() : NaN;
    const warrantyEnd = draft.warrantyUntil ? new Date(`${draft.warrantyUntil}T00:00:00`).getTime() : NaN;
    const warrantyProgress =
      mode === "edit" && !Number.isNaN(warrantyStart) && !Number.isNaN(warrantyEnd) && warrantyEnd > warrantyStart
        ? Math.min(100, Math.max(0, ((warrantyEnd - Date.now()) / (warrantyEnd - warrantyStart)) * 100))
        : undefined;

    return [
      {
        label: "Model",
        value: mode === "create" ? "—" : (resolvedModel?.name ?? "—"),
        hint: mode === "create" ? "Save the asset first" : resolvedBrandLabel,
      },
      {
        label: "Serial",
        value: mode === "create" ? "—" : draft.serialNumber || "—",
        hint: mode === "create" ? undefined : draft.externalReference || undefined,
      },
      {
        label: "Warranty",
        value: mode === "create" ? "—" : draft.warrantyUntil ? formatDate(draft.warrantyUntil, { month: "long" }) : "—",
        progress: warrantyProgress,
      },
      {
        label: "Work orders",
        value: mode === "create" ? "—" : String(workOrderCount),
        hint:
          mode === "create"
            ? "Save the asset first"
            : `${contractCount} ${contractCount === 1 ? "contract" : "contracts"} · ${activityCount} ${activityCount === 1 ? "activity" : "activities"}`,
      },
    ];
  }, [assetModels, assetBrands, draft, asset, mode, workOrderCount, contractCount, activityCount]);

  const heroActions =
    mode === "edit" && asset ? (
      <>
        {canCreateActivityFromAsset && <CreateActivityButton assetId={asset.id} label="New activity" />}
        {canDelete && (
          <Button type="button" variant="danger" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        )}
      </>
    ) : (
      <>
        <Button type="button" variant="outline" onClick={() => router.push(cancelHref ?? "/assets")} disabled={creating}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleCreate} disabled={creating}>
          {creating ? "Saving…" : "Save asset"}
        </Button>
      </>
    );

  return (
    <Stack gap="lg">
      {createError && <Text tone="danger">{createError}</Text>}

      <AssetHero
        mode={mode}
        draft={draft}
        asset={asset}
        client={client}
        site={site}
        clients={resolvedClients}
        lockedClientId={lockedClientId}
        clientScoped={clientScoped}
        assetTypes={assetTypes}
        assetStatuses={assetStatuses}
        assetModels={assetModels}
        assetBrands={assetBrands}
        assetContracts={assetContracts}
        readOnly={readOnly}
        stats={stats}
        actions={heroActions}
        onClientChange={setScopingClientId}
        onRelationsSave={commitPatch}
        onModelSave={commitPatch}
        onContractsChange={handleContractsChange}
        onEditHeader={
          readOnly
            ? undefined
            : () => {
                setEquipmentEditing(true);
                setStatusEditing(true);
              }
        }
      />

      <DetailColumns
        left={
          <Stack gap="lg">
            <AssetEquipmentSection
              mode={mode}
              draft={draft}
              asset={asset}
              assetTypes={assetTypes}
              assetSubtypes={assetSubtypes}
              editing={equipmentEditing}
              onEditToggle={setEquipmentEditing}
              readOnly={readOnly}
              loadingOptions={loadingOptions}
              onSave={commitPatch}
            />
            <AssetStatusWarrantySection
              mode={mode}
              draft={draft}
              asset={asset}
              assetStatuses={assetStatuses}
              editing={statusEditing}
              onEditToggle={setStatusEditing}
              readOnly={readOnly}
              loadingOptions={loadingOptions}
              onSave={commitPatch}
            />
          </Stack>
        }
        right={
          <Stack gap="lg">
            <AssetNotesSection
              draft={draft}
              editing={notesEditing}
              onEditToggle={setNotesEditing}
              readOnly={readOnly}
              onSave={commitPatch}
            />
            <AssetRecentActivities items={recentItems} viewAllHref={viewAllHref} />
            {mode === "edit" && asset && (
              <Inline justify="between" gap="sm">
                <Text tone="muted">Created {formatDateTime(asset.created_at, { month: "long" })}</Text>
                <Text tone="muted">Last modified {formatDateTime(asset.updated_at, { month: "long" })}</Text>
              </Inline>
            )}
          </Stack>
        }
      />

      {mode === "edit" && asset && deleting && (
        <DeleteAssetDialog asset={asset} open onOpenChange={setDeleting} redirectOnDelete />
      )}
    </Stack>
  );
}
