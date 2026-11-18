import { Suspense } from "react";
import { notFound } from "next/navigation";
import { WebListSkeleton } from "@yourorg/ui/web";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { ContractsScreen } from "./components/contracts-screen";
import type { ContractsSearchParams } from "./components/contracts-query";

export const metadata = { title: "Contracts" };

/**
 * Contracts module entry point (issue #33 frontend half, list-page shell of
 * issue #222): Server Component resolving session/entitlement/RBAC once,
 * handing everything data-dependent to `ContractsScreen` behind `Suspense`
 * (fallback `WebListSkeleton`, whose header paints at once). The `Suspense`
 * is deliberately not keyed on the filter params: the table changes the URL
 * in a transition, keeping the old rows on screen while the new page loads.
 *
 * Per docs/ARCHITECTURE.md ("a module/view that isn't entitled for the
 * tenant must not render, not just be disabled"): `hasFeature()` is checked
 * here, before anything module-specific renders, and `notFound()`s
 * otherwise — same gate `app/(app)/contracts/actions.ts` applies
 * server-action-side via `requireModuleContext`.
 *
 * Contracts is owner-or-finance-write, everyone-else-read
 * (`lib/rbac/permissions.ts`'s `contracts` row): "New contract" is gated on
 * `can(actor, "contracts", "create")`.
 */
export default async function ContractsPage({ searchParams }: { searchParams: Promise<ContractsSearchParams> }) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "contracts"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "contracts")) notFound();

  const params = await searchParams;

  return (
    <Suspense fallback={<WebListSkeleton module="Contracts" title="Contracts" columns={9} />}>
      <ContractsScreen
        params={params}
        canCreate={can(actor, "contracts", "create")}
        canDelete={can(actor, "contracts", "delete")}
      />
    </Suspense>
  );
}
