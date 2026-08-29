import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Breadcrumbs, Card, Heading, Stack, Text, Toolbar } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getQuote, listQuoteLineItems } from "../actions";
import { getClient } from "@/app/(app)/clients/actions";
import { formatSiteAddressShort } from "@/app/(app)/clients/format-site-address";
import { listAssets } from "@/app/(app)/assets/actions";
import { QuoteDetailActions } from "./quote-detail-actions";
import { QuoteLineItemsPanel } from "./quote-line-items-panel";
import { formatDate } from "@/lib/format/date";
import { formatCurrency } from "@/lib/format/currency";

export const metadata = { title: "Quote details" };

interface QuoteDetailPageProps {
  params: Promise<{ id: string }>;
}

/** High enough for "every asset of this quote's client" in one request — a
 * quote detail page is a bounded, per-record view, same reasoning as
 * `ALL_CLIENT_ASSETS_LIMIT` in `app/(app)/contracts/[id]/page.tsx`/
 * `app/(app)/clients/[id]/page.tsx`. */
const ALL_CLIENT_ASSETS_LIMIT = 500;

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Stack gap="xs">
      <Text tone="muted">{label}</Text>
      <Text>{value}</Text>
    </Stack>
  );
}


/**
 * Quote detail page — same visual weight as the Client/Asset/Work Order/
 * Contract detail pages (docs/ARCHITECTURE.md "Relational detail pages").
 * Its `quote_line_items` sub-list is surfaced in-context via
 * `QuoteLineItemsPanel` below the main fields Card — a small editable table,
 * not a separate full page (per "Popup vs. full page": a line item is a
 * small flat record, same weight as Sites/Contacts on a Client).
 *
 * No "convert to Work Order/Contract" action here — deliberately out of
 * scope for this pass (see `app/(app)/quotes/actions.ts`'s module comment):
 * the backend conversion logic doesn't exist yet.
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

  const [clientResult, lineItemsResult, clientAssetsResult] = await Promise.all([
    getClient(quote.client_id),
    listQuoteLineItems(quote.id),
    listAssets({ clientId: quote.client_id, limit: ALL_CLIENT_ASSETS_LIMIT }),
  ]);

  const client = clientResult.data?.client ?? null;
  const sites = clientResult.data?.sites ?? [];
  const siteLabelById = new Map(sites.map((site) => [site.id, formatSiteAddressShort(site)]));
  const lineItems = lineItemsResult.data?.lineItems ?? [];
  const clientAssets = clientAssetsResult.data?.assets ?? [];

  const canEdit = can(actor, "quotes", "update");
  const canDelete = can(actor, "quotes", "delete");
  const canCreateLineItems = can(actor, "quotes", "create");
  const canEditLineItems = can(actor, "quotes", "update");
  const canDeleteLineItems = can(actor, "quotes", "delete");

  return (
    <Stack gap="lg">
      <Breadcrumbs items={[{ label: "Quotes", href: "/quotes" }, { label: quote.name }]} />

      <Toolbar>
        <Toolbar.Section>
          <Stack gap="xs">
            <Heading level={1}>{quote.name}</Heading>
            <Badge color={quote.quote_status?.color} variant="muted">
              {quote.quote_status?.label ?? "—"}
            </Badge>
          </Stack>
        </Toolbar.Section>
        <Toolbar.Section align="end">
          <QuoteDetailActions quote={quote} canEdit={canEdit} canDelete={canDelete} />
        </Toolbar.Section>
      </Toolbar>

      <Card>
        <Stack gap="md">
          <DetailRow
            label="Client"
            value={client ? <Link href={`/clients/${client.id}`}>{client.name}</Link> : "Unknown client"}
          />
          <DetailRow label="Site" value={quote.site_id ? siteLabelById.get(quote.site_id) ?? "—" : "—"} />
          <DetailRow label="Valid until" value={formatDate(quote.valid_until, { month: "long" })} />
          <DetailRow label="Notes" value={quote.notes ?? "—"} />
          <Stack gap="xs">
            <Text tone="muted">Total</Text>
            <Heading level={2}>{formatCurrency(quote.total)}</Heading>
          </Stack>
        </Stack>
      </Card>

      <QuoteLineItemsPanel
        quoteId={quote.id}
        lineItems={lineItems}
        clientAssets={clientAssets}
        canCreate={canCreateLineItems}
        canEdit={canEditLineItems}
        canDelete={canDeleteLineItems}
      />
    </Stack>
  );
}
