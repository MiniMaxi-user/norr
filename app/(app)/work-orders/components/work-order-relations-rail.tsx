import Link from "next/link";
import { Badge, Card, DefinitionList, Heading, Inline, Stack, Text, type DefinitionListItem } from "@yourorg/ui";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import { formatSiteAddress } from "@/app/(app)/clients/format-site-address";
import { formatCurrency } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/date";

/**
 * The sticky rail rendered alongside a work order's own fields (both
 * `mode: "create"` and `mode: "edit"`, editable and read-only) via
 * `@yourorg/ui`'s `DetailLayout` — issue #100's "make sure client/site/
 * asset/contract details are visible" ask. Same visual language as
 * `client-detail.tsx`'s own rail Cards (`Heading level={6}` + `DefinitionList`
 * facts), not a new pattern: Client/Asset/Contract link out to their own
 * detail page (Site has none — see `formatSiteAddress` usage below, same
 * reasoning `work-order-fields.tsx`'s old read-only branch already
 * documented).
 *
 * Each of the four relations is independently loading/empty/resolved (the
 * work order's own Client/Site/Asset/Contract selection, which in
 * `mode: "create"` genuinely doesn't exist yet until the user picks one) —
 * `has*Selection` distinguishes "nothing picked" from "picked, but the full
 * record hasn't resolved yet" (`*Loading`) so the two don't both read as a
 * blank/empty card.
 */
export interface WorkOrderRelationsRailProps {
  client: ClientRecord | null;
  hasClientSelection: boolean;
  clientLoading: boolean;

  site: SiteRecord | null;
  hasSiteSelection: boolean;
  siteLoading: boolean;

  asset: AssetRecord | null;
  hasAssetSelection: boolean;
  assetLoading: boolean;

  contract: ContractRecord | null;
  hasContractSelection: boolean;
  contractLoading: boolean;
}

/** Shared "nothing to show yet" body for a relation card — loading beats
 * "nothing picked" beats "picked but not resolved" (the last one is a rare
 * transient case, e.g. a stale id pointing at a deleted row). */
function RelationCardState({
  loading,
  hasSelection,
  emptyText,
}: {
  loading: boolean;
  hasSelection: boolean;
  emptyText: string;
}) {
  if (loading) return <Text tone="muted">Loading…</Text>;
  if (!hasSelection) return <Text tone="muted">{emptyText}</Text>;
  return <Text tone="muted">—</Text>;
}

export function WorkOrderRelationsRail({
  client,
  hasClientSelection,
  clientLoading,
  site,
  hasSiteSelection,
  siteLoading,
  asset,
  hasAssetSelection,
  assetLoading,
  contract,
  hasContractSelection,
  contractLoading,
}: WorkOrderRelationsRailProps) {
  const clientFacts: DefinitionListItem[] = (
    [
      client?.kvk_number ? { label: "KvK", value: client.kvk_number } : null,
      client?.vat_number ? { label: "VAT", value: client.vat_number } : null,
    ] as (DefinitionListItem | null)[]
  ).filter((item): item is DefinitionListItem => item !== null);

  const assetFacts: DefinitionListItem[] = asset
    ? [
        { label: "Type", value: asset.asset_type?.label ?? "—" },
        {
          label: "Status",
          value: (
            <Badge color={asset.asset_status?.color} variant="muted">
              {asset.asset_status?.label ?? "—"}
            </Badge>
          ),
        },
        ...(asset.serial_number ? [{ label: "Serial", value: asset.serial_number }] : []),
      ]
    : [];

  const contractFacts: DefinitionListItem[] = contract
    ? [
        {
          label: "Type",
          value: (
            <Badge color={contract.contract_type?.color} variant="muted">
              {contract.contract_type?.label ?? "—"}
            </Badge>
          ),
        },
        { label: "Start", value: formatDate(contract.start_date) },
        { label: "End", value: formatDate(contract.end_date) },
        { label: "Value", value: formatCurrency(contract.value) },
      ]
    : [];

  return (
    <>
      <Card>
        <Stack gap="sm">
          <Heading level={6}>Client</Heading>
          {client ? (
            <Stack gap="xs">
              <Link href={`/clients/${client.id}`}>{client.name}</Link>
              {clientFacts.length > 0 && <DefinitionList items={clientFacts} />}
            </Stack>
          ) : (
            <RelationCardState loading={clientLoading} hasSelection={hasClientSelection} emptyText="No client selected yet" />
          )}
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <Heading level={6}>Site</Heading>
          {site ? (
            <Stack gap="xs">
              {/* No detail page of its own to link to (unlike Client/Asset/
                  Contract) — the formatted address is the clearest available
                  representation, same as the old read-only branch. */}
              <Text>{formatSiteAddress(site) ?? "Unnamed site"}</Text>
              {(site.is_primary || site.phone) && (
                <Inline gap="xs" align="center">
                  {site.is_primary && <Badge variant="accent">Primary</Badge>}
                  {site.phone && <Text tone="muted">{site.phone}</Text>}
                </Inline>
              )}
            </Stack>
          ) : (
            <RelationCardState loading={siteLoading} hasSelection={hasSiteSelection} emptyText="No specific site" />
          )}
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <Heading level={6}>Asset</Heading>
          {asset ? (
            <Stack gap="xs">
              <Link href={`/assets/${asset.id}`}>{asset.name}</Link>
              <DefinitionList items={assetFacts} />
            </Stack>
          ) : (
            <RelationCardState loading={assetLoading} hasSelection={hasAssetSelection} emptyText="No specific asset" />
          )}
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <Heading level={6}>Contract</Heading>
          {contract ? (
            <Stack gap="xs">
              <Link href={`/contracts/${contract.id}`}>{contract.name}</Link>
              <DefinitionList items={contractFacts} />
            </Stack>
          ) : (
            <RelationCardState loading={contractLoading} hasSelection={hasContractSelection} emptyText="No contract" />
          )}
        </Stack>
      </Card>
    </>
  );
}
