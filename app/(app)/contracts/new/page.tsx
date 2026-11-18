import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { ContractScreen } from "../components/contract-screen";

export const metadata = { title: "New contract" };

interface NewContractPageProps {
  searchParams: Promise<{ clientId?: string }>;
}

/**
 * `mode: "create"` render of the shared `ContractScreen` (web design system,
 * issue #222) — replaces the "create a bare contract and jump to its detail
 * page" button. Gated on `can(actor, "contracts", "create")` — owner or
 * finance, matching `createContract`'s own RBAC check (and the RLS INSERT
 * policy) exactly; `hasFeature()` is checked before anything renders.
 *
 * `?clientId=...` (the Clients detail page's Contracts tab) locks the client:
 * a contract's client is fixed at creation anyway.
 */
export default async function NewContractPage({ searchParams }: NewContractPageProps) {
  const { clientId } = await searchParams;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "contracts"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "contracts")) notFound();
  if (!can(actor, "contracts", "create")) notFound();

  const [lockedClientResult, clientsResult, contractTypes, slaTiers, billingTerms, billingPeriods] = await Promise.all([
    clientId ? getClient(clientId) : Promise.resolve(null),
    clientId ? Promise.resolve(null) : listClients({ limit: 200 }),
    listReferenceItems("contract_type"),
    listReferenceItems("sla_tier"),
    listReferenceItems("billing_terms"),
    listReferenceItems("billing_period"),
  ]);

  if (clientId && !lockedClientResult?.data) notFound();
  const lockedClient = lockedClientResult?.data?.client ?? null;

  return (
    <ContractScreen
      mode="create"
      client={lockedClient}
      clients={clientsResult?.data?.clients ?? []}
      lockedClientId={lockedClient?.id}
      cancelHref={lockedClient ? `/clients/${lockedClient.id}` : "/contracts"}
      lists={{
        contractTypes: contractTypes.data?.items ?? [],
        slaTiers: slaTiers.data?.items ?? [],
        billingTerms: billingTerms.data?.items ?? [],
        billingPeriods: billingPeriods.data?.items ?? [],
      }}
    />
  );
}
