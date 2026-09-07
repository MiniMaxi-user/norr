"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Combobox, Dialog, IconButton, Inline, Stack, Text } from "@yourorg/ui";
import { X } from "@yourorg/ui/icons";
import {
  linkContractAsset,
  unlinkContractAsset,
  type AssetContractCoverage,
  type ContractRecord,
} from "@/app/(app)/contracts/actions";
import { formatDate } from "@/lib/format/date";

export interface AssetContractsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId: string;
  /** Every contract that covers this asset — directly linked AND inherited
   * from an ancestor composite asset (`useAssetContracts`, issue #126). */
  coverage: AssetContractCoverage[];
  loading: boolean;
  /** This asset's own client's contracts (`useClientScopedLists`'s
   * `contracts`) — the "link a contract" combobox filters these down to the
   * ones NOT already linked, same "always reflects the latest link state"
   * convention `ContractAssetsPanel`'s own `availableAssets` documents for
   * the reverse direction. */
  clientContracts: ContractRecord[];
  /** Re-fetches `coverage` (instant popup feedback) AND refreshes the page
   * (so the hero's "Work orders" KPI tile's "N contract" figure stays in
   * sync) — called after every link/unlink. */
  onChange: () => void;
}

/**
 * The Contract relation card's edit popup (asset new/edit design handoff v3,
 * extended by issue #126 for inherited coverage) — built honestly around the
 * real `contract_assets` many-to-many (there is no single `contractId`
 * column on `assets` for a plain picker to write to): lists every contract
 * that COVERS this asset, direct or inherited, plus a combobox to link one of
 * the asset's own client's contracts directly (`linkContractAsset`). Only a
 * `source: "direct"` row is removable (`unlinkContractAsset`) — an
 * `"inherited"` row has no `contract_assets` row of its own on THIS asset to
 * remove; it instead links through to the ancestor asset it's inherited
 * from, where the direct link (or the composition itself) actually lives.
 * Each action commits immediately (no page-wide Save), same "add/remove
 * right away, `router.refresh()` after" convention `ContractAssetsPanel`
 * already uses for the reverse (contract -> its assets) relationship.
 */
export function AssetContractsDialog({
  open,
  onOpenChange,
  assetId,
  coverage,
  loading,
  clientContracts,
  onChange,
}: AssetContractsDialogProps) {
  const [linkContractId, setLinkContractId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every contract already COVERING this asset — direct or inherited — is
  // excluded from the "link a contract" combobox below: an asset already
  // inheriting a contract from a composite ancestor shouldn't also be
  // offered it as a redundant direct link.
  const linkedIds = useMemo(() => new Set(coverage.map((entry) => entry.contract.id)), [coverage]);
  const availableOptions = useMemo(
    () =>
      clientContracts
        .filter((contract) => !linkedIds.has(contract.id))
        .map((contract) => ({ value: contract.id, label: contract.name })),
    [clientContracts, linkedIds],
  );

  async function handleLink() {
    if (!linkContractId) return;
    setError(null);
    setPending(true);
    const result = await linkContractAsset(linkContractId, assetId);
    setPending(false);
    if (!result.data) {
      setError(result.error ?? "Could not link this contract.");
      return;
    }
    setLinkContractId("");
    onChange();
  }

  async function handleUnlink(contractId: string) {
    setError(null);
    setPending(true);
    const result = await unlinkContractAsset(contractId, assetId);
    setPending(false);
    if (!result.data) {
      setError(result.error ?? "Could not unlink this contract.");
      return;
    }
    onChange();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>Contracts</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}

          {loading ? (
            <Text tone="muted">Loading…</Text>
          ) : coverage.length === 0 ? (
            <Text tone="muted">No contracts linked yet.</Text>
          ) : (
            <Stack gap="sm">
              {coverage.map(({ contract, source }) => (
                <Inline key={contract.id} justify="between" align="center" gap="sm">
                  <Stack gap="xs">
                    <Inline align="center" gap="xs">
                      <Link href={`/contracts/${contract.id}`}>{contract.name}</Link>
                      {source.type === "inherited" && <Badge variant="muted">Inherited</Badge>}
                    </Inline>
                    <Text tone="muted">
                      {[contract.contract_type?.label, `from ${formatDate(contract.start_date)}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    {source.type === "inherited" && (
                      <Text tone="muted">
                        Inherited via{" "}
                        <Link href={`/assets/${source.viaAsset.id}`}>{source.viaAsset.name}</Link>
                      </Text>
                    )}
                  </Stack>
                  {source.type === "direct" ? (
                    <IconButton
                      variant="ghost"
                      aria-label={`Unlink ${contract.name}`}
                      onClick={() => handleUnlink(contract.id)}
                      disabled={pending}
                    >
                      <X />
                    </IconButton>
                  ) : null}
                </Inline>
              ))}
            </Stack>
          )}

          <Stack gap="xs">
            <Text tone="muted">Link a contract from this asset&rsquo;s client</Text>
            <Combobox
              aria-label="Link a contract"
              options={availableOptions}
              value={linkContractId}
              onChange={setLinkContractId}
              placeholder={availableOptions.length === 0 ? "No more contracts to link" : "Search contracts…"}
              disabled={availableOptions.length === 0 || pending}
              clearable
            />
          </Stack>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        <Button type="button" variant="primary" onClick={handleLink} disabled={!linkContractId || pending}>
          {pending ? "Linking…" : "Link"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
