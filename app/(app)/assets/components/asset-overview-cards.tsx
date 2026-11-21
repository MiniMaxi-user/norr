"use client";

import { useMemo } from "react";
import Link from "next/link";
import { WebCardStack } from "@yourorg/ui/web";
import {
  KeyValueCard,
  TextCard,
  type EditModeApi,
  type KvEditBinder,
  type KvField,
  type KvOption,
} from "@yourorg/ui/web-client";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { AssetModelRecord } from "@/lib/asset-models/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { formatDateWeb } from "@/lib/format/web";
import type { AssetRecord } from "../actions";
import type { InactiveAssetOption } from "../asset-errors";
import type { AssetDraft } from "./asset-draft";

export interface AssetReferenceLists {
  clients: ClientRecord[];
  types: ReferenceListItemRecord[];
  subtypes: ReferenceListItemRecord[];
  statuses: ReferenceListItemRecord[];
  brands: ReferenceListItemRecord[];
  models: AssetModelRecord[];
}

export interface AssetOverviewCardsProps {
  edit: EditModeApi<AssetDraft>;
  asset?: AssetRecord;
  client: ClientRecord | null;
  site: SiteRecord | null;
  lists: AssetReferenceLists;
  /** Sites of the draft's client (fetched client-side, follows `clientId`). */
  sites: SiteRecord[];
  loadingOptions: boolean;
  /** Inactive assets (any client) the "Previous asset" select offers (issue #274). */
  previousAssetOptions: InactiveAssetOption[];
  lockedClientId?: string;
  isNew: boolean;
}

/** "Asset name · Client" with model and serial number when known. */
export function previousAssetLabel(option: InactiveAssetOption): string {
  const detail = [option.model?.name, option.serial_number ? `SN ${option.serial_number}` : null].filter(Boolean).join(", ");
  return `${option.name} · ${option.client.name}${detail ? ` (${detail})` : ""}`;
}

function modelName(model: AssetModelRecord) {
  return [model.brand?.label, model.name].filter(Boolean).join(" ");
}

/** Today + `months` months, `YYYY-MM-DD` — the model's warranty proposal. */
function addMonths(isoDate: string, months: number): string | null {
  const base = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  base.setMonth(base.getMonth() + months);
  return base.toISOString().slice(0, 10);
}

/**
 * The Overview tab's cards (design system, issue #222): ONE two-column
 * "Details" card — identity on the left (asset ID, model, brand, type,
 * sub-type, serial, external reference), place and relation on the right
 * (client, site, status, installed on, warranty until) — and Notes. Replaces
 * the Equipment and Status & warranty sections, the four summary cards with
 * pencils and the per-section Save buttons: everything is edited from the
 * page header's single Edit button.
 *
 * Model drives type/sub-type/brand (and proposes the warranty date when none
 * is set); the brand row is grey and derived while a model is chosen. Site
 * depends on client and sub-type on type — disabled with an explanation until
 * the parent has a value, and cleared when the parent changes.
 */
export function AssetOverviewCards({
  edit,
  asset,
  client,
  site,
  lists,
  sites,
  loadingOptions,
  previousAssetOptions,
  lockedClientId,
  isNew,
}: AssetOverviewCardsProps) {
  const saved = edit.record;
  const draft = edit.draft;
  const editing = edit.isEditing;

  const modelById = useMemo(() => new Map(lists.models.map((model) => [model.id, model] as const)), [lists.models]);
  const labelOf = (items: ReferenceListItemRecord[], id: string, fallback?: string | null) =>
    items.find((item) => item.id === id)?.label ?? fallback ?? "";

  // Cascades: wrap the binder instead of special-casing the card.
  const binder = useMemo<KvEditBinder>(
    () => ({
      get isEditing() {
        return edit.isEditing;
      },
      getField: (key: string) => {
        const binding = edit.getField(key as keyof AssetDraft & string);
        if (key === "clientId") {
          return {
            ...binding,
            onChange: (value) => {
              binding.onChange(value);
              edit.setValue("siteId", "");
            },
          };
        }
        if (key === "typeId") {
          return {
            ...binding,
            onChange: (value) => {
              binding.onChange(value);
              const current = lists.subtypes.find((item) => item.id === edit.draft.subtypeId);
              if (current && current.parent_item_id !== value) edit.setValue("subtypeId", "");
            },
          };
        }
        if (key === "modelId") {
          return {
            ...binding,
            onChange: (value) => {
              binding.onChange(value);
              const model = typeof value === "string" ? modelById.get(value) : undefined;
              if (!model) return;
              edit.setValue("brandItemId", model.brand_item_id);
              edit.setValue("typeId", model.type_item_id);
              edit.setValue("subtypeId", model.subtype_item_id ?? "");
              // Same rule the old model popup used: only propose a warranty
              // date when none is set yet.
              if (!edit.draft.warrantyUntil && edit.draft.installedAt) {
                const proposal = addMonths(edit.draft.installedAt, model.default_warranty_months);
                if (proposal) edit.setValue("warrantyUntil", proposal);
              }
            },
          };
        }
        return binding;
      },
      countsFor: (keys) => edit.countsFor(keys),
    }),
    [edit, lists.subtypes, modelById],
  );

  // --- Read values ----------------------------------------------------------
  const savedModel = saved.modelId ? modelById.get(saved.modelId) : undefined;
  const savedModelLabel = savedModel
    ? modelName(savedModel)
    : saved.modelId && asset?.model_id === saved.modelId
      ? (asset.asset_model?.name ?? "")
      : "";
  const savedBrand = labelOf(lists.brands, saved.brandItemId, saved.brandItemId === asset?.brand_item_id ? asset?.asset_brand?.label : null);
  const savedType = labelOf(lists.types, saved.typeId, saved.typeId === asset?.type_id ? asset?.asset_type?.label : null);
  const savedSubtype = labelOf(
    lists.subtypes,
    saved.subtypeId,
    saved.subtypeId === asset?.subtype_id ? asset?.asset_subtype?.label : null,
  );
  const savedStatus = labelOf(lists.statuses, saved.statusId, saved.statusId === asset?.status_id ? asset?.asset_status?.label : null);
  const savedClient = lists.clients.find((item) => item.id === saved.clientId) ?? (client?.id === saved.clientId ? client : null);
  const allSites = sites.length > 0 ? sites : site ? [site] : [];
  const savedSite = allSites.find((item) => item.id === saved.siteId) ?? (site?.id === saved.siteId ? site : null);

  // --- Options (always include the current value so a selected item shows
  // even before the reference lists have loaded) --------------------------
  const withCurrent = (options: KvOption[], id: string, label: string): KvOption[] =>
    id && label && !options.some((option) => option.value === id) ? [{ value: id, label }, ...options] : options;

  const modelOptions = withCurrent(
    lists.models.map((model) => ({ value: model.id, label: modelName(model) })).sort((a, b) => a.label.localeCompare(b.label)),
    draft.modelId,
    savedModelLabel,
  );
  const brandOptions = lists.brands.map((item) => ({ value: item.id, label: item.label }));
  const typeOptions = withCurrent(
    lists.types.map((item) => ({ value: item.id, label: item.label })),
    draft.typeId,
    savedType,
  );
  const subtypeOptions = withCurrent(
    lists.subtypes
      .filter((item) => item.parent_item_id === draft.typeId)
      .map((item) => ({ value: item.id, label: item.label })),
    draft.subtypeId,
    savedSubtype,
  );
  const clientOptions = withCurrent(
    lists.clients.map((item) => ({ value: item.id, label: item.name })),
    draft.clientId,
    client?.id === draft.clientId ? client.name : "",
  );
  const siteOptions = withCurrent(
    sites.map((item) => ({ value: item.id, label: formatSiteAddressShort(item) ?? "Unnamed site" })),
    draft.siteId,
    site?.id === draft.siteId ? (formatSiteAddressShort(site) ?? "") : "",
  );
  const statusOptions = lists.statuses.map((item) => ({ value: item.id, label: item.label }));
  const currentPrevious = asset?.previous_asset ?? null;
  const previousOptions = withCurrent(
    previousAssetOptions.map((option) => ({ value: option.id, label: previousAssetLabel(option) })),
    draft.previousAssetId,
    currentPrevious && currentPrevious.id === draft.previousAssetId
      ? `${currentPrevious.name}${currentPrevious.client_name ? ` · ${currentPrevious.client_name}` : ""}`
      : "",
  );
  const savedPrevious =
    currentPrevious && currentPrevious.id === saved.previousAssetId
      ? currentPrevious
      : (() => {
          const option = previousAssetOptions.find((item) => item.id === saved.previousAssetId);
          return option ? { id: option.id, name: option.name, client_name: option.client.name } : null;
        })();

  const hasModel = Boolean(draft.modelId);
  // An asset never moves to another client (#274): the client is only chosen when creating.
  const clientLocked = Boolean(lockedClientId) || !isNew;

  const fields: KvField[] = [
    {
      key: "name",
      label: "Asset ID",
      mono: true,
      read: saved.name || asset?.name,
      // The ID is numbered by the database: new assets show it as a derived
      // (read-only) field instead of asking the user to type one.
      ...(isNew ? { kind: "derived" as const, read: "Assigned when saved", note: "Numbered automatically" } : {}),
    },
    {
      key: "modelId",
      label: "Model",
      kind: "select",
      read: savedModelLabel || null,
      options: modelOptions,
      emptyLabel: "Select a model…",
      disabled: loadingOptions,
    },
    hasModel
      ? {
          key: "brandItemId",
          label: "Brand",
          kind: "derived",
          read: labelOf(lists.brands, draft.brandItemId, null) || savedBrand || null,
          note: "Follows from the model",
        }
      : {
          key: "brandItemId",
          label: "Brand",
          kind: "select",
          read: savedBrand || null,
          options: brandOptions,
          emptyLabel: "No brand",
          disabled: loadingOptions,
        },
    {
      key: "typeId",
      label: "Type",
      kind: "select",
      read: savedType || null,
      options: typeOptions,
      emptyLabel: "Select a type…",
      disabled: loadingOptions,
    },
    {
      key: "subtypeId",
      label: "Sub-type",
      kind: "select",
      read: savedSubtype || null,
      options: subtypeOptions,
      emptyLabel: "No sub-type",
      disabled: loadingOptions || !draft.typeId,
      disabledNote: loadingOptions ? undefined : "Choose a type first",
    },
    { key: "serialNumber", label: "Serial number", mono: true, read: saved.serialNumber },
    { key: "externalReference", label: "External reference", read: saved.externalReference },
    {
      key: "clientId",
      label: "Client",
      kind: "select",
      read: savedClient ? <Link href={`/clients/${savedClient.id}`}>{savedClient.name}</Link> : null,
      options: clientOptions,
      emptyLabel: "Select a client…",
      disabled: loadingOptions || clientLocked,
      disabledNote: lockedClientId
        ? "Set by the client you came from"
        : !isNew
          ? "An asset can't move to another client. Make it inactive and create a new asset at the new client."
          : undefined,
    },
    {
      key: "siteId",
      label: "Site",
      kind: "select",
      read: savedSite ? (formatSiteAddressShort(savedSite) ?? "Unnamed site") : null,
      options: siteOptions,
      emptyLabel: "Select a site…",
      disabled: !draft.clientId,
      disabledNote: "Choose a client first",
    },
    {
      key: "statusId",
      label: "Status",
      kind: "select",
      read: savedStatus || null,
      options: statusOptions,
      emptyLabel: "Select a status…",
      disabled: loadingOptions,
    },
    {
      key: "previousAssetId",
      label: "Previous asset",
      kind: "select",
      read: savedPrevious ? (
        <Link href={`/assets/${savedPrevious.id}`}>
          {savedPrevious.name}
          {savedPrevious.client_name ? ` · ${savedPrevious.client_name}` : ""}
        </Link>
      ) : null,
      options: previousOptions,
      emptyLabel: "No previous asset",
      disabled: loadingOptions,
      note: "An inactive asset this one replaces, possibly at another client",
    },
    { key: "installedAt", label: "Installed on", kind: "date", read: saved.installedAt ? formatDateWeb(saved.installedAt) : null },
    {
      key: "warrantyUntil",
      label: "Warranty until",
      kind: "date",
      read: saved.warrantyUntil ? formatDateWeb(saved.warrantyUntil) : null,
    },
  ];

  return (
    <WebCardStack>
      <KeyValueCard title="Details" columns={2} split={7} fields={fields} edit={binder} />
      <TextCard
        title="Notes"
        fieldKey="notes"
        text={saved.notes}
        emptyText="No notes yet"
        placeholder="Anything worth knowing about this asset"
        edit={editing ? binder : undefined}
      />
    </WebCardStack>
  );
}
