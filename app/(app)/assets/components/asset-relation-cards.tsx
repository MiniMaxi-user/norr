"use client";

import Link from "next/link";
import { FormGrid, RelationCard } from "@yourorg/ui";
import { Boxes, Building2, FileText, MapPin } from "@yourorg/ui/icons";
import type { AssetRecord } from "../actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { AssetModelRecord } from "@/lib/asset-models/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { formatDate } from "@/lib/format/date";
import type { AssetDraft } from "./asset-draft";

export interface AssetRelationCardsProps {
  mode: "create" | "edit";
  draft: AssetDraft;
  /** Resolved fallback records for the asset's CURRENTLY SAVED client/site
   * (edit mode only — `getClient`, fetched once server-side by `[id]/page.tsx`),
   * used until `clientScoped`'s own client-side fetch resolves a possibly-
   * just-picked different one. `null` in create mode. */
  client: ClientRecord | null;
  site: SiteRecord | null;
  /** The full, already-saved record (edit mode only) — its resolved
   * `asset_type`/`asset_model`/`asset_brand` embeds back the Model card's
   * display whenever the client-fetched reference lists below haven't (yet)
   * resolved a different, just-picked value (create mode, or the instant
   * before `router.refresh()` lands post-save). */
  asset?: AssetRecord;
  /** Fallback source for the Client card once a different client has been
   * previewed via the relations popup than `client` (the fixed server prop)
   * resolves — `mode: "create"` never `router.refresh()`es, so without this
   * the card would show "Loading…" forever, same reasoning
   * `WorkOrderRelationCards`'s identical `clients` fallback documents. */
  clients: ClientRecord[];
  clientScoped: { sites: SiteRecord[]; loadingSites: boolean };
  assetTypes: ReferenceListItemRecord[];
  assetModels: AssetModelRecord[];
  assetBrands: ReferenceListItemRecord[];
  assetContracts: { contracts: ContractRecord[]; loading: boolean };
  readOnly?: boolean;
  onEditClientSite?: () => void;
  onEditModel?: () => void;
  onEditContract?: () => void;
}

/**
 * The Client / Site / Model / Contract relation cards row (asset new/edit
 * design handoff v3) — four across, each with its own small Edit button.
 * Client and Site share one popup (`AssetRelationsDialog`, a real Client ->
 * Site cascade); Model and Contract each get their own dedicated popup
 * (`AssetModelDialog`/`AssetContractsDialog`) since neither is part of that
 * cascade — see this module's own callers for why.
 */
export function AssetRelationCards({
  mode,
  draft,
  client,
  site,
  asset,
  clients,
  clientScoped,
  assetTypes,
  assetModels,
  assetBrands,
  assetContracts,
  readOnly,
  onEditClientSite,
  onEditModel,
  onEditContract,
}: AssetRelationCardsProps) {
  const resolvedClient = draft.clientId
    ? (client?.id === draft.clientId ? client : (clients.find((candidate) => candidate.id === draft.clientId) ?? null))
    : null;
  const resolvedSite =
    clientScoped.sites.find((candidate) => candidate.id === draft.siteId) ??
    (draft.siteId && site?.id === draft.siteId ? site : null);

  const clientFacts = [resolvedClient?.kvk_number ? `KvK ${resolvedClient.kvk_number}` : null, resolvedClient?.vat_number]
    .filter(Boolean)
    .join(" · ");

  // Model/Brand/Type resolve from the client-fetched reference lists first
  // (immediate feedback the instant a popup's Save merges into the local
  // draft) and fall back to the already-saved record's own resolved embeds
  // otherwise — same "fetched list first, server prop as fallback" order
  // `resolvedClient` above uses.
  const resolvedModel =
    assetModels.find((candidate) => candidate.id === draft.modelId) ??
    (draft.modelId && asset?.model_id === draft.modelId ? asset.asset_model : null);
  const resolvedBrandLabel =
    assetBrands.find((candidate) => candidate.id === draft.brandItemId)?.label ??
    (draft.brandItemId && asset?.brand_item_id === draft.brandItemId ? asset?.asset_brand?.label : undefined) ??
    null;
  const resolvedTypeLabel =
    assetTypes.find((candidate) => candidate.id === draft.typeId)?.label ?? asset?.asset_type?.label ?? null;
  const resolvedSubtypeLabel = asset?.subtype_id === draft.subtypeId ? asset?.asset_subtype?.label ?? null : null;

  const modelTitle = [resolvedBrandLabel, resolvedModel?.name].filter(Boolean).join(" ");
  const modelSubtitleParts = [resolvedTypeLabel, resolvedSubtypeLabel].filter(Boolean).join(" / ");
  const modelSubtitle = [
    modelSubtitleParts || null,
    resolvedModel ? `warranty ${resolvedModel.default_warranty_months} mo` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const [firstContract, ...restContracts] = assetContracts.contracts;
  const contractFacts = firstContract
    ? [firstContract.contract_type?.label, `from ${formatDate(firstContract.start_date)}`].filter(Boolean).join(" · ")
    : "";
  const contractSubtitle = restContracts.length > 0 ? `${contractFacts} · +${restContracts.length} more` : contractFacts;

  return (
    <FormGrid columns={4}>
      <RelationCard
        icon={Building2}
        label="Client"
        loading={false}
        title={resolvedClient ? <Link href={`/clients/${resolvedClient.id}`}>{resolvedClient.name}</Link> : undefined}
        subtitle={clientFacts || undefined}
        emptyText="No client selected yet"
        onEdit={readOnly ? undefined : onEditClientSite}
      />
      <RelationCard
        icon={MapPin}
        label="Site"
        loading={clientScoped.loadingSites && Boolean(draft.siteId) && !resolvedSite}
        title={resolvedSite ? (formatSiteAddressShort(resolvedSite) ?? "Unnamed site") : undefined}
        subtitle={resolvedSite?.is_primary ? "Primary" : undefined}
        emptyText="No site selected yet"
        onEdit={readOnly ? undefined : onEditClientSite}
      />
      <RelationCard
        icon={Boxes}
        label="Model"
        loading={false}
        title={modelTitle || undefined}
        subtitle={modelSubtitle || undefined}
        emptyText="No model set"
        onEdit={readOnly ? undefined : onEditModel}
      />
      <RelationCard
        icon={FileText}
        label="Contract"
        loading={mode === "edit" && assetContracts.loading}
        title={firstContract ? <Link href={`/contracts/${firstContract.id}`}>{firstContract.name}</Link> : undefined}
        subtitle={contractSubtitle || undefined}
        emptyText={mode === "create" ? "Save the asset first" : "No contract"}
        onEdit={readOnly || mode === "create" ? undefined : onEditContract}
      />
    </FormGrid>
  );
}
