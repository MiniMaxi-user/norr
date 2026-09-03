import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getQuote, listQuoteLineItems } from "../actions";
import { getInvoiceForQuote } from "../invoice-actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { listAssets } from "@/app/(app)/assets/actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { getWorkOrder } from "@/app/(app)/work-orders/actions";
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
 * Quote detail page — data-fetching Server Component only. Rendering
 * (breadcrumb-in-topbar, `RecordHeroBand`, relation cards, the line items
 * table) lives in `./quote-detail.tsx`, a client component, same Server/
 * Client split `app/(app)/clients/[id]/page.tsx` -> `client-detail.tsx`
 * establishes (`usePageHeader` is a client-side hook, so whatever calls it
 * must be a client component).
 *
 * *** Pattern A migration (docs/ARCHITECTURE.md "Two detail-page header
 * patterns") *** — Quotes moved off `DetailHero`/`DetailLayout` (Pattern B)
 * onto `RecordHeroBand` + flat sections (Pattern A), the same shape Work
 * Orders/Assets/Contracts already use. This is also why the real `sites`
 * list (not just a pre-resolved label string) and the quote's own linked
 * work order (when it has one, issue #109's `work_order_id` traceability
 * column) are now fetched here: a `RelationCard` needs the real `SiteRecord`/
 * `WorkOrderRecord`, not a formatted string.
 *
 * Fetches, in one `Promise.all`:
 *  - the quote's own client + its sites (client for its own `RelationCard`,
 *    sites resolved against `quote.site_id` for the Site `RelationCard`, and
 *    the full list threaded into `QuoteRelationsDialog`'s own Client -> Site
 *    cascade);
 *  - this org's clients (`listClients`, issue #95 redesign — the relations
 *    dialog's Client `<Select>`, same list `quote-form.tsx` already uses);
 *  - the quote's line items (embedding each one's linked article — see
 *    `QUOTE_LINE_ITEM_SELECT` in `../actions.ts`);
 *  - the quote client's own assets (issue #95 criterion 16 — the line item
 *    asset picker must resolve inline, no navigation to `/assets/[id]`);
 *  - this org's members (`listOrgMembers`, issue #95 — resolves a line
 *    item's `engineer_user_id` to a display name/picker options);
 *  - this org's active articles (`listArticlesForSelect`, issue #95 — the
 *    line item article search-picker, with EAN/GTIN/MPN already included in
 *    the projection for `Combobox`'s `keywords` filtering);
 *  - when `quote.work_order_id` is set, the source work order (`getWorkOrder`,
 *    for the optional "Source" `RelationCard`) — gracefully `null` (no crash,
 *    the card just doesn't render) if the caller can't read `planning` at
 *    all, since `getWorkOrder` has its own independent module/RBAC gate.
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

  // Invoicing (issue #119): owner/administratie-only, and only when the
  // `invoicing` feature is entitled to this org — `hasFeature` +
  // `canAccessModule` are folded into these booleans here so the render
  // side (`quote-detail.tsx` -> `quote-detail-actions.tsx` ->
  // `quote-invoice-actions.tsx`) never has to reason about entitlement
  // itself, same "resolve once in the page, pass a plain boolean down"
  // convention as `canEdit`/`canDelete` below. `getInvoiceForQuote` is only
  // called when the caller can even read invoices, so a role with no
  // invoicing access never triggers (and never sees the result of) that
  // extra query.
  const invoicingEnabled = await hasFeature(session.organization, "invoicing");
  const canReadInvoice = invoicingEnabled && canAccessModule(actor, "invoicing") && can(actor, "invoicing", "read");
  const canGenerateInvoice =
    invoicingEnabled && canAccessModule(actor, "invoicing") && can(actor, "invoicing", "create");
  const canDeleteInvoice =
    invoicingEnabled && canAccessModule(actor, "invoicing") && can(actor, "invoicing", "delete");

  const [
    clientResult,
    clientsResult,
    lineItemsResult,
    clientAssetsResult,
    membersResult,
    articlesResult,
    workOrderResult,
    invoiceResult,
  ] = await Promise.all([
    getClient(quote.client_id),
    listClients({ limit: 200 }),
    listQuoteLineItems(quote.id),
    listAssets({ clientId: quote.client_id, limit: ALL_CLIENT_ASSETS_LIMIT }),
    listOrgMembers(),
    listArticlesForSelect(),
    quote.work_order_id ? getWorkOrder(quote.work_order_id) : Promise.resolve(null),
    canReadInvoice ? getInvoiceForQuote(quote.id) : Promise.resolve(null),
  ]);

  const client = clientResult.data?.client ?? null;
  const sites = clientResult.data?.sites ?? [];
  const site = quote.site_id ? (sites.find((candidate) => candidate.id === quote.site_id) ?? null) : null;
  const clients = clientsResult.data?.clients ?? [];
  const lineItems = lineItemsResult.data?.lineItems ?? [];
  const clientAssets = clientAssetsResult.data?.assets ?? [];
  const members = membersResult.data?.members ?? [];
  const articles = articlesResult.data?.articles ?? [];
  const sourceWorkOrder = workOrderResult?.data?.workOrder ?? null;
  const invoice = invoiceResult?.data?.invoice ?? null;

  const canEdit = can(actor, "quotes", "update");
  const canDelete = can(actor, "quotes", "delete");
  const canCreateLineItems = can(actor, "quotes", "create");
  const canEditLineItems = can(actor, "quotes", "update");
  const canDeleteLineItems = can(actor, "quotes", "delete");

  return (
    <QuoteDetail
      quote={quote}
      client={client}
      site={site}
      clients={clients}
      sourceWorkOrder={sourceWorkOrder}
      lineItems={lineItems}
      clientAssets={clientAssets}
      articles={articles}
      members={members}
      canEdit={canEdit}
      canDelete={canDelete}
      canCreateLineItems={canCreateLineItems}
      canEditLineItems={canEditLineItems}
      canDeleteLineItems={canDeleteLineItems}
      invoice={invoice}
      canGenerateInvoice={canGenerateInvoice}
      canDeleteInvoice={canDeleteInvoice}
    />
  );
}
