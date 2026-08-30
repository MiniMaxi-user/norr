"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge, Breadcrumbs, Card, DetailHero, Stack, Text } from "@yourorg/ui";
import { usePageHeader } from "@/components/shell/page-header-context";
import type { QuoteRecord, QuoteLineItemRecord } from "../actions";
import type { ClientRecord } from "@/app/(app)/clients/actions";
import type { AssetRecord } from "@/app/(app)/assets/actions";
import type { ArticleSelectOption } from "@/app/(app)/articles/actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { formatDate } from "@/lib/format/date";
import { QuoteDetailActions } from "./quote-detail-actions";
import { QuoteLineItemsPanel } from "./quote-line-items-panel";

export interface QuoteDetailProps {
  quote: QuoteRecord;
  client: ClientRecord | null;
  /** Pre-resolved label for `quote.site_id` (`formatSiteAddressShort`),
   * resolved once in `page.tsx` from the client's own `sites` — `null` when
   * the quote isn't tied to a specific site. */
  siteLabel: string | null;
  lineItems: QuoteLineItemRecord[];
  /** Assets belonging to the quote's own client — resolves each line item's
   * optional `asset_id` inline (issue #95 criterion 16: no navigation to
   * `/assets/[id]` needed to pick/view one) and is the picker source in
   * `QuoteLineItemsPanel`. */
  clientAssets: AssetRecord[];
  /** `listArticlesForSelect()`'s result — the line item article
   * search-picker's option source (issue #95). */
  articles: ArticleSelectOption[];
  /** This org's members — resolves a line item's `engineer_user_id` to a
   * display name and is the engineer picker's option source (issue #95). */
  members: OrgMemberRecord[];
  canEdit: boolean;
  canDelete: boolean;
  canCreateLineItems: boolean;
  canEditLineItems: boolean;
  canDeleteLineItems: boolean;
}

/**
 * Quote detail (issue #95 redesign) — same visual weight as the Client/
 * Asset/Work Order/Contract detail pages (docs/ARCHITECTURE.md "Relational
 * detail pages"), re-laid-out around its `quote_line_items` sub-list being
 * the DOMINANT element on the page rather than an afterthought below a big
 * field stack:
 *
 *  - The breadcrumb moved out of the page body into the Topbar
 *    (`usePageHeader`), same mechanism/pattern as
 *    `app/(app)/clients/[id]/client-detail.tsx` (see that file's own doc
 *    comment on the referentially-stable `breadcrumbNode` requirement).
 *  - The old full-width `DetailRow` stack (Client/Site/Valid until/Notes/
 *    Total, each on its own row) is gone. Client/Site/Valid-until now live
 *    compactly in `DetailHero`'s dot-separated `meta` line — the same
 *    "compact relational summary" convention `ClientDetail` already
 *    establishes for its own primary-address meta line — instead of each
 *    taking a full vertical row. Notes, when present, gets one slim `Card`
 *    (omitted entirely otherwise, rather than always reserving the space).
 *  - The status badge moved from a `Stack` (which stretches its children to
 *    fill its own cross-axis width by default, `align-items: stretch` — the
 *    "badge fills the whole row" bug criterion 12 flagged) into
 *    `DetailHero`'s `badges` slot, which lays out inline/row-direction next
 *    to the dot-separated meta text — same fix `WorkOrderScreen`'s own
 *    `DetailHero` usage already gets for free.
 *  - `QuoteLineItemsPanel` below is now a genuinely inline-editable table
 *    (no more `QuoteLineItemDialog` popup — see that panel's own doc
 *    comment) and is the only other thing on this page, so it reads as the
 *    page's main content instead of competing with a large fields Card
 *    above it.
 *
 * No "convert to Work Order/Contract" action here — deliberately out of
 * scope for this pass (see `app/(app)/quotes/actions.ts`'s module comment):
 * the backend conversion logic doesn't exist yet.
 */
export function QuoteDetail({
  quote,
  client,
  siteLabel,
  lineItems,
  clientAssets,
  articles,
  members,
  canEdit,
  canDelete,
  canCreateLineItems,
  canEditLineItems,
  canDeleteLineItems,
}: QuoteDetailProps) {
  const breadcrumbItems = useMemo(
    () => [{ label: "Quotes", href: "/quotes" }, { label: quote.name }],
    [quote.name],
  );
  // The element itself (not just `breadcrumbItems`) must be memoized — see
  // the "MUST be referentially stable" warning on `usePageHeader`'s doc
  // comment, and `client-detail.tsx`'s identical pattern.
  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  const heroMeta = [
    client ? <Link href={`/clients/${client.id}`}>{client.name}</Link> : "Unknown client",
    siteLabel,
    quote.valid_until ? `Valid until ${formatDate(quote.valid_until, { month: "long" })}` : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <Stack gap="lg">
      <DetailHero
        avatarLabel={quote.name}
        title={quote.name}
        meta={heroMeta}
        badges={
          <Badge color={quote.quote_status?.color} variant="muted">
            {quote.quote_status?.label ?? "—"}
          </Badge>
        }
        actions={<QuoteDetailActions quote={quote} canEdit={canEdit} canDelete={canDelete} />}
      />

      {quote.notes && (
        <Card>
          <Stack gap="xs">
            <Text tone="muted">Notes</Text>
            <Text>{quote.notes}</Text>
          </Stack>
        </Card>
      )}

      <QuoteLineItemsPanel
        quoteId={quote.id}
        lineItems={lineItems}
        clientAssets={clientAssets}
        articles={articles}
        members={members}
        canCreate={canCreateLineItems}
        canEdit={canEditLineItems}
        canDelete={canDeleteLineItems}
      />
    </Stack>
  );
}
