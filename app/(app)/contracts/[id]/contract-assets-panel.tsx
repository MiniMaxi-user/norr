"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Dialog, EmptyState, Label, SectionHeader, Select, Stack, Table, Text } from "@yourorg/ui";
import { Boxes } from "@yourorg/ui/icons";
import { linkContractAsset, unlinkContractAsset, type ContractAssetRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";

export interface ContractAssetsPanelProps {
  contractId: string;
  /** Assets currently linked to this contract, via `listContractAssets`. */
  contractAssets: ContractAssetRecord[];
  /** Every asset belonging to the contract's own client (`contract.client_id`)
   * — the "link another asset" dialog filters this down to the ones NOT
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
 * "Covered assets" — the `contract_assets` many-to-many link surfaced
 * in-context on the contract detail page, per docs/ARCHITECTURE.md
 * "Relational detail pages": small enough that a compact list + add/remove
 * is the right weight, not a separate full page.
 *
 * Restructured by the Contract detail "1b" layout (docs/
 * designinstructieskanweg/"Contract detail 1b - implementatie.md" section
 * 4): a flat `SectionHeader` (no `Card`/`Heading` wrapper — matches every
 * other section on this page, and Work Orders' own flat-section
 * convention) with a small primary "+ Asset" action, instead of the
 * always-visible "link another asset" row this used to end with — that
 * picker now lives behind "+ Asset" in `ContractLinkAssetDialog`, same
 * `Dialog.Header`/`Body`/`Footer` shape `ContractLineItemDialog`
 * (`../components/contract-line-items-section.tsx`) already uses.
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
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const linkedAssetIds = useMemo(() => new Set(contractAssets.map((ca) => ca.asset_id)), [contractAssets]);
  const availableAssets = useMemo(
    () => clientAssets.filter((asset) => !linkedAssetIds.has(asset.id)),
    [clientAssets, linkedAssetIds],
  );

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
    <Stack gap="md">
      <SectionHeader
        icon={Boxes}
        title="Covered assets"
        actions={
          canLink && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setLinking(true)}
              disabled={availableAssets.length === 0}
            >
              + Asset
            </Button>
          )
        }
      />
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

      {linking && (
        <ContractLinkAssetDialog
          open
          onOpenChange={setLinking}
          contractId={contractId}
          availableAssets={availableAssets}
        />
      )}
    </Stack>
  );
}

function ContractLinkAssetDialog({
  open,
  onOpenChange,
  contractId,
  availableAssets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  availableAssets: AssetRecord[];
}) {
  const router = useRouter();
  const [assetId, setAssetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!assetId) {
      setError("Select an asset.");
      return;
    }
    setError(null);
    setSaving(true);
    const result = await linkContractAsset(contractId, assetId);
    setSaving(false);
    if (!result.data) {
      setError(result.error ?? "Could not link this asset.");
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>Link asset</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="xs">
            <Label htmlFor="contract-link-asset">Asset</Label>
            <Select
              id="contract-link-asset"
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
              disabled={availableAssets.length === 0}
              required
            >
              <option value="" disabled>
                {availableAssets.length === 0 ? "No more assets to link" : "Select an asset…"}
              </option>
              {availableAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </Select>
          </Stack>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleSave} disabled={saving || !assetId}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
