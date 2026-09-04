"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Combobox, Dialog, IconButton, Inline, Stack, Text } from "@yourorg/ui";
import { X } from "@yourorg/ui/icons";
import { linkContractAsset, unlinkContractAsset, type ContractRecord } from "@/app/(app)/contracts/actions";
import { formatDate } from "@/lib/format/date";

export interface AssetContractsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetId: string;
  /** Every contract currently linked to this asset (`useAssetContracts`). */
  contracts: ContractRecord[];
  loading: boolean;
  /** This asset's own client's contracts (`useClientScopedLists`'s
   * `contracts`) — the "link a contract" combobox filters these down to the
   * ones NOT already linked, same "always reflects the latest link state"
   * convention `ContractAssetsPanel`'s own `availableAssets` documents for
   * the reverse direction. */
  clientContracts: ContractRecord[];
  /** Re-fetches `contracts` (instant popup feedback) AND refreshes the page
   * (so the hero's "Work orders" KPI tile's "N contract" figure stays in
   * sync) — called after every link/unlink. */
  onChange: () => void;
}

/**
 * The Contract relation card's edit popup (asset new/edit design handoff v3)
 * — built honestly around the real `contract_assets` many-to-many (there is
 * no single `contractId` column on `assets` for a plain picker to write to):
 * lists every contract already linked (each removable via
 * `unlinkContractAsset`) plus a combobox to link one of the asset's own
 * client's contracts (`linkContractAsset`). Each action commits immediately
 * (no page-wide Save), same "add/remove right away, `router.refresh()`
 * after" convention `ContractAssetsPanel` already uses for the reverse
 * (contract -> its assets) relationship.
 */
export function AssetContractsDialog({
  open,
  onOpenChange,
  assetId,
  contracts,
  loading,
  clientContracts,
  onChange,
}: AssetContractsDialogProps) {
  const [linkContractId, setLinkContractId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkedIds = useMemo(() => new Set(contracts.map((contract) => contract.id)), [contracts]);
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
          ) : contracts.length === 0 ? (
            <Text tone="muted">No contracts linked yet.</Text>
          ) : (
            <Stack gap="sm">
              {contracts.map((contract) => (
                <Inline key={contract.id} justify="between" align="center" gap="sm">
                  <Stack gap="xs">
                    <Link href={`/contracts/${contract.id}`}>{contract.name}</Link>
                    <Text tone="muted">
                      {[contract.contract_type?.label, `from ${formatDate(contract.start_date)}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </Stack>
                  <IconButton
                    variant="ghost"
                    aria-label={`Unlink ${contract.name}`}
                    onClick={() => handleUnlink(contract.id)}
                    disabled={pending}
                  >
                    <X />
                  </IconButton>
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
