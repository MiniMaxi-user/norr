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
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { formatDateWeb, formatMoneyWeb } from "@/lib/format/web";
import type { ContractRecord } from "../actions";
import type { ContractDraft } from "./contract-draft";

export interface ContractReferenceLists {
  contractTypes: ReferenceListItemRecord[];
  slaTiers: ReferenceListItemRecord[];
  billingTerms: ReferenceListItemRecord[];
  billingPeriods: ReferenceListItemRecord[];
}

export interface ContractOverviewCardsProps {
  edit: EditModeApi<ContractDraft>;
  contract?: ContractRecord;
  /** The contract's client (read mode) or the locked client (new mode). */
  client: ClientRecord | null;
  /** Clients to choose from (new mode without a locked client). */
  clients: ClientRecord[];
  lists: ContractReferenceLists;
  lockedClientId?: string;
  isNew: boolean;
}

/**
 * The Overview tab's cards (design system, issue #222): ONE two-column
 * "Details" card — identity on the left (contract number, external reference,
 * client, type, SLA tier), terms on the right (start, end, auto-renews,
 * billing terms, billing period, value) — and Notes. Replaces the Terms,
 * Billing, Dates and Notes sections with their own pencils and Save buttons:
 * everything is edited from the page header's single Edit button.
 *
 * SLA tier is a dependent list of the contract type (`parent_list_key =
 * 'contract_type'`): disabled with an explanation until a type is chosen,
 * only that type's tiers are offered, and it is cleared when the type changes.
 * The client is fixed at creation (issue #217), so on an existing contract it
 * is a grey derived row.
 */
export function ContractOverviewCards({
  edit,
  contract,
  client,
  clients,
  lists,
  lockedClientId,
  isNew,
}: ContractOverviewCardsProps) {
  const saved = edit.record;
  const draft = edit.draft;
  const editing = edit.isEditing;

  const binder = useMemo<KvEditBinder>(
    () => ({
      get isEditing() {
        return edit.isEditing;
      },
      getField: (key: string) => {
        const binding = edit.getField(key as keyof ContractDraft & string);
        if (key === "typeId") {
          return {
            ...binding,
            onChange: (value) => {
              binding.onChange(value);
              const current = lists.slaTiers.find((item) => item.id === edit.draft.slaTierId);
              if (current && current.parent_item_id !== value) edit.setValue("slaTierId", "");
            },
          };
        }
        return binding;
      },
      countsFor: (keys) => edit.countsFor(keys),
    }),
    [edit, lists.slaTiers],
  );

  const labelOf = (items: ReferenceListItemRecord[], id: string, fallback?: string | null) =>
    items.find((item) => item.id === id)?.label ?? fallback ?? "";
  const withCurrent = (options: KvOption[], id: string, label: string): KvOption[] =>
    id && label && !options.some((option) => option.value === id) ? [{ value: id, label }, ...options] : options;

  const savedType = labelOf(
    lists.contractTypes,
    saved.typeId,
    saved.typeId === contract?.type_id ? contract?.contract_type?.label : null,
  );
  const savedSla = labelOf(
    lists.slaTiers,
    saved.slaTierId,
    saved.slaTierId === contract?.sla_tier_id ? contract?.sla_tier?.label : null,
  );
  const savedTerms = labelOf(
    lists.billingTerms,
    saved.billingTermsId,
    saved.billingTermsId === contract?.billing_terms_id ? contract?.billing_terms?.label : null,
  );
  const savedPeriod = labelOf(
    lists.billingPeriods,
    saved.billingPeriodId,
    saved.billingPeriodId === contract?.billing_period_id ? contract?.billing_period?.label : null,
  );
  const savedClient =
    clients.find((item) => item.id === saved.clientId) ?? (client?.id === saved.clientId ? client : null);

  const typeOptions = withCurrent(
    lists.contractTypes.map((item) => ({ value: item.id, label: item.label })),
    draft.typeId,
    savedType,
  );
  const slaOptions = withCurrent(
    lists.slaTiers
      .filter((item) => item.parent_item_id === draft.typeId)
      .map((item) => ({ value: item.id, label: item.label })),
    draft.slaTierId,
    savedSla,
  );
  const clientOptions = withCurrent(
    clients.map((item) => ({ value: item.id, label: item.name })),
    draft.clientId,
    client?.id === draft.clientId ? client.name : "",
  );
  const termsOptions = lists.billingTerms.map((item) => ({ value: item.id, label: item.label }));
  const periodOptions = lists.billingPeriods.map((item) => ({ value: item.id, label: item.label }));

  const clientLink = savedClient ? <Link href={`/clients/${savedClient.id}`}>{savedClient.name}</Link> : null;
  const clientField: KvField =
    isNew && !lockedClientId
      ? {
          key: "clientId",
          label: "Client",
          kind: "select",
          read: clientLink,
          options: clientOptions,
          emptyLabel: "Select a client…",
        }
      : {
          // Fixed at creation (issue #217): grey and derived, never an input.
          key: "clientId",
          label: "Client",
          kind: "derived",
          read: clientLink,
          note: isNew ? "Set by the client you came from" : "Fixed when the contract is created",
        };

  const fields: KvField[] = [
    {
      key: "contractNumber",
      label: "Contract number",
      kind: "derived",
      mono: true,
      read: isNew ? "Assigned when saved" : contract?.contract_number,
      note: "Numbered automatically",
    },
    {
      key: "externalReference",
      label: "External reference",
      read: saved.externalReference,
      placeholder: "Shown on invoices",
      maxLength: 200,
    },
    clientField,
    {
      key: "typeId",
      label: "Type",
      kind: "select",
      read: savedType || null,
      options: typeOptions,
      emptyLabel: "Select a type…",
    },
    {
      key: "slaTierId",
      label: "SLA tier",
      kind: "select",
      read: savedSla || null,
      options: slaOptions,
      emptyLabel: "No SLA tier",
      disabled: !draft.typeId,
      disabledNote: "Choose a type first",
    },
    { key: "startDate", label: "Start date", kind: "date", read: saved.startDate ? formatDateWeb(saved.startDate) : null },
    {
      key: "endDate",
      label: "End date",
      kind: "date",
      read: saved.endDate ? formatDateWeb(saved.endDate) : "Open-ended",
    },
    {
      key: "autoRenew",
      label: "Auto-renews",
      kind: "checkbox",
      checkboxLabel: "Renews automatically at the end date",
      read: saved.autoRenew ? "Yes" : "No",
    },
    {
      key: "billingTermsId",
      label: "Billing terms",
      kind: "select",
      read: savedTerms || null,
      options: termsOptions,
      emptyLabel: "No billing terms",
    },
    {
      key: "billingPeriodId",
      label: "Billing period",
      kind: "select",
      read: savedPeriod || null,
      options: periodOptions,
      emptyLabel: "No billing period",
    },
    {
      key: "value",
      label: "Value",
      kind: "money",
      read: saved.value.trim() ? formatMoneyWeb(Number(saved.value)) : null,
      placeholder: "0.00",
    },
  ];

  return (
    <WebCardStack>
      <KeyValueCard title="Details" columns={2} split={5} fields={fields} edit={binder} />
      <TextCard
        title="Notes"
        fieldKey="notes"
        text={saved.notes}
        emptyText="No notes yet"
        placeholder="Anything worth knowing about this contract"
        edit={editing ? binder : undefined}
      />
    </WebCardStack>
  );
}
