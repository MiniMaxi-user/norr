"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, EmptyState, Heading, Inline, Select, Stack, Table, Text } from "@yourorg/ui";
import { Boxes } from "@yourorg/ui/icons";
import { linkContractAsset, unlinkContractAsset, type ContractAssetRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";

export interface ContractAssetsPanelProps {
  contractId: string;
  /** Assets currently linked to this contract, via `listContractAssets`. */
  contractAssets: ContractAssetRecord[];
  /** Every asset belonging to the contract's own client (`contract.client_id`)
   * — the "link another asset" picker filters this down to the ones NOT
   * already in `contractAssets` client-side, so it always reflects the
   * latest link state without a second round trip after a link/unlink. */
  clientAssets: AssetRecord[];
  /** `null` when a linked asset's site has no address parts to format at
   * all (shouldn't normally happen — `addressLine1`/`city` are required —
   * but `formatSiteAddressShort` is total, not partial, so the type carries
   * that possibility through rather than lying about it). */
  siteLabelById: Map<string, string | null>;
  /** Gated on `can(actor, "contracts", "create")` — matches
   * `linkContractAsset`'s own RBAC/RLS boundary (owner/finance only). */
  canLink: boolean;
  /** Gated on `can(actor, "contracts", "delete")` — matches
   * `unlinkContractAsset`'s own RBAC/RLS boundary. */
  canUnlink: boolean;
}

/**
 * "Assets covered by this contract" — the `contract_assets` many-to-many
 * link surfaced in-context on the contract detail page, per
 * docs/ARCHITECTURE.md "Relational detail pages": small enough that a
 * compact list + inline add/remove is the right weight, not a separate full
 * page. No `Tabs` wrapper (unlike the Client detail page's four sibling
 * tabs) since Linked Assets is the contract's only relation worth
 * surfacing — a single always-visible section reads better than a one-tab
 * `Tabs`.
 */
export function ContractAssetsPanel({
  contractId,
  contractAssets,
  clientAssets,
  siteLabelById,
  canLink,
  canUnlink,
}: ContractAssetsPanelProps) {
  const router = useRouter();
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const linkedAssetIds = useMemo(() => new Set(contractAssets.map((ca) => ca.asset_id)), [contractAssets]);
  const availableAssets = useMemo(
    () => clientAssets.filter((asset) => !linkedAssetIds.has(asset.id)),
    [clientAssets, linkedAssetIds],
  );

  function handleLink() {
    if (!selectedAssetId) return;
    setError(null);
    startTransition(async () => {
      const result = await linkContractAsset(contractId, selectedAssetId);
      if (!result.data) {
        setError(result.error ?? "Could not link this asset.");
        return;
      }
      setSelectedAssetId("");
      router.refresh();
    });
  }

  function handleUnlink(assetId: string) {
    setError(null);
    startTransition(async () => {
      const result = await unlinkContractAsset(contractId, assetId);
      if (!result.data) {
        setError(result.error ?? "Could not unlink this asset.");
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <Stack gap="md">
        <Heading level={3}>Linked Assets</Heading>
        {error && <Text tone="danger">{error}</Text>}

        {contractAssets.length === 0 ? (
          <EmptyState
            icon={<Boxes />}
            heading="No assets linked yet"
            text="Link the assets this contract covers so they show up here."
          />
        ) : (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell>Asset</Table.HeaderCell>
                <Table.HeaderCell>Site</Table.HeaderCell>
                {canUnlink && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {contractAssets.map((contractAsset) => (
                <Table.Row key={contractAsset.asset_id}>
                  <Table.Cell>
                    {contractAsset.asset ? (
                      <Link href={`/assets/${contractAsset.asset.id}`}>{contractAsset.asset.name}</Link>
                    ) : (
                      "Unknown asset"
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {contractAsset.asset ? siteLabelById.get(contractAsset.asset.site_id) ?? "—" : "—"}
                  </Table.Cell>
                  {canUnlink && (
                    <Table.Cell align="center">
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={isPending}
                        onClick={() => handleUnlink(contractAsset.asset_id)}
                      >
                        Unlink
                      </Button>
                    </Table.Cell>
                  )}
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}

        {canLink && (
          <Stack gap="sm">
            <Text tone="muted">Link another asset from this contract&rsquo;s client:</Text>
            <Inline gap="sm" align="center">
              <Select
                aria-label="Select an asset to link"
                value={selectedAssetId}
                onChange={(event) => setSelectedAssetId(event.target.value)}
                disabled={availableAssets.length === 0 || isPending}
              >
                <option value="">
                  {availableAssets.length === 0 ? "No more assets to link" : "Select an asset…"}
                </option>
                {availableAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </Select>
              <Button type="button" variant="outline" onClick={handleLink} disabled={!selectedAssetId || isPending}>
                {isPending ? "Linking…" : "Link asset"}
              </Button>
            </Inline>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
