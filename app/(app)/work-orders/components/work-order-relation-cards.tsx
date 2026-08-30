"use client";

import Link from "next/link";
import { FormGrid, RelationCard } from "@yourorg/ui";
import { Boxes, Building2, FileText, MapPin } from "@yourorg/ui/icons";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import { formatSiteAddress } from "@/app/(app)/clients/format-site-address";
import { formatCurrency } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/date";
import type { WorkOrderDraft } from "./work-order-draft";

export interface WorkOrderRelationCardsProps {
  draft: WorkOrderDraft;
  /** Resolved fallback records for the work order's CURRENTLY SAVED
   * client/site/asset/contract (edit mode only — `getClient`/`getAsset`/
   * `getContract`, fetched once server-side by `[id]/page.tsx`), used until
   * `clientScoped`'s own fetched lists resolve a possibly-just-picked
   * different one. `null` in create mode (nothing saved yet). */
  client: ClientRecord | null;
  site: SiteRecord | null;
  asset: AssetRecord | null;
  contract: ContractRecord | null;
  clientScoped: {
    sites: SiteRecord[];
    assets: AssetRecord[];
    contracts: ContractRecord[];
    loadingSites: boolean;
    loadingAssets: boolean;
    loadingContracts: boolean;
  };
  readOnly?: boolean;
  onEdit?: () => void;
}

/**
 * The Client/Site/Asset/Contract relation cards row (issue #102) — four
 * across, each showing the linked record's name + a couple of key facts and
 * (when editable) a small Edit button. All four Edit buttons open the SAME
 * `WorkOrderRelationsDialog`: Site/Asset/Contract are all scoped by Client
 * (the exact cascade `WorkOrderRelationsDialog` reuses from the pre-redesign
 * form), so editing any one of them in isolation would mean re-deriving that
 * same cascade four separate times for no real benefit — a deliberate,
 * documented deviation from the mockup implying four independent popups.
 */
export function WorkOrderRelationCards({
  draft,
  client,
  site,
  asset,
  contract,
  clientScoped,
  readOnly,
  onEdit,
}: WorkOrderRelationCardsProps) {
  const resolvedClient = draft.clientId ? (client?.id === draft.clientId ? client : null) : null;
  const resolvedSite =
    clientScoped.sites.find((candidate) => candidate.id === draft.siteId) ??
    (draft.siteId && site?.id === draft.siteId ? site : null);
  const resolvedAsset =
    clientScoped.assets.find((candidate) => candidate.id === draft.assetId) ??
    (draft.assetId && asset?.id === draft.assetId ? asset : null);
  const resolvedContract =
    clientScoped.contracts.find((candidate) => candidate.id === draft.contractId) ??
    (draft.contractId && contract?.id === draft.contractId ? contract : null);

  const clientFacts = [resolvedClient?.kvk_number ? `KvK ${resolvedClient.kvk_number}` : null, resolvedClient?.vat_number]
    .filter(Boolean)
    .join(" · ");

  const assetFacts = resolvedAsset
    ? [resolvedAsset.asset_type?.label, resolvedAsset.serial_number].filter(Boolean).join(" · ")
    : "";

  const contractFacts = resolvedContract
    ? [resolvedContract.contract_type?.label, formatCurrency(resolvedContract.value)].filter(Boolean).join(" · ")
    : "";

  return (
    <FormGrid columns={4}>
      <RelationCard
        icon={Building2}
        label="Client"
        loading={Boolean(draft.clientId) && !resolvedClient && !client}
        title={resolvedClient ? <Link href={`/clients/${resolvedClient.id}`}>{resolvedClient.name}</Link> : undefined}
        subtitle={clientFacts || undefined}
        emptyText="No client selected yet"
        onEdit={readOnly ? undefined : onEdit}
      />
      <RelationCard
        icon={MapPin}
        label="Site"
        loading={clientScoped.loadingSites && Boolean(draft.siteId) && !resolvedSite}
        title={resolvedSite ? formatSiteAddress(resolvedSite) ?? "Unnamed site" : undefined}
        subtitle={resolvedSite?.is_primary ? "Primary" : undefined}
        emptyText="No specific site"
        onEdit={readOnly ? undefined : onEdit}
      />
      <RelationCard
        icon={Boxes}
        label="Asset"
        loading={clientScoped.loadingAssets && Boolean(draft.assetId) && !resolvedAsset}
        title={resolvedAsset ? <Link href={`/assets/${resolvedAsset.id}`}>{resolvedAsset.name}</Link> : undefined}
        subtitle={assetFacts || undefined}
        emptyText="No specific asset"
        onEdit={readOnly ? undefined : onEdit}
      />
      <RelationCard
        icon={FileText}
        label="Contract"
        loading={clientScoped.loadingContracts && Boolean(draft.contractId) && !resolvedContract}
        title={
          resolvedContract ? <Link href={`/contracts/${resolvedContract.id}`}>{resolvedContract.name}</Link> : undefined
        }
        subtitle={
          contractFacts
            ? `${contractFacts}${resolvedContract?.start_date ? ` · from ${formatDate(resolvedContract.start_date)}` : ""}`
            : undefined
        }
        emptyText="No contract"
        onEdit={readOnly ? undefined : onEdit}
      />
    </FormGrid>
  );
}
