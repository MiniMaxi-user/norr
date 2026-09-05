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
 * Unified contract screen in `mode="create"` (issue #122) — a real page
 * (docs/ARCHITECTURE.md "Popup vs. full page — pick by weight, not habit":
 * Contracts is named there as a top-level module entity, same tier as
 * Clients/Assets/Work Orders), not a `Dialog`.
 *
 * In-context pre-scoping: arriving with `?clientId=...` (a future
 * client-scoped "New contract" entry point) locks the client picker,
 * mirroring `app/(app)/assets/new/page.tsx`/`app/(app)/work-orders/new/page.tsx`'s
 * `lockedClientId` handling exactly.
 *
 * Gated on `can(actor, "contracts", "create")` — owner/finance only,
 * matching `createContract`'s own RBAC check (and the RLS INSERT policy)
 * exactly, so a planner/engineer/administratie never sees this route
 * resolve at all.
 */
export default async function NewContractPage({ searchParams }: NewContractPageProps) {
  const { clientId } = await searchParams;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "contracts"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "contracts")) notFound();
  if (!can(actor, "contracts", "create")) notFound();

  const [clientsResult, lockedClientResult, contractTypesResult, slaTiersResult, billingTermsResult, billingPeriodsResult] =
    await Promise.all([
      clientId ? Promise.resolve(null) : listClients({ limit: 200 }),
      clientId ? getClient(clientId) : Promise.resolve(null),
      listReferenceItems("contract_type"),
      listReferenceItems("sla_tier"),
      listReferenceItems("billing_terms"),
      listReferenceItems("billing_period"),
    ]);

  if (clientId && !lockedClientResult?.data) notFound();

  const clients = clientsResult?.data?.clients ?? [];
  const lockedClient = lockedClientResult?.data?.client ?? null;
  const contractTypes = contractTypesResult.data?.items ?? [];
  const slaTiers = slaTiersResult.data?.items ?? [];
  const billingTerms = billingTermsResult.data?.items ?? [];
  const billingPeriods = billingPeriodsResult.data?.items ?? [];

  const breadcrumbItems = lockedClient
    ? [
        { label: "Clients", href: "/clients" },
        { label: lockedClient.name, href: `/clients/${lockedClient.id}` },
        { label: "New contract" },
      ]
    : [{ label: "Contracts", href: "/contracts" }, { label: "New contract" }];

  const cancelHref = lockedClient ? `/clients/${lockedClient.id}` : "/contracts";

  return (
    <ContractScreen
      mode="create"
      breadcrumbItems={breadcrumbItems}
      client={lockedClient}
      clients={clients}
      lockedClientId={lockedClient?.id}
      cancelHref={cancelHref}
      contractTypes={contractTypes}
      slaTiers={slaTiers}
      billingTerms={billingTerms}
      billingPeriods={billingPeriods}
      canCreate
      canUpdate
      canDelete={false}
    />
  );
}
