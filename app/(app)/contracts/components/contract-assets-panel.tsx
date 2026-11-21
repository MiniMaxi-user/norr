"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Combobox, toast, type ComboboxOption } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { WebConfirmDialog, WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import { linkContractAsset, type ContractAssetRecord } from "../actions";
import type { ContractStatus } from "../schema";
import { RemoveContractAssetDialog } from "./remove-contract-asset-dialog";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import { formatDateWeb } from "@/lib/format/web";

export interface ContractAssetsPanelProps {
  contractId: string;
  /** Ended contracts offer no remove action; Draft = plain unlink, Active = removal dialog (issue #274). */
  contractStatus: ContractStatus;
  /** Every link of this contract: open ones and, after a removal, the removed ones (`removed_on` set). */
  contractAssets: ContractAssetRecord[];
  /** Every asset of the contract's own client — the link dialog offers the
   * ones not linked yet. */
  clientAssets: AssetRecord[];
  siteLabelById: Map<string, string | null>;
  /** `can(actor, "contracts", "create")` — matches `linkContractAsset`. */
  canLink: boolean;
  /** `can(actor, "contracts", "delete")` — matches `removeContractAsset`. */
  canUnlink: boolean;
}

const RECENT_DAYS = 30;



/** "Brand Model", either part optional; null when neither is set. */
function modelLabel(brand: string | null | undefined, model: string | null | undefined): string | null {
  const text = [brand, model].filter(Boolean).join(" ");
  return text || null;
}

/**
 * Assets tab (design system, issue #222): the assets this contract covers, as
 * one card with a FilterBar and a table (asset ID, model, serial number,
 * external reference, site) — Site dropdown and a Recent · Earlier · All
 * toggle on when the asset was linked; the search matches asset ID, external
 * reference and serial number. `+ Asset` opens the small link dialog (a
 * searchable list of the client's assets that are not linked yet, each with
 * its model, serial number, external reference and site);
 * Open and Unlink live in one ··· menu per row.
 */
export function ContractAssetsPanel({
  contractId,
  contractStatus,
  contractAssets,
  clientAssets,
  siteLabelById,
  canLink,
  canUnlink,
}: ContractAssetsPanelProps) {
  const router = useRouter();
  const [linking, setLinking] = useState(false);
  const [removing, setRemoving] = useState<ContractAssetRecord | null>(null);

  // Open links are the current coverage; removed ones are history (and can be linked again).
  const openAssets = useMemo(() => contractAssets.filter((row) => !row.removed_on), [contractAssets]);
  const removedAssets = useMemo(() => contractAssets.filter((row) => row.removed_on), [contractAssets]);
  const linkedIds = useMemo(() => new Set(openAssets.map((row) => row.asset_id)), [openAssets]);
  const available = useMemo(() => clientAssets.filter((asset) => !linkedIds.has(asset.id)), [clientAssets, linkedIds]);

  const siteOf = (row: ContractAssetRecord) => (row.asset ? (siteLabelById.get(row.asset.site_id) ?? null) : null);

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
        id: "model",
        header: "Model",
        sortValue: (row) => modelLabel(row.asset?.asset_brand?.label, row.asset?.asset_model?.name) ?? "",
        render: (row) => modelLabel(row.asset?.asset_brand?.label, row.asset?.asset_model?.name) ?? "—",
      },
      {
        id: "serial",
        header: "Serial number",
        mono: true,
        sortValue: (row) => row.asset?.serial_number ?? "",
        render: (row) => row.asset?.serial_number ?? "—",
      },
      {
        id: "externalReference",
        header: "External ref.",
        sortValue: (row) => row.asset?.external_reference ?? "",
        render: (row) => row.asset?.external_reference ?? "—",
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

  const removedSegment = useMemo(() => {
    const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const isRecent = (row: ContractAssetRecord) => (row.removed_on ?? "") >= cutoff;
    return {
      label: "Show removed assets",
      defaultValue: "all",
      options: [
        { value: "recent", label: "Recent", match: isRecent },
        { value: "earlier", label: "Earlier", match: (row: ContractAssetRecord) => !isRecent(row) },
        { value: "all", label: "All" },
      ] as const,
    };
  }, []);

  const removedColumns = useMemo<WebColumn<ContractAssetRecord>[]>(
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
        id: "serial",
        header: "Serial number",
        mono: true,
        sortValue: (row) => row.asset?.serial_number ?? "",
        render: (row) => row.asset?.serial_number ?? "—",
      },
      {
        id: "linked",
        header: "Linked on",
        sortValue: (row) => row.created_at,
        render: (row) => formatDateWeb(row.created_at),
      },
      {
        id: "removedOn",
        header: "Removed on",
        sortValue: (row) => row.removed_on ?? "",
        render: (row) => (row.removed_on ? formatDateWeb(row.removed_on) : "—"),
      },
      {
        id: "removedBy",
        header: "Removed by",
        sortValue: (row) => row.removed_by_user?.full_name ?? row.removed_by_user?.email ?? "",
        render: (row) => row.removed_by_user?.full_name ?? row.removed_by_user?.email ?? "—",
      },
    ],
    [],
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
    if (canUnlink && contractStatus !== "ended" && !row.removed_on) {
      if (items.length > 0) items.push({ type: "separator", key: "sep" });
      items.push({
        key: "remove",
        label: contractStatus === "draft" ? "Unlink asset" : "Remove from contract…",
        danger: true,
        onSelect: () => setRemoving(row),
      });
    }
    return items;
  };

  return (
    <div className="web-tab-stack">
      <WebDataTableCard
        title="Covered assets"
        meta={String(openAssets.length)}
        rows={openAssets}
        getRowKey={(row) => row.id}
        columns={columns}
        searchText={(row) =>
          [row.asset?.name, row.asset?.external_reference, row.asset?.serial_number, siteOf(row)].filter(Boolean).join(" ")
        }
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

      {removedAssets.length > 0 ? (
        <WebDataTableCard
          title="Removed"
          meta={String(removedAssets.length)}
          rows={removedAssets}
          getRowKey={(row) => row.id}
          columns={removedColumns}
          searchText={(row) => [row.asset?.name, row.asset?.serial_number].filter(Boolean).join(" ")}
          noun="removed assets"
          dropdowns={[]}
          segment={removedSegment}
          urlPrefix="removed"
          defaultSort={{ columnId: "removedOn", direction: "desc" }}
          rowHref={(row) => (row.asset ? `/assets/${row.asset.id}` : "")}
          rowLabel={(row) => row.asset?.name ?? "asset"}
        />
      ) : null}

      {removing ? (
        <RemoveContractAssetDialog
          contractId={contractId}
          assetId={removing.asset_id}
          assetName={removing.asset?.name ?? "this asset"}
          onClose={() => setRemoving(null)}
          onRemoved={() => router.refresh()}
        />
      ) : null}

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
    const model = modelLabel(asset.asset_brand?.label, asset.asset_model?.name);
    const description = [
      model,
      asset.serial_number ? `SN ${asset.serial_number}` : null,
      asset.external_reference ? `Ext. ref. ${asset.external_reference}` : null,
      site,
    ]
      .filter(Boolean)
      .join(" · ");
    return { value: asset.id, label: asset.name, description: description || undefined };
  });
  const selected = available.find((asset) => asset.id === assetId) ?? null;

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
            placeholder="Search by asset ID, external ref. or serial number…"
            emptyMessage="No matching assets"
          />
        </div>
        {selected ? (
          <div className="web-kv">
            <div className="web-kv-col">
              {[
                ["Type", selected.asset_type?.label ?? null],
                ["Model", modelLabel(selected.asset_brand?.label, selected.asset_model?.name)],
                ["Serial number", selected.serial_number],
                ["External ref.", selected.external_reference],
                ["Site", siteLabelById.get(selected.site_id) ?? null],
              ].map(([label, value]) => (
                <div key={label} className="web-kv-row">
                  <span className="web-kv-label">{label}</span>
                  <span className="web-kv-value" data-empty={value ? undefined : "true"}>
                    {value ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </WebConfirmDialog>
  );
}
