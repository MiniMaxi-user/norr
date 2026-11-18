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
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { ContactRecord } from "@/app/(app)/clients/contacts-actions";
import type { AssetContractCoverage, ContractRecord } from "@/app/(app)/contracts/actions";
import { contractLabel } from "@/lib/format/contract-label";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { ActivityRecord } from "../actions";
import { findActivitySubtype, topActivitySubtypeAncestorId, type FlattenedActivitySubtype } from "../subtype-tree";
import type { FlattenedSolutionSubtype } from "../solution-subtype-tree";
import type { ActivityDraft } from "./activity-draft";
import { ASSET_REQUIRED_TYPE_VALUES } from "./activity-form-schema";
import { useActivityContractCoverage } from "./use-activity-contract-coverage";

export interface ActivityClientScoped {
  assets: AssetRecord[];
  contacts: ContactRecord[];
  contracts: ContractRecord[];
  loadingAssets: boolean;
  loadingContacts: boolean;
  loadingContracts: boolean;
}

export interface ActivityOverviewCardsProps {
  edit: EditModeApi<ActivityDraft>;
  activity?: ActivityRecord;
  client: ClientRecord | null;
  asset: AssetRecord | null;
  clients: ClientRecord[];
  clientScoped: ActivityClientScoped;
  activityTypes: ReferenceListItemRecord[];
  activityStatuses: ReferenceListItemRecord[];
  activitySubtypes: FlattenedActivitySubtype[];
  solutionSubtypes: FlattenedSolutionSubtype[];
  members: OrgMemberRecord[];
  /** `false` = an engineer: Action holder is pinned to themselves. */
  canAssignOthers: boolean;
  lockedClientId?: string;
  lockedAssetId?: string;
  isNew: boolean;
}

/**
 * The Overview tab's cards (design system, issue #222): ONE two-column
 * "Details" card — the activity on the left (status, type, activity subtype,
 * solution subtype, action holder), who and where on the right (client, asset,
 * the derived contract, contact person and the contact name/phone/email that
 * only apply to this activity) — then Description next to Solution. Reported
 * at/by and the age live in the rail. No related lists: notes and work orders
 * have their own tabs.
 *
 * Cascades: Activity subtype is disabled until a type is chosen, lists only the
 * branches of that type and is cleared when the type changes to another one.
 * Asset and Contact person are disabled until a client is chosen, and a client
 * change clears both. Picking a contact person copies its name/phone/email into
 * the override fields once (they stay independently editable).
 */
export function ActivityOverviewCards({
  edit,
  activity,
  client,
  asset,
  clients,
  clientScoped,
  activityTypes,
  activityStatuses,
  activitySubtypes,
  solutionSubtypes,
  members,
  canAssignOthers,
  lockedClientId,
  lockedAssetId,
  isNew,
}: ActivityOverviewCardsProps) {
  const saved = edit.record;
  const draft = edit.draft;

  const binder = useMemo<KvEditBinder>(
    () => ({
      get isEditing() {
        return edit.isEditing;
      },
      getField: (key: string) => {
        const binding = edit.getField(key as keyof ActivityDraft & string);
        if (key === "typeId") {
          return {
            ...binding,
            onChange: (value) => {
              binding.onChange(value);
              const current = edit.draft.activitySubtypeId;
              if (current) {
                const root = findActivitySubtype(activitySubtypes, topActivitySubtypeAncestorId(activitySubtypes, current));
                if (!root || root.typeId !== value) edit.setValue("activitySubtypeId", "");
              }
            },
          };
        }
        if (key === "clientId") {
          return {
            ...binding,
            onChange: (value) => {
              binding.onChange(value);
              edit.setValue("assetId", "");
              edit.setValue("contactPersonId", "");
            },
          };
        }
        if (key === "contactPersonId") {
          return {
            ...binding,
            onChange: (value) => {
              binding.onChange(value);
              const contact = typeof value === "string" ? clientScoped.contacts.find((item) => item.id === value) : undefined;
              if (!contact) return;
              // One-time copy — never synced back to the contact.
              edit.setValue("contactName", contact.name);
              edit.setValue("contactPhone", contact.phone ?? "");
              edit.setValue("contactEmail", contact.email ?? "");
            },
          };
        }
        return binding;
      },
      countsFor: (keys) => edit.countsFor(keys),
    }),
    [edit, activitySubtypes, clientScoped.contacts],
  );

  // ---- Read values ----------------------------------------------------------
  const labelOf = (items: ReferenceListItemRecord[], id: string, fallback?: string | null) =>
    items.find((item) => item.id === id)?.label ?? fallback ?? "";
  const memberName = (id: string, fallback?: Parameters<typeof memberDisplayName>[0]) => {
    const member = members.find((item) => item.id === id);
    return member ? memberDisplayName(member) : fallback ? memberDisplayName(fallback) : "";
  };

  const statusItem = activityStatuses.find((item) => item.id === saved.statusId);
  const statusLabel = statusItem?.label ?? (saved.statusId === activity?.status_id ? activity?.activity_status?.label : "") ?? "";
  const typeLabel = labelOf(activityTypes, saved.typeId, saved.typeId === activity?.type_id ? activity?.activity_type?.label : null);
  const typeValue = activityTypes.find((item) => item.id === draft.typeId)?.value ?? "";
  const assetRequired = ASSET_REQUIRED_TYPE_VALUES.includes(typeValue);

  const savedClient = clients.find((item) => item.id === saved.clientId) ?? (client?.id === saved.clientId ? client : null);
  const savedAsset = saved.assetId
    ? (clientScoped.assets.find((item) => item.id === saved.assetId) ?? (asset?.id === saved.assetId ? asset : null))
    : null;
  const savedContact = saved.contactPersonId
    ? (clientScoped.contacts.find((item) => item.id === saved.contactPersonId)?.name ??
      (activity?.contact_person?.id === saved.contactPersonId ? activity.contact_person.name : ""))
    : "";

  const savedActivitySubtype = findActivitySubtype(activitySubtypes, saved.activitySubtypeId)?.path ??
    (saved.activitySubtypeId === activity?.activity_subtype_id ? activity?.activity_subtype?.name : "");
  const savedSolutionSubtype = solutionSubtypes.find((item) => item.id === saved.solutionSubtypeId)?.path ??
    (saved.solutionSubtypeId === activity?.solution_subtype_id ? activity?.solution_subtype?.name : "");

  // ---- Derived contract ------------------------------------------------------
  // Never stored: whichever contract(s) cover the linked asset (direct or
  // inherited through its composite tree), else the client's own contracts.
  const coverage = useActivityContractCoverage(draft.assetId || undefined);
  const [firstCoverage, ...restCoverage] = draft.assetId
    ? coverage.coverage
    : draft.clientId
      ? clientScoped.contracts.map((contract): AssetContractCoverage => ({ contract, source: { type: "direct" } }))
      : [];
  const contractLoading = Boolean(draft.assetId) && coverage.loading && !firstCoverage;
  const contractRead = contractLoading ? (
    "Loading…"
  ) : firstCoverage ? (
    <>
      <Link href={`/contracts/${firstCoverage.contract.id}`}>{contractLabel(firstCoverage.contract)}</Link>
      {firstCoverage.source.type === "inherited" ? ` · via ${firstCoverage.source.viaAsset.name}` : ""}
      {restCoverage.length > 0 ? ` · +${restCoverage.length} more` : ""}
    </>
  ) : null;

  // ---- Options --------------------------------------------------------------
  const withCurrent = (options: KvOption[], id: string, label: string): KvOption[] =>
    id && label && !options.some((option) => option.value === id) ? [{ value: id, label }, ...options] : options;
  const refOptions = (items: ReferenceListItemRecord[], currentId: string) =>
    items
      .filter((item) => item.is_active !== false || item.id === currentId)
      .map((item) => ({ value: item.id, label: item.label }));

  const clientOptions = withCurrent(
    clients.map((item) => ({ value: item.id, label: item.name })),
    draft.clientId,
    client?.id === draft.clientId ? client.name : "",
  );
  const assetOptions = withCurrent(
    clientScoped.assets.map((item) => ({ value: item.id, label: item.name })),
    draft.assetId,
    asset?.id === draft.assetId ? asset.name : (activity?.asset?.id === draft.assetId ? activity.asset.name : ""),
  );
  const contactOptions = withCurrent(
    clientScoped.contacts.map((item) => ({ value: item.id, label: item.name })),
    draft.contactPersonId,
    activity?.contact_person?.id === draft.contactPersonId ? (activity.contact_person?.name ?? "") : "",
  );
  const activitySubtypeOptions = useMemo<KvOption[]>(() => {
    if (!draft.typeId) return [];
    return activitySubtypes
      .filter((node) => findActivitySubtype(activitySubtypes, topActivitySubtypeAncestorId(activitySubtypes, node.id))?.typeId === draft.typeId)
      .map((node) => ({ value: node.id, label: node.path }));
  }, [activitySubtypes, draft.typeId]);
  const solutionSubtypeOptions = solutionSubtypes.map((node) => ({ value: node.id, label: node.path }));
  const memberOptions = withCurrent(
    members.map((member) => ({ value: member.id, label: memberDisplayName(member) })),
    draft.actionHolderId,
    memberName(draft.actionHolderId, activity?.action_holder),
  );

  const defaultStatus = activityStatuses.find((item) => item.is_default);
  const clientLocked = Boolean(lockedClientId) || Boolean(lockedAssetId);
  const actionHolderName = memberName(saved.actionHolderId, activity?.action_holder);

  const left: KvField[] = [
    isNew
      ? {
          key: "statusId",
          label: "Status",
          // The database fills in the org's default status on insert.
          kind: "derived",
          read: defaultStatus?.label ?? "Open",
          note: "Starts with the default status",
        }
      : {
          key: "statusId",
          label: "Status",
          kind: "select",
          read: statusLabel ? <StatusText tone={toneFromColor(statusItem?.color ?? activity?.activity_status?.color)}>{statusLabel}</StatusText> : null,
          options: refOptions(activityStatuses, draft.statusId),
          emptyLabel: "Select a status…",
        },
    {
      key: "typeId",
      label: "Type",
      kind: "select",
      read: typeLabel || null,
      options: refOptions(activityTypes, draft.typeId),
      emptyLabel: "Select a type…",
    },
    {
      key: "activitySubtypeId",
      label: "Activity subtype",
      kind: "select",
      read: savedActivitySubtype || null,
      options: withCurrent(
        activitySubtypeOptions,
        draft.activitySubtypeId,
        draft.activitySubtypeId === activity?.activity_subtype_id ? (activity?.activity_subtype?.name ?? "") : "",
      ),
      emptyLabel: draft.typeId && activitySubtypeOptions.length === 0 ? "No subtypes for this type" : "No subtype",
      disabled: !draft.typeId,
      disabledNote: "Choose a type first",
    },
    ...(isNew
      ? []
      : [
          {
            key: "solutionSubtypeId",
            label: "Solution subtype",
            kind: "select" as const,
            read: savedSolutionSubtype || null,
            options: withCurrent(
              solutionSubtypeOptions,
              draft.solutionSubtypeId,
              draft.solutionSubtypeId === activity?.solution_subtype_id ? (activity?.solution_subtype?.name ?? "") : "",
            ),
            emptyLabel: "No solution subtype",
          },
        ]),
    canAssignOthers
      ? {
          key: "actionHolderId",
          label: "Action holder",
          kind: "select",
          read: actionHolderName || null,
          options: memberOptions,
          emptyLabel: "Unassigned",
        }
      : {
          key: "actionHolderId",
          label: "Action holder",
          kind: "derived",
          read: actionHolderName || "You",
          note: "Always assigned to you",
        },
  ];

  const right: KvField[] = [
    {
      key: "clientId",
      label: "Client",
      kind: "select",
      read: savedClient ? <Link href={`/clients/${savedClient.id}`}>{savedClient.name}</Link> : null,
      options: clientOptions,
      emptyLabel: "Select a client…",
      disabled: clientLocked,
      disabledNote: lockedAssetId ? "Set by the asset you came from" : clientLocked ? "Set by the client you came from" : undefined,
    },
    {
      key: "assetId",
      label: "Asset",
      kind: "select",
      read: savedAsset ? <Link href={`/assets/${savedAsset.id}`}>{savedAsset.name}</Link> : null,
      options: assetOptions,
      emptyLabel: clientScoped.loadingAssets
        ? "Loading assets…"
        : assetRequired
          ? "Select an asset (required for this type)"
          : "No specific asset",
      disabled: !draft.clientId || Boolean(lockedAssetId),
      disabledNote: lockedAssetId ? "Set by the asset you came from" : "Choose a client first",
    },
    {
      key: "contract",
      label: "Contract",
      kind: "derived",
      read: contractRead,
      note: "Follows the asset (or the client)",
    },
    {
      key: "contactPersonId",
      label: "Contact person",
      kind: "select",
      read: savedContact || null,
      options: contactOptions,
      emptyLabel: clientScoped.loadingContacts ? "Loading contacts…" : "No contact person",
      disabled: !draft.clientId,
      disabledNote: "Choose a client first",
    },
    {
      key: "contactName",
      label: "Contact name",
      read: saved.contactName,
      maxLength: 200,
      placeholder: "Only applies to this activity",
    },
    { key: "contactPhone", label: "Contact phone", read: saved.contactPhone, maxLength: 50, autoComplete: "off" },
    { key: "contactEmail", label: "Contact email", read: saved.contactEmail, maxLength: 320, autoComplete: "off" },
  ];

  return (
    <WebCardStack>
      <KeyValueCard title="Details" columns={2} split={left.length} fields={[...left, ...right]} edit={binder} />
      {isNew ? (
        <TextCard
          title="Description"
          fieldKey="description"
          text={saved.description}
          emptyText="No description yet"
          placeholder="What is going on"
          edit={edit.isEditing ? binder : undefined}
        />
      ) : (
        <WebCardPair>
          <TextCard
            title="Description"
            fieldKey="description"
            text={saved.description}
            emptyText="No description yet"
            placeholder="What is going on"
            edit={edit.isEditing ? binder : undefined}
          />
          <TextCard
            title="Solution"
            fieldKey="solution"
            text={saved.solution}
            emptyText="No solution yet"
            placeholder="How it was resolved"
            edit={edit.isEditing ? binder : undefined}
          />
        </WebCardPair>
      )}
    </WebCardStack>
  );
}
