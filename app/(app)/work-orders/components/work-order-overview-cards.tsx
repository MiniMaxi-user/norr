"use client";

import { useMemo } from "react";
import Link from "next/link";
import { WebCardPair, WebCardStack } from "@yourorg/ui/web";
import {
  KeyValueCard,
  StatusText,
  TextCard,
  toneFromColor,
  type EditModeApi,
  type KvEditBinder,
  type KvField,
  type KvOption,
} from "@yourorg/ui/web-client";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import { useModuleEnabled } from "@/components/shell/module-features";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { contractLabel } from "@/lib/format/contract-label";
import { formatDateTimeWeb } from "@/lib/format/web";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { WorkOrderRecord } from "../actions";
import type { WorkOrderDraft } from "./work-order-draft";
import { WorkOrderSignatureCard } from "./work-order-signature-card";

export interface WorkOrderClientScoped {
  sites: SiteRecord[];
  assets: AssetRecord[];
  contracts: ContractRecord[];
  loadingSites: boolean;
  loadingAssets: boolean;
  loadingContracts: boolean;
}

export interface WorkOrderOverviewCardsProps {
  edit: EditModeApi<WorkOrderDraft>;
  workOrder?: WorkOrderRecord;
  client: ClientRecord | null;
  site: SiteRecord | null;
  asset: AssetRecord | null;
  contract: ContractRecord | null;
  clients: ClientRecord[];
  clientScoped: WorkOrderClientScoped;
  statuses: ReferenceListItemRecord[];
  priorities: ReferenceListItemRecord[];
  types: ReferenceListItemRecord[];
  members: OrgMemberRecord[];
  lockedClientId?: string;
  isNew: boolean;
  /** Source activity of a work order being created from one. */
  sourceActivityId?: string;
  /** Client signature from the field sign-off (issue #226), when present. */
  signature?: { url: string; signedAt: string } | null;
}

/**
 * The Overview tab's cards (design system, issue #222): ONE two-column
 * "Details" card — the job on the left (status, priority, type, duration,
 * external reference, source activity), what and where on the right (client,
 * site, asset, contract, engineer, scheduled for) — then Description, Notes
 * and the read-only Solution (written by the PWA sign-off). No related lists:
 * hours, material and checklist live in their own tabs.
 *
 * Client → Site → Asset cascade: Site is disabled until a client is chosen,
 * Asset until a site is chosen, and a parent change clears the children that
 * no longer belong to it. Contract depends on the client.
 */
export function WorkOrderOverviewCards({
  edit,
  workOrder,
  client,
  site,
  asset,
  contract,
  clients,
  clientScoped,
  statuses,
  priorities,
  types,
  members,
  lockedClientId,
  isNew,
  sourceActivityId,
  signature = null,
}: WorkOrderOverviewCardsProps) {
  const contractsEnabled = useModuleEnabled("contracts");
  const saved = edit.record;
  const draft = edit.draft;

  const binder = useMemo<KvEditBinder>(
    () => ({
      get isEditing() {
        return edit.isEditing;
      },
      getField: (key: string) => {
        const binding = edit.getField(key as keyof WorkOrderDraft & string);
        if (key === "clientId") {
          return {
            ...binding,
            onChange: (value) => {
              binding.onChange(value);
              edit.setValue("siteId", "");
              edit.setValue("assetId", "");
              edit.setValue("contractId", "");
            },
          };
        }
        if (key === "siteId") {
          return {
            ...binding,
            onChange: (value) => {
              binding.onChange(value);
              const current = clientScoped.assets.find((item) => item.id === edit.draft.assetId);
              if (current && current.site_id !== value) edit.setValue("assetId", "");
            },
          };
        }
        return binding;
      },
      countsFor: (keys) => edit.countsFor(keys),
    }),
    [edit, clientScoped.assets],
  );

  const labelOf = (items: ReferenceListItemRecord[], id: string, fallback?: string | null) =>
    items.find((item) => item.id === id)?.label ?? fallback ?? "";
  const colorOf = (items: ReferenceListItemRecord[], id: string, fallback?: string | null) =>
    items.find((item) => item.id === id)?.color ?? fallback ?? null;

  const savedStatus = labelOf(statuses, saved.statusId, saved.statusId === workOrder?.status_id ? workOrder?.work_order_status?.label : null);
  const savedStatusColor = colorOf(statuses, saved.statusId, workOrder?.work_order_status?.color);
  const savedPriority = labelOf(priorities, saved.priorityId, saved.priorityId === workOrder?.priority_id ? workOrder?.work_order_priority?.label : null);
  const savedType = labelOf(types, saved.typeId, saved.typeId === workOrder?.type_id ? workOrder?.work_order_type?.label : null);

  const savedClient = clients.find((item) => item.id === saved.clientId) ?? (client?.id === saved.clientId ? client : null);
  const savedSite =
    clientScoped.sites.find((item) => item.id === saved.siteId) ?? (site?.id === saved.siteId ? site : null);
  const savedAsset =
    clientScoped.assets.find((item) => item.id === saved.assetId) ?? (asset?.id === saved.assetId ? asset : null);
  const savedContract =
    clientScoped.contracts.find((item) => item.id === saved.contractId) ??
    (contract?.id === saved.contractId ? contract : null);
  const memberName = (id: string) => {
    const member = members.find((item) => item.id === id);
    return member ? memberDisplayName(member) : "";
  };

  const withCurrent = (options: KvOption[], id: string, label: string): KvOption[] =>
    id && label && !options.some((option) => option.value === id) ? [{ value: id, label }, ...options] : options;
  const refOptions = (items: ReferenceListItemRecord[]) => items.map((item) => ({ value: item.id, label: item.label }));

  const clientOptions = withCurrent(
    clients.map((item) => ({ value: item.id, label: item.name })),
    draft.clientId,
    client?.id === draft.clientId ? client.name : "",
  );
  const siteOptions = withCurrent(
    clientScoped.sites.map((item) => ({ value: item.id, label: formatSiteAddressShort(item) ?? "Unnamed site" })),
    draft.siteId,
    site?.id === draft.siteId ? (formatSiteAddressShort(site) ?? "Unnamed site") : "",
  );
  const assetOptions = withCurrent(
    clientScoped.assets
      .filter((item) => !draft.siteId || item.site_id === draft.siteId)
      .map((item) => ({ value: item.id, label: item.name })),
    draft.assetId,
    asset?.id === draft.assetId ? asset.name : "",
  );
  const contractOptions = withCurrent(
    clientScoped.contracts.map((item) => ({ value: item.id, label: contractLabel(item) })),
    draft.contractId,
    contract?.id === draft.contractId ? contractLabel(contract) : "",
  );
  const engineerOptions = withCurrent(
    members
      .filter((member) => member.role === "engineer" || member.id === draft.assignedTo)
      .map((member) => ({ value: member.id, label: memberDisplayName(member) })),
    draft.assignedTo,
    memberName(draft.assignedTo),
  );
  const defaultStatus = statuses.find((item) => item.is_default);
  const clientLocked = Boolean(lockedClientId);

  const activityId = workOrder?.source_activity_id ?? sourceActivityId ?? null;

  const allFields: KvField[] = [
    {
      key: "statusId",
      label: "Status",
      // Never edited by hand (issue #222): status moves only through the
      // workflow (planning, PWA checkout/finish, Approve), so in edit and
      // new mode it is a grey derived row.
      kind: "derived",
      read: isNew
        ? (defaultStatus?.label ?? "New")
        : savedStatus
          ? <StatusText tone={toneFromColor(savedStatusColor)}>{savedStatus}</StatusText>
          : null,
      note: "Changes through the workflow",
    },
    {
      key: "priorityId",
      label: "Priority",
      kind: "select",
      read: savedPriority || null,
      options: refOptions(priorities),
      emptyLabel: "No priority",
    },
    {
      key: "typeId",
      label: "Type",
      kind: "select",
      read: savedType || null,
      options: refOptions(types),
      emptyLabel: "No type",
    },
    {
      key: "durationMinutes",
      label: "Duration (minutes)",
      kind: "number",
      min: "0",
      step: "1",
      read: saved.durationMinutes ? `${saved.durationMinutes} min` : null,
      placeholder: "e.g. 60",
    },
    { key: "externalReference", label: "External reference", read: saved.externalReference },
    {
      key: "sourceActivity",
      label: "From activity",
      kind: "derived",
      read: activityId ? <Link href={`/activities/${activityId}`}>View activity</Link> : null,
    },
    {
      key: "clientId",
      label: "Client",
      kind: "select",
      read: savedClient ? <Link href={`/clients/${savedClient.id}`}>{savedClient.name}</Link> : null,
      options: clientOptions,
      emptyLabel: "Select a client…",
      disabled: clientLocked,
      disabledNote: clientLocked ? "Set by the client you came from" : undefined,
    },
    {
      key: "siteId",
      label: "Site",
      kind: "select",
      read: savedSite ? (formatSiteAddressShort(savedSite) ?? "Unnamed site") : null,
      options: siteOptions,
      emptyLabel: clientScoped.loadingSites ? "Loading sites…" : "No specific site",
      disabled: !draft.clientId,
      disabledNote: "Choose a client first",
    },
    {
      key: "assetId",
      label: "Asset",
      kind: "select",
      read: savedAsset ? <Link href={`/assets/${savedAsset.id}`}>{savedAsset.name}</Link> : null,
      options: assetOptions,
      emptyLabel: clientScoped.loadingAssets ? "Loading assets…" : "No specific asset",
      disabled: !draft.siteId,
      disabledNote: draft.clientId ? "Choose a site first" : "Choose a client first",
    },
    {
      key: "contractId",
      label: "Contract",
      kind: "select",
      read: savedContract ? <Link href={`/contracts/${savedContract.id}`}>{contractLabel(savedContract)}</Link> : null,
      options: contractOptions,
      emptyLabel: clientScoped.loadingContracts ? "Loading contracts…" : "No contract",
      disabled: !draft.clientId,
      disabledNote: "Choose a client first",
    },
    {
      key: "assignedTo",
      label: "Assigned to",
      kind: "select",
      read: saved.assignedTo ? memberName(saved.assignedTo) || null : null,
      options: engineerOptions,
      emptyLabel: "Unassigned",
      disabledNote: undefined,
    },
    {
      key: "scheduledAt",
      label: "Scheduled for",
      kind: "datetime",
      // The ISO instant straight from the record (not the local draft string)
      // so server and browser render the same text.
      read: workOrder?.scheduled_at ? formatDateTimeWeb(workOrder.scheduled_at) : null,
    },
  ];

  // Contracts module off: the Contract field does not exist (#247).
  const fields = contractsEnabled ? allFields : allFields.filter((field) => field.key !== "contractId");

  return (
    <WebCardStack>
      <KeyValueCard title="Details" columns={2} split={6} fields={fields} edit={binder} />
      {/* Description (the question) next to Solution (the answer from the
          field); on a new work order there is no solution yet, so
          Description takes the full width. */}
      {isNew ? (
        <TextCard
          title="Description"
          fieldKey="description"
          text={saved.description}
          emptyText="No description yet"
          placeholder="What needs to be done"
          edit={edit.isEditing ? binder : undefined}
        />
      ) : (
        <WebCardPair>
          <TextCard
            title="Description"
            fieldKey="description"
            text={saved.description}
            emptyText="No description yet"
            placeholder="What needs to be done"
            edit={edit.isEditing ? binder : undefined}
          />
          <TextCard
            title="Solution"
            fieldKey="solution"
            text={saved.solution}
            emptyText="No solution yet"
            placeholder="How the job was resolved"
            edit={edit.isEditing ? binder : undefined}
          />
        </WebCardPair>
      )}
      {signature && !isNew ? <WorkOrderSignatureCard signature={signature} /> : null}
      <TextCard
        title="Notes"
        fieldKey="notes"
        text={saved.notes}
        emptyText="No notes yet"
        placeholder="Anything worth knowing before the visit"
        edit={edit.isEditing ? binder : undefined}
      />
    </WebCardStack>
  );
}
