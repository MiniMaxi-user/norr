import { notFound } from "next/navigation";
import { Breadcrumbs, Heading, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { QuoteForm } from "../components/quote-form";

export const metadata = { title: "New quote" };

interface NewQuotePageProps {
  searchParams: Promise<{ clientId?: string }>;
}

/**
 * Full-page quote create form (docs/ARCHITECTURE.md "Popup vs. full page —
 * pick by weight, not habit" — Quotes is a top-level module entity, same
 * tier as Clients/Assets/Work Orders/Contracts).
 *
 * In-context pre-scoping: arriving with `?clientId=...` (a future
 * client-scoped "New quote" entry point) locks the client picker, mirroring
 * `app/(app)/contracts/new/page.tsx`'s `lockedClientId` handling exactly.
 *
 * Gated on `can(actor, "quotes", "create")` — owner/planner only, matching
 * `createQuote`'s own RBAC check (and the RLS INSERT policy) exactly, so an
 * engineer/finance/administratie never sees this route resolve at all.
 */
export default async function NewQuotePage({ searchParams }: NewQuotePageProps) {
  const { clientId } = await searchParams;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "quotes"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "quotes")) notFound();
  if (!can(actor, "quotes", "create")) notFound();

  const [clientsResult, lockedClientResult, statusesResult] = await Promise.all([
    clientId ? Promise.resolve(null) : listClients({ limit: 200 }),
    clientId ? getClient(clientId) : Promise.resolve(null),
    listReferenceItems("quote_status"),
  ]);

  if (clientId && !lockedClientResult?.data) notFound();

  const clients = clientsResult?.data?.clients ?? [];
  const lockedClient = lockedClientResult?.data?.client ?? null;
  const statuses = statusesResult.data?.items ?? [];

  const breadcrumbItems = lockedClient
    ? [
        { label: "Clients", href: "/clients" },
        { label: lockedClient.name, href: `/clients/${lockedClient.id}` },
        { label: "New quote" },
      ]
    : [{ label: "Quotes", href: "/quotes" }, { label: "New quote" }];

  const cancelHref = lockedClient ? `/clients/${lockedClient.id}` : "/quotes";

  return (
    <Stack gap="lg">
      <Breadcrumbs items={breadcrumbItems} />
      <Heading level={1}>New quote</Heading>
      <QuoteForm
        mode="create"
        clients={clients}
        lockedClientId={lockedClient?.id}
        statuses={statuses}
        cancelHref={cancelHref}
      />
    </Stack>
  );
}
