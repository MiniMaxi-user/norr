import { notFound } from "next/navigation";
import { Breadcrumbs, Heading, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getQuote } from "../../actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { QuoteForm } from "../../components/quote-form";

export const metadata = { title: "Edit quote" };

interface EditQuotePageProps {
  params: Promise<{ id: string }>;
}

/**
 * Full-page quote edit form (docs/ARCHITECTURE.md "Popup vs. full page").
 * Gated on `can(actor, "quotes", "update")` — owner/planner only, matching
 * `updateQuote`'s own RBAC check (and the RLS UPDATE policy) exactly.
 */
export default async function EditQuotePage({ params }: EditQuotePageProps) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "quotes"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "quotes")) notFound();
  if (!can(actor, "quotes", "update")) notFound();

  const [quoteResult, clientsResult, statusesResult] = await Promise.all([
    getQuote(id),
    listClients({ limit: 200 }),
    listReferenceItems("quote_status"),
  ]);
  if (!quoteResult.data) notFound();
  const quote = quoteResult.data.quote;

  const clients = clientsResult.data?.clients ?? [];
  const statuses = statusesResult.data?.items ?? [];

  const clientResult = await getClient(quote.client_id);
  const client = clientResult.data?.client ?? null;

  const breadcrumbItems = client
    ? [
        { label: "Clients", href: "/clients" },
        { label: client.name, href: `/clients/${client.id}` },
        { label: quote.name, href: `/quotes/${quote.id}` },
        { label: "Edit" },
      ]
    : [
        { label: "Quotes", href: "/quotes" },
        { label: quote.name, href: `/quotes/${quote.id}` },
        { label: "Edit" },
      ];

  return (
    <Stack gap="lg">
      <Breadcrumbs items={breadcrumbItems} />
      <Heading level={1}>Edit {quote.name}</Heading>
      <QuoteForm mode="edit" quote={quote} clients={clients} statuses={statuses} cancelHref={`/quotes/${quote.id}`} />
    </Stack>
  );
}
