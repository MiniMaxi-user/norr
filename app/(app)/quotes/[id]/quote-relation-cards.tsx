"use client";

import Link from "next/link";
import { FormGrid, RelationCard } from "@yourorg/ui";
import { Building2, ClipboardList, FileText, MapPin } from "@yourorg/ui/icons";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { ClientRecord, SiteRecord } from "@/app/(app)/clients/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";

export interface QuoteRelationCardsProps {
  client: ClientRecord | null;
  site: SiteRecord | null;
  /** Only set when `quote.work_order_id` is set — the work order this quote
   * was created from (a manual "Create Quote" or an auto-draft, issue #109),
   * `null` for a from-scratch quote. */
  sourceWorkOrder: WorkOrderRecord | null;
  /** Issue #210 - the contract a `contract` quote was generated for, `null`
   * for default quotes (or when the caller can't read contracts). */
  contract?: ContractRecord | null;
  /** Pre-formatted invoiced period of a contract quote, shown as the card subtitle. */
  contractPeriod?: string | null;
  readOnly?: boolean;
  onEdit?: () => void;
}

/**
 * Client/Site relation cards for the Quote detail page (Pattern A migration,
 * docs/ARCHITECTURE.md "Two detail-page header patterns"), mirroring
 * `app/(app)/work-orders/components/work-order-relation-cards.tsx`'s shape —
 * Client and Site always; no Asset card (asset linkage only exists per line
 * item, rendered inline in `QuoteLineItemsPanel`). Optional extra cards, each
 * a genuine schema relation: "Source" when this quote was created from a work
 * order (`sourceWorkOrder`, issue #109's `quotes.work_order_id`), and
 * "Contract" for contract quotes (`contract`, issue #210's
 * `quotes.contract_id`) with the invoiced period as its subtitle.
 *
 * Both Client and Site share the SAME Edit affordance (`onEdit`, opening
 * `QuoteRelationsDialog`'s Client -> Site cascade) — same "one popup for
 * every card in this row" reasoning `WorkOrderRelationCards` documents,
 * scaled down to the two fields Quotes actually has.
 */
export function QuoteRelationCards({
  client,
  site,
  sourceWorkOrder,
  contract,
  contractPeriod,
  readOnly,
  onEdit,
}: QuoteRelationCardsProps) {
  const clientFacts = [client?.kvk_number ? `KvK ${client.kvk_number}` : null, client?.vat_number]
    .filter(Boolean)
    .join(" · ");

  return (
    <FormGrid columns={2 + (sourceWorkOrder ? 1 : 0) + (contract ? 1 : 0) === 2 ? 2 : 3}>
      <RelationCard
        icon={Building2}
        label="Client"
        title={client ? <Link href={`/clients/${client.id}`}>{client.name}</Link> : undefined}
        subtitle={clientFacts || undefined}
        emptyText="Unknown client"
        onEdit={readOnly ? undefined : onEdit}
      />
      <RelationCard
        icon={MapPin}
        label="Site"
        // Plain text, no link — a site has no detail page of its own (same
        // as `WorkOrderRelationCards`' Site card, see `RelationCard`'s own
        // doc comment on the `title` prop).
        title={site ? (formatSiteAddressShort(site) ?? "Unnamed site") : undefined}
        subtitle={site?.is_primary ? "Primary" : undefined}
        emptyText="No specific site"
        onEdit={readOnly ? undefined : onEdit}
      />
      {sourceWorkOrder && (
        <RelationCard
          icon={ClipboardList}
          label="Source"
          title={<Link href={`/work-orders/${sourceWorkOrder.id}`}>{sourceWorkOrder.title}</Link>}
          subtitle={sourceWorkOrder.work_order_status?.label ?? undefined}
        />
      )}
      {contract && (
        <RelationCard
          icon={FileText}
          label="Contract"
          title={<Link href={`/contracts/${contract.id}`}>{contract.name}</Link>}
          subtitle={contractPeriod ? `Period ${contractPeriod}` : undefined}
        />
      )}
    </FormGrid>
  );
}
