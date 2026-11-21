import { Suspense } from "react";
import { notFound } from "next/navigation";
import { WebListSkeleton } from "@yourorg/ui/web";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { QuotesScreen } from "./components/quotes-screen";
import type { QuotesSearchParams } from "./components/quotes-query";

export const metadata = { title: "Quotes" };

/** "Invoice selected" (issue #237) runs as a server action on this route: up to 200 invoices + PDFs. */
export const maxDuration = 300;

/**
 * Quotes module entry point (issue #16, third stage — frontend; list-page
 * shell of issue #222): Server Component resolving session/entitlement/RBAC
 * once, handing everything data-dependent to `QuotesScreen` behind
 * `Suspense` (fallback `WebListSkeleton`, whose header paints at once). The
 * `Suspense` is deliberately not keyed on the filter params: the table
 * changes the URL in a transition, keeping the old rows on screen while the
 * new page loads.
 *
 * Per docs/ARCHITECTURE.md ("a module/view that isn't entitled for the
 * tenant must not render, not just be disabled"): `hasFeature()` is checked
 * here, before anything module-specific renders, and `notFound()`s
 * otherwise — same gate `app/(app)/quotes/actions.ts` applies
 * server-action-side via `requireModuleContext`.
 *
 * Quotes is owner-or-planner-write, everyone-else-read
 * (`lib/rbac/permissions.ts`'s `quotes` row): "New quote" is gated on
 * `can(actor, "quotes", "create")`.
 */
export default async function QuotesPage({ searchParams }: { searchParams: Promise<QuotesSearchParams> }) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "quotes"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "quotes")) notFound();

  const params = await searchParams;
  const canGenerateContractQuotes =
    can(actor, "quotes", "create") &&
    (await hasFeature(session.organization, "contracts")) &&
    canAccessModule(actor, "contracts");

  const canInvoice =
    can(actor, "invoicing", "create") &&
    (await hasFeature(session.organization, "invoicing")) &&
    canAccessModule(actor, "invoicing");

  return (
    <Suspense fallback={<WebListSkeleton module="Quotes" title="Quotes" columns={8} />}>
      <QuotesScreen
        params={params}
        canGenerateContractQuotes={canGenerateContractQuotes}
        canEndContracts={canGenerateContractQuotes && can(actor, "contracts", "update")}
        canCreate={can(actor, "quotes", "create")}
        canDelete={can(actor, "quotes", "delete")}
        canInvoice={canInvoice}
      />
    </Suspense>
  );
}
