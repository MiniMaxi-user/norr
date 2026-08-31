"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { FormGrid, RelationCard, Stack, Text } from "@yourorg/ui";
import { Boxes, Building2, FileText, MapPin } from "@yourorg/ui/icons";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import { formatSiteAddress } from "@/app/(app)/clients/format-site-address";
import { formatCurrency } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/date";
import type { WorkOrderDraft } from "./work-order-draft";

/** One "Label value" line inside a `RelationCard`'s hover-expanded detail —
 * shared by all four cards below so the expanded panels read consistently. */
function ExpandRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="ui-relation-card-expand-row">
      <Text tone="muted">{label}</Text>
      <Text>{value}</Text>
    </div>
  );
}

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
  /** Fallback source for resolving the Client card's display name once a
   * DIFFERENT client has been picked via the relations popup than the one
   * `client` (the server-fetched prop, fixed at initial render) resolves —
   * `mode: "create"` has no `router.refresh()` to re-fetch `client` after a
   * local-only draft merge (see `WorkOrderScreen.commitPatch`), so without
   * this the card would show "Loading…" forever. Same `clients.find(...) ??
   * client` fallback the pre-redesign `work-order-fields.tsx` used. */
  clients: ClientRecord[];
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
  clients,
  clientScoped,
  readOnly,
  onEdit,
}: WorkOrderRelationCardsProps) {
  const resolvedClient = draft.clientId
    ? (client?.id === draft.clientId ? client : (clients.find((candidate) => candidate.id === draft.clientId) ?? null))
    : null;
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

  // Issue #106 — the Site relation card has no detail page of its own (sites
  // are a dialog-editable sub-panel of a Client, see `sites-panel.tsx`), so
  // its "detail page" is the Client's own Sites tab — same deep-link-to-a-
  // filtered/tabbed-parent-view pattern `WorkOrderAssignmentSection`'s "From
  // activity" row already uses for Activities' own missing detail route.
  const siteClientId = resolvedClient?.id ?? draft.clientId;

  // Issue #106 — per-card hover-expand detail, built ONLY from fields already
  // fetched for this page (`resolvedClient`/`resolvedSite`/`resolvedAsset`/
  // `resolvedContract` above) — no new queries. A client's own email/phone
  // were dropped from `ClientRecord` entirely (issue #43: email now only
  // lives on `Contact` rows; phone moved to `sites`), so the Client panel
  // below surfaces the business identifiers that DO still live on the record
  // (KvK/VAT/IBAN) plus its notes, rather than fields that don't exist here.
  const clientExpanded = resolvedClient ? (
    <Stack gap="xs">
      <ExpandRow label="KvK" value={resolvedClient.kvk_number || "—"} />
      <ExpandRow label="VAT" value={resolvedClient.vat_number || "—"} />
      <ExpandRow label="IBAN" value={resolvedClient.iban || "—"} />
      {resolvedClient.notes && <ExpandRow label="Notes" value={resolvedClient.notes} />}
    </Stack>
  ) : undefined;

  const siteExpanded = resolvedSite ? (
    <Stack gap="xs">
      <ExpandRow label="Address" value={formatSiteAddress(resolvedSite) ?? "Unnamed site"} />
      <ExpandRow label="Phone" value={resolvedSite.phone || "—"} />
      <ExpandRow
        label="Used for"
        value={
          [
            resolvedSite.is_visit_address && "Visit",
            resolvedSite.is_invoice_address && "Invoice",
            resolvedSite.is_delivery_address && "Delivery",
          ]
            .filter(Boolean)
            .join(", ") || "—"
        }
      />
    </Stack>
  ) : undefined;

  const assetExpanded = resolvedAsset ? (
    <Stack gap="xs">
      <ExpandRow label="Serial number" value={resolvedAsset.serial_number || "—"} />
      <ExpandRow label="Type" value={resolvedAsset.asset_type?.label || "—"} />
      <ExpandRow label="Sub-type" value={resolvedAsset.asset_subtype?.label || "—"} />
      <ExpandRow label="Status" value={resolvedAsset.asset_status?.label || "—"} />
    </Stack>
  ) : undefined;

  const contractExpanded = resolvedContract ? (
    <Stack gap="xs">
      <ExpandRow label="Type" value={resolvedContract.contract_type?.label || "—"} />
      <ExpandRow label="Start date" value={formatDate(resolvedContract.start_date)} />
      <ExpandRow label="End date" value={formatDate(resolvedContract.end_date)} />
      <ExpandRow label="Value" value={resolvedContract.value != null ? formatCurrency(resolvedContract.value) : "—"} />
    </Stack>
  ) : undefined;

  return (
    <FormGrid columns={4}>
      <RelationCard
        icon={Building2}
        label="Client"
        // No async loading state of its own (unlike Site/Asset/Contract,
        // which depend on `clientScoped`'s client-side fetch) — `client` and
        // `clients` are both already-resolved server props/synchronous
        // lookups, so a `draft.clientId` with no match is genuinely
        // "not found", never "still loading".
        loading={false}
        title={resolvedClient ? <Link href={`/clients/${resolvedClient.id}`}>{resolvedClient.name}</Link> : undefined}
        subtitle={clientFacts || undefined}
        emptyText="No client selected yet"
        onEdit={readOnly ? undefined : onEdit}
        expandedContent={clientExpanded}
      />
      <RelationCard
        icon={MapPin}
        label="Site"
        loading={clientScoped.loadingSites && Boolean(draft.siteId) && !resolvedSite}
        title={
          resolvedSite ? (
            siteClientId ? (
              <Link href={`/clients/${siteClientId}?tab=sites`}>{formatSiteAddress(resolvedSite) ?? "Unnamed site"}</Link>
            ) : (
              (formatSiteAddress(resolvedSite) ?? "Unnamed site")
            )
          ) : undefined
        }
        subtitle={resolvedSite?.is_primary ? "Primary" : undefined}
        emptyText="No specific site"
        onEdit={readOnly ? undefined : onEdit}
        expandedContent={siteExpanded}
      />
      <RelationCard
        icon={Boxes}
        label="Asset"
        loading={clientScoped.loadingAssets && Boolean(draft.assetId) && !resolvedAsset}
        title={resolvedAsset ? <Link href={`/assets/${resolvedAsset.id}`}>{resolvedAsset.name}</Link> : undefined}
        subtitle={assetFacts || undefined}
        emptyText="No specific asset"
        onEdit={readOnly ? undefined : onEdit}
        expandedContent={assetExpanded}
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
        expandedContent={contractExpanded}
      />
    </FormGrid>
  );
}
