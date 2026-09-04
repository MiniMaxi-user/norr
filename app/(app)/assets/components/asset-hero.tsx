"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Badge, IconButton, RecordHeroBand, StatStrip, type StatStripItem } from "@yourorg/ui";
import { CalendarDays, MapPin, Pencil } from "@yourorg/ui/icons";
import type { AssetRecord } from "../actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { AssetModelRecord } from "@/lib/asset-models/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { formatDate } from "@/lib/format/date";
import type { AssetDraft } from "./asset-draft";
import { AssetRelationCards } from "./asset-relation-cards";
import { AssetRelationsDialog } from "./asset-relations-dialog";
import { AssetModelDialog } from "./asset-model-dialog";
import { AssetContractsDialog } from "./asset-contracts-dialog";

export interface AssetHeroProps {
  mode: "create" | "edit";
  draft: AssetDraft;
  asset?: AssetRecord;
  client: ClientRecord | null;
  site: SiteRecord | null;
  clients: ClientRecord[];
  /** Pre-scopes to a single client and hides the picker in the Client/Site
   * popup — the Clients detail page's Assets tab, or `?clientId=...` on
   * `/assets/new`. */
  lockedClientId?: string;
  clientScoped: { sites: SiteRecord[]; loadingSites: boolean; contracts: ContractRecord[] };
  assetTypes: ReferenceListItemRecord[];
  assetStatuses: ReferenceListItemRecord[];
  assetModels: AssetModelRecord[];
  assetBrands: ReferenceListItemRecord[];
  assetContracts: { contracts: ContractRecord[]; loading: boolean };
  readOnly?: boolean;
  /** The Model/Serial/Warranty/Work orders KPI tiles — computed by
   * `AssetScreen` from data it already fetched/holds, same split
   * `WorkOrderHero`'s own `stats` prop documents for itself. */
  stats: StatStripItem[];
  /** New activity/Delete in edit mode, or a Cancel/Save asset pair in create
   * mode — owned by `AssetScreen`, just slotted in here. */
  actions?: ReactNode;
  onClientChange: (clientId: string) => void;
  onRelationsSave: (patch: Pick<AssetDraft, "clientId" | "siteId">) => Promise<{ ok: boolean; error?: string }>;
  onModelSave: (
    patch: Partial<Pick<AssetDraft, "modelId" | "brandItemId" | "typeId" | "subtypeId" | "warrantyUntil">>,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Re-fetches the asset's linked contracts + refreshes the page — see
   * `use-asset-contracts.ts`'s own doc comment. */
  onContractsChange: () => void;
  /** Opens BOTH the Equipment and Status & warranty sections into their
   * inline-edit state at once — see `asset-screen.tsx`'s own module doc
   * comment for why this pencil doesn't get a third editing surface of its
   * own. Omitted (along with the pencil itself) for a `readOnly` viewer. */
  onEditHeader?: () => void;
}

/**
 * The full-bleed dark hero band + the Client/Site/Model/Contract relation
 * cards, at the top of the unified Asset screen (asset new/edit design
 * handoff v3) — mirrors `work-order-hero.tsx` exactly: `RecordHeroBand`
 * (title/badges/meta/actions/stats) as a full-bleed sibling BEFORE any
 * `Card`, `AssetRelationCards` rendered directly on the page's own
 * background below it (each card is already its own bordered `Card`), and
 * this component owning the small popups behind the relation cards' own Edit
 * buttons.
 *
 * Unlike `WorkOrderHero`, the title here is a plain `<h1>` even in create
 * mode (the mock's hero title is read-only — an asset's own name/id lives in
 * the Equipment section instead, not editable inline in the band the way a
 * work order's title is).
 */
export function AssetHero({
  mode,
  draft,
  asset,
  client,
  site,
  clients,
  lockedClientId,
  clientScoped,
  assetTypes,
  assetStatuses,
  assetModels,
  assetBrands,
  assetContracts,
  readOnly,
  stats,
  actions,
  onClientChange,
  onRelationsSave,
  onModelSave,
  onContractsChange,
  onEditHeader,
}: AssetHeroProps) {
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [contractsOpen, setContractsOpen] = useState(false);

  const resolvedSite =
    clientScoped.sites.find((candidate) => candidate.id === draft.siteId) ??
    (draft.siteId && site?.id === draft.siteId ? site : null);

  const resolvedStatus =
    assetStatuses.find((candidate) => candidate.id === draft.statusId) ??
    (mode === "edit" && asset?.status_id === draft.statusId ? asset?.asset_status : undefined);
  const resolvedType = assetTypes.find((candidate) => candidate.id === draft.typeId);
  const typeSubtypeLabel = [resolvedType?.label ?? asset?.asset_type?.label, asset?.asset_subtype?.label]
    .filter(Boolean)
    .join(" / ");

  const meta: ReactNode[] = [];
  if (resolvedSite) {
    meta.push(
      <>
        <MapPin /> {formatSiteAddressShort(resolvedSite) ?? "Unnamed site"}
      </>,
    );
  }
  if (draft.installedAt) {
    meta.push(
      <>
        <CalendarDays /> Installed {formatDate(draft.installedAt, { month: "long" })}
      </>,
    );
  }

  return (
    <>
      <RecordHeroBand
        title={<h1 className="ui-record-hero-band-title">{mode === "create" ? "New asset" : (asset?.name ?? "—")}</h1>}
        meta={[
          <span className="ui-record-hero-band-meta-badges" key="status-type">
            {mode === "edit" ? (
              <Badge color={resolvedStatus?.color} variant="muted">
                {resolvedStatus?.label ?? "—"}
              </Badge>
            ) : (
              <Badge variant="accent">New</Badge>
            )}
            {typeSubtypeLabel && <Badge variant="muted">{typeSubtypeLabel}</Badge>}
            {!readOnly && onEditHeader && (
              <IconButton variant="ghost" aria-label="Edit header" onClick={onEditHeader}>
                <Pencil />
              </IconButton>
            )}
          </span>,
          ...meta,
        ]}
        actions={actions}
        stats={<StatStrip items={stats} />}
      />

      <AssetRelationCards
        mode={mode}
        draft={draft}
        client={client}
        site={site}
        asset={asset}
        clients={clients}
        clientScoped={clientScoped}
        assetTypes={assetTypes}
        assetModels={assetModels}
        assetBrands={assetBrands}
        assetContracts={assetContracts}
        readOnly={readOnly}
        onEditClientSite={() => setRelationsOpen(true)}
        onEditModel={() => setModelOpen(true)}
        onEditContract={() => setContractsOpen(true)}
      />

      {relationsOpen && (
        <AssetRelationsDialog
          open
          onOpenChange={setRelationsOpen}
          draft={draft}
          clients={clients}
          lockedClientId={lockedClientId}
          clientScoped={clientScoped}
          onClientChange={onClientChange}
          onSave={onRelationsSave}
        />
      )}

      {modelOpen && (
        <AssetModelDialog
          open
          onOpenChange={setModelOpen}
          draft={draft}
          assetModels={assetModels}
          assetBrands={assetBrands}
          onSave={onModelSave}
        />
      )}

      {contractsOpen && asset && (
        <AssetContractsDialog
          open
          onOpenChange={setContractsOpen}
          assetId={asset.id}
          contracts={assetContracts.contracts}
          loading={assetContracts.loading}
          clientContracts={clientScoped.contracts}
          onChange={onContractsChange}
        />
      )}
    </>
  );
}
