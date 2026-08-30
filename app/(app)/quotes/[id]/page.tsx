import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getQuote, listQuoteLineItems } from "../actions";
import { getClient } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { listAssets } from "@/app/(app)/assets/actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { QuoteDetail } from "./quote-detail";

export const metadata = { title: "Quote details" };

interface QuoteDetailPageProps {
  params: Promise<{ id: string }>;
}

/** High enough for "every asset of this quote's client" in one request — a
 * quote detail page is a bounded, per-record view, same reasoning as
 * `ALL_CLIENT_ASSETS_LIMIT` in `app/(app)/contracts/[id]/page.tsx`/
 * `app/(app)/clients/[id]/page.tsx`. */
const ALL_CLIENT_ASSETS_LIMIT = 500;

/**
 * Quote detail page (issue #95 redesign) — data-fetching Server Component
 * only. Rendering (breadcrumb-in-topbar, compact hero, the line items table
 * as the dominant element) lives in `./quote-detail.tsx`, a client component,
 * same Server/Client split `app/(app)/clients/[id]/page.tsx` ->
 * `client-detail.tsx` establishes (`usePageHeader` is a client-side hook, so
 * whatever calls it must be a client component).
 *
 * Fetches, in one `Promise.all`:
 *  - the quote's own client + its sites (for the compact Client/Site summary
 *    in the hero's meta line);
 *  - the quote's line items (embedding each one's linked article — see
 *    `QUOTE_LINE_ITEM_SELECT` in `../actions.ts`);
 *  - the quote client's own assets (issue #95 criterion 16 — the line item
 *    asset picker must resolve inline, no navigation to `/assets/[id]`);
 *  - this org's members (`listOrgMembers`, issue #95 — resolves a line
 *    item's `engineer_user_id` to a display name/picker options);
 *  - this org's active articles (`listArticlesForSelect`, issue #95 — the
 *    line item article search-picker, with EAN/GTIN/MPN already included in
 *    the projection for `Combobox`'s `keywords` filtering).
 */
export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "quotes"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "quotes")) notFound();

  const quoteResult = await getQuote(id);
  if (!quoteResult.data) notFound();
  const quote = quoteResult.data.quote;

  const [clientResult, lineItemsResult, clientAssetsResult, membersResult, articlesResult] = await Promise.all([
    getClient(quote.client_id),
    listQuoteLineItems(quote.id),
    listAssets({ clientId: quote.client_id, limit: ALL_CLIENT_ASSETS_LIMIT }),
    listOrgMembers(),
    listArticlesForSelect(),
  ]);

  const client = clientResult.data?.client ?? null;
  const sites = clientResult.data?.sites ?? [];
  const siteLabelById = new Map(sites.map((site) => [site.id, formatSiteAddressShort(site)]));
  const siteLabel = quote.site_id ? (siteLabelById.get(quote.site_id) ?? null) : null;
  const lineItems = lineItemsResult.data?.lineItems ?? [];
  const clientAssets = clientAssetsResult.data?.assets ?? [];
  const members = membersResult.data?.members ?? [];
  const articles = articlesResult.data?.articles ?? [];

  const canEdit = can(actor, "quotes", "update");
  const canDelete = can(actor, "quotes", "delete");
  const canCreateLineItems = can(actor, "quotes", "create");
  const canEditLineItems = can(actor, "quotes", "update");
  const canDeleteLineItems = can(actor, "quotes", "delete");

  return (
    <QuoteDetail
      quote={quote}
      client={client}
      siteLabel={siteLabel}
      lineItems={lineItems}
      clientAssets={clientAssets}
      articles={articles}
      members={members}
      canEdit={canEdit}
      canDelete={canDelete}
      canCreateLineItems={canCreateLineItems}
      canEditLineItems={canEditLineItems}
      canDeleteLineItems={canDeleteLineItems}
    />
  );
}
