import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { getQuote, listQuoteLineItems } from "../actions";
import { getInvoiceForQuote } from "../invoice-actions";
import { getContract } from "@/app/(app)/contracts/actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { listAssets } from "@/app/(app)/assets/actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listOrgMembers } from "@/lib/members/actions";
import { getWorkOrder } from "@/app/(app)/work-orders/actions";
import { QuoteScreen, type QuoteDetailTab } from "../components/quote-screen";
import { QUOTE_DETAIL_VIEW_KEY } from "../components/constants";

export const metadata = { title: "Quote details" };

interface QuoteDetailPageProps {
  params: Promise<{ id: string }>;
  /** `?tab=lineItems` deep-links straight to a tab. */
  searchParams: Promise<{ tab?: string }>;
}

/** High enough for "every asset of this quote's client" in one request — a
 * quote detail page is a bounded, per-record view, same reasoning as
 * `ALL_CLIENT_ASSETS_LIMIT` in `app/(app)/contracts/[id]/page.tsx`. */
const ALL_CLIENT_ASSETS_LIMIT = 500;

const TAB_IDS: QuoteDetailTab[] = ["overview", "lineItems"];

/**
 * Quote detail page — renders the shared `QuoteScreen` (web design system,
 * issue #222) in read mode, with one Edit button for a caller with update
 * rights. Same "fetch once, pass down" convention as every other module's
 * detail page; `hasFeature()`/RBAC are resolved before anything renders.
 *
 * Invoicing (issue #119): owner/administratie-only and only when the
 * `invoicing` feature is entitled — folded into `canInvoice` here so the
 * screen never reasons about entitlement itself; `getInvoiceForQuote` is only
 * called when the caller can read invoices. The Contract relation is only
 * resolved when the caller may read contracts; the source work order
 * (`quote.work_order_id`, issue #109) is `null` when the caller cannot read
 * planning (`getWorkOrder` has its own gate).
 */
export default async function QuoteDetailPage({ params, searchParams }: QuoteDetailPageProps) {
  const { id } = await params;
  const { tab: requestedTab } = await searchParams;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "quotes"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "quotes")) notFound();

  const quoteResult = await getQuote(id);
  if (!quoteResult.data) notFound();
  const quote = quoteResult.data.quote;

  const invoicingEnabled = await hasFeature(session.organization, "invoicing");
  const canReadInvoice = invoicingEnabled && canAccessModule(actor, "invoicing") && can(actor, "invoicing", "read");
  const canInvoice = invoicingEnabled && canAccessModule(actor, "invoicing") && can(actor, "invoicing", "create");
  const canReadContract =
    (await hasFeature(session.organization, "contracts")) && canAccessModule(actor, "contracts");

  const [
    clientResult,
    clientsResult,
    lineItemsResult,
    clientAssetsResult,
    membersResult,
    articlesResult,
    workOrderResult,
    invoiceResult,
    contractResult,
    statusesResult,
    lastUsedTab,
  ] = await Promise.all([
    getClient(quote.client_id),
    listClients({ limit: 200 }),
    listQuoteLineItems(quote.id),
    listAssets({ clientId: quote.client_id, limit: ALL_CLIENT_ASSETS_LIMIT }),
    listOrgMembers(),
    listArticlesForSelect(),
    quote.work_order_id ? getWorkOrder(quote.work_order_id) : Promise.resolve(null),
    canReadInvoice ? getInvoiceForQuote(quote.id) : Promise.resolve(null),
    quote.contract_id && canReadContract ? getContract(quote.contract_id) : Promise.resolve(null),
    listReferenceItems("quote_status"),
    preferencesStore.getLastUsedView(session.userId, QUOTE_DETAIL_VIEW_KEY),
  ]);

  const available = (raw: string | null | undefined): QuoteDetailTab | null =>
    raw && TAB_IDS.includes(raw as QuoteDetailTab) ? (raw as QuoteDetailTab) : null;

  return (
    <QuoteScreen
      mode="edit"
      quote={quote}
      client={clientResult.data?.client ?? null}
      clients={clientsResult.data?.clients ?? []}
      statuses={statusesResult.data?.items ?? []}
      canCreate={can(actor, "quotes", "create")}
      canUpdate={can(actor, "quotes", "update")}
      canDelete={can(actor, "quotes", "delete")}
      lineItems={lineItemsResult.data?.lineItems ?? []}
      clientAssets={clientAssetsResult.data?.assets ?? []}
      articles={articlesResult.data?.articles ?? []}
      members={membersResult.data?.members ?? []}
      sourceWorkOrder={workOrderResult?.data?.workOrder ?? null}
      contract={contractResult?.data?.contract ?? null}
      invoice={invoiceResult?.data?.invoice ?? null}
      canInvoice={canInvoice}
      defaultTab={available(requestedTab) ?? available(lastUsedTab) ?? "overview"}
    />
  );
}
