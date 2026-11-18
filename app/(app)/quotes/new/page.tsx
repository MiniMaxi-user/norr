import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { QuoteScreen } from "../components/quote-screen";

export const metadata = { title: "New quote" };

interface NewQuotePageProps {
  searchParams: Promise<{ clientId?: string }>;
}

/**
 * `mode: "create"` render of the shared `QuoteScreen` (web design system,
 * issue #222): a top-level module record gets a real page (docs/ARCHITECTURE.md
 * "Popup vs. full page"). Gated on `can(actor, "quotes", "create")` — owner or
 * planner, matching `createQuote`'s own RBAC check (and the RLS INSERT policy)
 * exactly; `hasFeature()` is checked before anything renders.
 *
 * `?clientId=...` locks the client (pre-scoping from a client context).
 * Status is an editable select; left empty it uses the organization default
 * (Draft) from the DB, as the old form did.
 */
export default async function NewQuotePage({ searchParams }: NewQuotePageProps) {
  const { clientId } = await searchParams;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "quotes"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "quotes")) notFound();
  if (!can(actor, "quotes", "create")) notFound();

  const [lockedClientResult, clientsResult, statusesResult] = await Promise.all([
    clientId ? getClient(clientId) : Promise.resolve(null),
    clientId ? Promise.resolve(null) : listClients({ limit: 200 }),
    listReferenceItems("quote_status"),
  ]);

  if (clientId && !lockedClientResult?.data) notFound();
  const lockedClient = lockedClientResult?.data?.client ?? null;

  return (
    <QuoteScreen
      mode="create"
      client={lockedClient}
      clients={clientsResult?.data?.clients ?? []}
      statuses={statusesResult.data?.items ?? []}
      lockedClientId={lockedClient?.id}
      cancelHref={lockedClient ? `/clients/${lockedClient.id}` : "/quotes"}
    />
  );
}
