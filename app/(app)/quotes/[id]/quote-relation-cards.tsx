"use client";

import Link from "next/link";
import { FormGrid, RelationCard } from "@yourorg/ui";
import { Building2, ClipboardList, MapPin } from "@yourorg/ui/icons";
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
  readOnly?: boolean;
  onEdit?: () => void;
}

/**
 * Client/Site relation cards for the Quote detail page (Pattern A migration,
 * docs/ARCHITECTURE.md "Two detail-page header patterns"), mirroring
 * `app/(app)/work-orders/components/work-order-relation-cards.tsx`'s shape —
 * only two cards, not four: `quotes` has no top-level `asset_id`/
 * `contract_id` column (asset linkage only exists per line item, already
 * rendered inline in `QuoteLineItemsPanel`; there's no per-quote contract
 * relationship at all), so an Asset/Contract card here would either fabricate
 * a relationship that doesn't exist in the schema or arbitrarily pick "the
 * first line item's asset" — neither is a real relation worth surfacing this
 * prominently. A third, optional "Source" card appears only when this quote
 * was created from a work order (`sourceWorkOrder` set) — a genuine relation
 * (issue #109's `quotes.work_order_id` traceability column), not a
 * fabricated one.
 *
 * Both Client and Site share the SAME Edit affordance (`onEdit`, opening
 * `QuoteRelationsDialog`'s Client -> Site cascade) — same "one popup for
 * every card in this row" reasoning `WorkOrderRelationCards` documents,
 * scaled down to the two fields Quotes actually has.
 */
export function QuoteRelationCards({ client, site, sourceWorkOrder, readOnly, onEdit }: QuoteRelationCardsProps) {
  const clientFacts = [client?.kvk_number ? `KvK ${client.kvk_number}` : null, client?.vat_number]
    .filter(Boolean)
    .join(" · ");

  return (
    <FormGrid columns={sourceWorkOrder ? 3 : 2}>
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
    </FormGrid>
  );
}
