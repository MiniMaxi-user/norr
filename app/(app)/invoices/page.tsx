import { Suspense } from "react";
import { notFound } from "next/navigation";
import { WebListSkeleton } from "@yourorg/ui/web";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { InvoicesScreen } from "./components/invoices-screen";
import type { InvoicesSearchParams } from "./components/invoices-query";

export const metadata = { title: "Invoices" };

/**
 * Invoices overview (issue #234): Server Component gating on the `invoicing`
 * entitlement (`hasFeature`) and role access (`canAccessModule`) before
 * anything renders (`notFound()` otherwise), then streaming the data-heavy
 * `InvoicesScreen` behind `Suspense` with the list-page skeleton.
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<InvoicesSearchParams> }) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "invoicing"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "invoicing")) notFound();

  const params = await searchParams;

  return (
    <Suspense fallback={<WebListSkeleton module="Invoices" title="Invoices" columns={9} />}>
      <InvoicesScreen params={params} />
    </Suspense>
  );
}
