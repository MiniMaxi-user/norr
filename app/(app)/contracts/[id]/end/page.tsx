import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getContract } from "../../actions";
import { getContractEndBalance } from "../../end-actions";
import { ContractEndScreen } from "../../components/contract-end-screen";

export const metadata = { title: "End contract" };

interface EndContractPageProps {
  params: Promise<{ id: string }>;
}

/**
 * End contract (issue #271): a real page (docs/ARCHITECTURE.md "Popup vs. full
 * page"), reached from the contract's "End contract" / "Complete final balance"
 * actions. Gated like the actions behind it: contracts entitlement and
 * `can(actor, "contracts", "update")` (owner/finance), resolved before anything
 * renders. Draft contracts cannot be ended; an ended contract with a final
 * balance has nothing left to do and returns to its detail page.
 */
export default async function EndContractPage({ params }: EndContractPageProps) {
  const { id } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "contracts"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "contracts")) notFound();
  if (!can(actor, "contracts", "update")) notFound();

  const contractResult = await getContract(id);
  if (!contractResult.data) notFound();
  const contract = contractResult.data.contract;
  if (contract.status === "draft") redirect(`/contracts/${id}`);
  if (contract.status === "ended" && contract.has_final_settlement !== false) redirect(`/contracts/${id}`);

  const today = new Date().toISOString().slice(0, 10);
  // Reopened after the end date (or a legacy ended contract): its own end date.
  // A scheduled ending shows its date; otherwise today.
  const initialEndDate =
    contract.end_date && (contract.end_date <= today || contract.end_scheduled_at) ? contract.end_date : today;
  const balanceResult = await getContractEndBalance(id, { endDate: initialEndDate });
  if (!balanceResult.data) notFound();

  const canSeeQuotes = (await hasFeature(session.organization, "quotes")) && canAccessModule(actor, "quotes");

  return (
    <ContractEndScreen
      contractId={id}
      contractNumber={contract.contract_number}
      startDate={contract.start_date}
      initialEndDate={initialEndDate}
      initialBalance={balanceResult.data}
      canSeeQuotes={canSeeQuotes}
    />
  );
}
