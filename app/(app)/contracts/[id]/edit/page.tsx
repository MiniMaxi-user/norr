import { notFound } from "next/navigation";
import { Breadcrumbs, Heading, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getContract } from "../../actions";
import { getClient, listClients } from "@/app/(app)/clients/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { ContractForm } from "../../components/contract-form";

export const metadata = { title: "Edit contract" };

interface EditContractPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Full-page contract edit form (docs/ARCHITECTURE.md "Popup vs. full page").
 * Gated on `can(actor, "contracts", "update")` — owner/finance only, matching
 * `updateContract`'s own RBAC check (and the RLS UPDATE policy) exactly.
 */
export default async function EditContractPage({ params }: EditContractPageProps) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "contracts"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "contracts")) notFound();
  if (!can(actor, "contracts", "update")) notFound();

  const [contractResult, clientsResult, contractTypesResult, slaTiersResult, billingTermsResult] =
    await Promise.all([
      getContract(id),
      listClients({ limit: 200 }),
      listReferenceItems("contract_type"),
      listReferenceItems("sla_tier"),
      listReferenceItems("billing_terms"),
    ]);
  if (!contractResult.data) notFound();
  const contract = contractResult.data.contract;

  const clients = clientsResult.data?.clients ?? [];
  const contractTypes = contractTypesResult.data?.items ?? [];
  const slaTiers = slaTiersResult.data?.items ?? [];
  const billingTerms = billingTermsResult.data?.items ?? [];

  const clientResult = await getClient(contract.client_id);
  const client = clientResult.data?.client ?? null;

  const breadcrumbItems = client
    ? [
        { label: "Clients", href: "/clients" },
        { label: client.name, href: `/clients/${client.id}` },
        { label: contract.name, href: `/contracts/${contract.id}` },
        { label: "Edit" },
      ]
    : [
        { label: "Contracts", href: "/contracts" },
        { label: contract.name, href: `/contracts/${contract.id}` },
        { label: "Edit" },
      ];

  return (
    <Stack gap="lg">
      <Breadcrumbs items={breadcrumbItems} />
      <Heading level={1}>Edit {contract.name}</Heading>
      <ContractForm
        mode="edit"
        contract={contract}
        clients={clients}
        contractTypes={contractTypes}
        slaTiers={slaTiers}
        billingTerms={billingTerms}
        cancelHref={`/contracts/${contract.id}`}
      />
    </Stack>
  );
}
