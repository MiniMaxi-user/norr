import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getContract, listContractLineItems } from "../../actions";
import { getContractEndBalance } from "../../end-actions";
import { ContractEndScreen } from "../../components/contract-end-screen";
import { buildInvoicingExplanation } from "../../components/contract-invoicing-explanation";

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
 * A balance error never 404s: the screen renders it and the end date stays editable.
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
  // Scheduled or passed end date: keep it. Otherwise today, but never before the
  // start date (contracts can start in the future).
  const initialEndDate =
    contract.end_date && (contract.end_date <= today || contract.end_scheduled_at)
      ? contract.end_date
      : today < contract.start_date
        ? contract.start_date
        : today;

  const [balanceResult, lineItemsResult] = await Promise.all([
    getContractEndBalance(id, { endDate: initialEndDate }),
    listContractLineItems(id),
  ]);

  const lines = lineItemsResult.data?.lineItems ?? [];
  const explanation = buildInvoicingExplanation({
    intervalMonths: contract.billing_terms?.interval_months ?? null,
    timing: contract.invoicing_timing,
    frequency: contract.counter_settlement_frequency,
    settlementMonth: contract.counter_settlement_month,
    creditsUnderUse: lines.some((row) => row.is_volume && row.volume_item_id && row.credit_under_use),
    hasCounterLines: lines.some((row) => row.is_volume && row.volume_item_id),
  });

  const canSeeQuotes = (await hasFeature(session.organization, "quotes")) && canAccessModule(actor, "quotes");

  return (
    <ContractEndScreen
      contractId={id}
      contractNumber={contract.contract_number}
      startDate={contract.start_date}
      currentEndDate={contract.end_date}
      initialEndDate={initialEndDate}
      initialBalance={balanceResult.data ?? null}
      initialError={balanceResult.data ? null : (balanceResult.error ?? "Could not calculate the balance.")}
      explanation={explanation}
      canSeeQuotes={canSeeQuotes}
    />
  );
}
