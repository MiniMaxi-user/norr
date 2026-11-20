"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Combobox, toast, type ComboboxOption } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { WebConfirmDialog, WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import { linkContractAsset, unlinkContractAsset, type ContractAssetRecord } from "../actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import { formatDateWeb } from "@/lib/format/web";

export interface ContractAssetsPanelProps {
  contractId: string;
  /** Assets currently linked to this contract. */
  contractAssets: ContractAssetRecord[];
  /** Every asset of the contract's own client — the link dialog offers the
   * ones not linked yet. */
  clientAssets: AssetRecord[];
  siteLabelById: Map<string, string | null>;
  /** `can(actor, "contracts", "create")` — matches `linkContractAsset`. */
  canLink: boolean;
  /** `can(actor, "contracts", "delete")` — matches `unlinkContractAsset`. */
  canUnlink: boolean;
}

const RECENT_DAYS = 30;

/**
 * Assets tab (design system, issue #222): the assets this contract covers, as
 * one card with a FilterBar and a table — Site dropdown and a Recent · Earlier
 * · All toggle on when the asset was linked. `+ Asset` opens the small link
 * dialog (a searchable list of the client's assets that are not linked yet);
 * Open and Unlink live in one ··· menu per row.
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

  const linkedIds = useMemo(() => new Set(contractAssets.map((row) => row.asset_id)), [contractAssets]);
  const available = useMemo(() => clientAssets.filter((asset) => !linkedIds.has(asset.id)), [clientAssets, linkedIds]);

  const siteOf = (row: ContractAssetRecord) => (row.asset ? (siteLabelById.get(row.asset.site_id) ?? null) : null);

  async function unlink(row: ContractAssetRecord) {
    const result = await unlinkContractAsset(contractId, row.asset_id);
    if (!result.data) {
      toast({
        title: "Asset not unlinked",
        description: result.error ?? "Could not unlink this asset. Try again.",
        tone: "danger",
        duration: 6000,
      });
      return;
    }
    toast({ title: "Asset unlinked", duration: 3000 });
    router.refresh();
  }

  const columns = useMemo<WebColumn<ContractAssetRecord>[]>(
    () => [
      {
        id: "asset",
        header: "Asset",
        primary: true,
        mono: true,
        sortValue: (row) => row.asset?.name ?? "",
        render: (row) => row.asset?.name ?? "Unknown asset",
      },
      {
        id: "site",
        header: "Site",
        sortValue: (row) => siteOf(row) ?? "",
        render: (row) => siteOf(row) ?? "—",
      },
      {
        id: "linked",
        header: "Linked on",
        sortValue: (row) => row.created_at,
        render: (row) => formatDateWeb(row.created_at),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteLabelById],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "site",
        label: "Site",
        getOptions: (row: ContractAssetRecord) => {
          const site = row.asset ? (siteLabelById.get(row.asset.site_id) ?? null) : null;
          return site && row.asset ? [{ value: row.asset.site_id, label: site }] : [];
        },
      },
    ],
    [siteLabelById],
  );

  const segment = useMemo(() => {
    const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    const isRecent = (row: ContractAssetRecord) => new Date(row.created_at).getTime() >= cutoff;
    return {
      label: "Show assets",
      defaultValue: "all",
      options: [
        { value: "recent", label: "Recent", match: isRecent },
        { value: "earlier", label: "Earlier", match: (row: ContractAssetRecord) => !isRecent(row) },
        { value: "all", label: "All" },
      ] as const,
    };
  }, []);

  const rowActions = (row: ContractAssetRecord): WebMenuItem[] => {
    const items: WebMenuItem[] = [];
    if (row.asset) items.push({ key: "open", label: "Open asset", href: `/assets/${row.asset.id}` });
    if (canUnlink) {
      if (items.length > 0) items.push({ type: "separator", key: "sep" });
      items.push({ key: "unlink", label: "Unlink asset", danger: true, onSelect: () => void unlink(row) });
    }
    return items;
  };

  return (
    <div className="web-tab-stack">
      <WebDataTableCard
        title="Covered assets"
        meta={String(contractAssets.length)}
        rows={contractAssets}
        getRowKey={(row) => row.asset_id}
        columns={columns}
        searchText={(row) => `${row.asset?.name ?? ""} ${siteOf(row) ?? ""}`}
        noun="assets"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="assets"
        defaultSort={{ columnId: "asset", direction: "asc" }}
        rowHref={(row) => (row.asset ? `/assets/${row.asset.id}` : "")}
        rowActions={rowActions}
        rowLabel={(row) => row.asset?.name ?? "asset"}
        add={
          canLink ? (
            <WebButton
              size="filter"
              onClick={() => setLinking(true)}
              disabled={available.length === 0}
              title={available.length === 0 ? "Every asset of this client is already linked" : undefined}
            >
              + Asset
            </WebButton>
          ) : undefined
        }
        emptyAction={canLink ? "Use + Asset to link the assets this contract covers." : undefined}
      />

      {linking ? (
        <LinkAssetDialog
          contractId={contractId}
          available={available}
          siteLabelById={siteLabelById}
          onClose={() => setLinking(false)}
        />
      ) : null}
    </div>
  );
}

function LinkAssetDialog({
  contractId,
  available,
  siteLabelById,
  onClose,
}: {
  contractId: string;
  available: AssetRecord[];
  siteLabelById: Map<string, string | null>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [assetId, setAssetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options: ComboboxOption[] = available.map((asset) => {
    const site = siteLabelById.get(asset.site_id);
    return { value: asset.id, label: site ? `${asset.name} — ${site}` : asset.name };
  });

  async function handleSave() {
    if (!assetId) {
      setError("Choose an asset");
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
    if (result.data.warning) {
      toast({ title: "Asset linked, baseline reading missing", description: result.data.warning, tone: "warning", duration: 10000 });
    }
    onClose();
    router.refresh();
  }

  return (
    <WebConfirmDialog
      open
      title="Link asset"
      confirmLabel="Link asset"
      confirmVariant="save"
      pending={saving}
      error={error}
      onCancel={onClose}
      onConfirm={() => void handleSave()}
    >
      <div className="web-dialog-form">
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="contract-link-asset">
            Asset
          </label>
          <Combobox
            id="contract-link-asset"
            options={options}
            value={assetId}
            onChange={setAssetId}
            placeholder="Search by asset ID or site…"
            emptyMessage="No matching assets"
          />
        </div>
      </div>
    </WebConfirmDialog>
  );
}
