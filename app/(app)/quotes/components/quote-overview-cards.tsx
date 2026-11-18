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
} from "@yourorg/ui/web-client";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { contractLabel } from "@/lib/format/contract-label";
import { workOrderLabel } from "@/lib/format/work-order-label";
import { formatDateWeb } from "@/lib/format/web";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { QuoteRecord } from "../actions";
import type { QuoteDraft } from "./quote-draft";

export interface QuoteOverviewCardsProps {
  edit: EditModeApi<QuoteDraft>;
  quote?: QuoteRecord;
  /** The quote's client (read mode) or the locked client (new mode). */
  client: ClientRecord | null;
  /** Clients to choose from. */
  clients: ClientRecord[];
  lockedClientId?: string;
  sourceWorkOrder?: WorkOrderRecord | null;
  contract?: ContractRecord | null;
  statuses: ReferenceListItemRecord[];
  isNew: boolean;
}

/**
 * The Overview tab's cards (design system, issue #222): ONE two-column
 * "Details" card — identity on the left (name, client, source work order,
 * contract), terms on the right (valid until, invoiced period of a contract
 * quote, type) — and Notes. Everything is edited from the page header's single
 * Edit button. Status is the tenant's `quote_status` list (default Draft on new).
 *
 * The client stays changeable on an existing quote (`updateQuote` accepts it);
 * on the new page it is a select, or a grey derived row when the page was
 * opened from a client.
 */
export function QuoteOverviewCards({
  edit,
  quote,
  client,
  clients,
  lockedClientId,
  sourceWorkOrder = null,
  contract = null,
  statuses,
  isNew,
}: QuoteOverviewCardsProps) {
  const saved = edit.record;
  const editing = edit.isEditing;

  const binder = useMemo<KvEditBinder>(
    () => ({
      get isEditing() {
        return edit.isEditing;
      },
      getField: (key: string) => edit.getField(key as keyof QuoteDraft & string),
      countsFor: (keys) => edit.countsFor(keys),
    }),
    [edit],
  );

  const savedClient =
    clients.find((item) => item.id === saved.clientId) ?? (client?.id === saved.clientId ? client : null);
  const clientOptions = useMemo(() => {
    const options = clients.map((item) => ({ value: item.id, label: item.name }));
    if (client && !options.some((option) => option.value === client.id)) {
      options.unshift({ value: client.id, label: client.name });
    }
    return options;
  }, [clients, client]);

  const clientLink = savedClient ? <Link href={`/clients/${savedClient.id}`}>{savedClient.name}</Link> : null;
  const clientField: KvField =
    isNew && lockedClientId
      ? {
          key: "clientId",
          label: "Client",
          kind: "derived",
          read: clientLink,
          note: "Set by the client you came from",
        }
      : {
          key: "clientId",
          label: "Client",
          kind: "select",
          read: clientLink,
          options: clientOptions,
          emptyLabel: "Select a client…",
        };

  const identity: KvField[] = [
    { key: "name", label: "Name", read: saved.name, placeholder: "For example: Maintenance proposal 2027", maxLength: 200 },
    clientField,
  ];
  if (sourceWorkOrder) {
    identity.push({
      key: "sourceWorkOrder",
      label: "Work order",
      kind: "derived",
      mono: true,
      read: <Link href={`/work-orders/${sourceWorkOrder.id}`}>{workOrderLabel(sourceWorkOrder)}</Link>,
      note: "The quote was made from this work order",
    });
  }
  if (contract) {
    identity.push({
      key: "contract",
      label: "Contract",
      kind: "derived",
      read: <Link href={`/contracts/${contract.id}`}>{contractLabel(contract)}</Link>,
      note: "The contract this quote was generated for",
    });
  }

  const defaultStatus = statuses.find((item) => item.is_default);
  const statusOptions = statuses
    .filter((item) => item.is_active !== false || item.id === saved.statusId)
    .map((item) => ({ value: item.id, label: item.label }));
  const savedStatus = statuses.find((item) => item.id === saved.statusId)?.label ?? quote?.quote_status?.label ?? null;

  const terms: KvField[] = [
    {
      key: "statusId",
      label: "Status",
      kind: "select",
      read: savedStatus,
      options: statusOptions,
      emptyLabel: isNew ? (defaultStatus ? `Use default (${defaultStatus.label})` : "Use organization default") : "No status",
    },
    {
      key: "validUntil",
      label: "Valid until",
      kind: "date",
      read: saved.validUntil ? formatDateWeb(saved.validUntil) : null,
    },
  ];
  if (quote?.quote_type === "contract") {
    terms.push({
      key: "period",
      label: "Invoiced period",
      kind: "derived",
      read:
        quote.contract_period_start && quote.contract_period_end
          ? `${formatDateWeb(quote.contract_period_start)} – ${formatDateWeb(quote.contract_period_end)}`
          : null,
      note: "Set when the quote is generated",
    });
  }
  terms.push({
    key: "type",
    label: "Type",
    kind: "derived",
    read: isNew ? "Standard quote" : quote?.quote_type === "contract" ? "Contract quote" : "Standard quote",
    note: "Fixed when the quote is created",
  });

  return (
    <WebCardStack>
      <KeyValueCard
        title="Details"
        columns={2}
        split={identity.length}
        fields={[...identity, ...terms]}
        edit={binder}
      />
      <TextCard
        title="Notes"
        fieldKey="notes"
        text={saved.notes}
        emptyText="No notes yet"
        placeholder="Anything worth knowing about this quote"
        edit={editing ? binder : undefined}
      />
    </WebCardStack>
  );
}
