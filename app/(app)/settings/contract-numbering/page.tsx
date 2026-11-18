import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { ContractNumberingForm } from "../components/contract-numbering-form";
import { getContractNumberingSettings } from "./actions";

export const metadata = { title: "Contract numbering" };

/**
 * Per-tenant contract numbering (issue #216): prefix + next number. The
 * `"settings"` gate already ran in `../layout.tsx`; this leaf adds the
 * `contracts` feature gate and the `contract_numbering` module/`read` gate -
 * not entitled means the route doesn't resolve - and computes `canWrite` from
 * `update`.
 */
export default async function ContractNumberingPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "contracts"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "contract_numbering") || !can(actor, "contract_numbering", "read")) notFound();
  const canWrite = can(actor, "contract_numbering", "update");

  const settings = await getContractNumberingSettings();

  return <ContractNumberingForm initial={settings} canWrite={canWrite} />;
}
