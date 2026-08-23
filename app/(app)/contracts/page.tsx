import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Heading, Stack, Text } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { ContractsScreen } from "./components/contracts-screen";
import { ContractsScreenSkeleton } from "./components/contracts-screen-skeleton";

export const metadata = { title: "Contracts" };

interface ContractsPageProps {
  searchParams: Promise<{ page?: string }>;
}

/**
 * Contracts module entry point (issue #33 frontend half) — mirrors
 * `app/(app)/work-orders/page.tsx`'s shape exactly: Server Component
 * resolving session/entitlement/RBAC once, handing everything
 * data-dependent to a screen component behind `Suspense` so the page shell
 * paints immediately.
 *
 * Per docs/ARCHITECTURE.md ("a module/view that isn't entitled for the
 * tenant must not render, not just be disabled"): `hasFeature()` is checked
 * here, before anything module-specific renders, and `notFound()`s
 * otherwise — same gate `app/(app)/contracts/actions.ts` applies
 * server-action-side via `requireModuleContext`.
 *
 * Unlike Work Orders' owner/planner "create" split, Contracts is
 * owner-or-finance-write, everyone-else-read (`lib/rbac/permissions.ts`'s
 * `contracts` row): the "New contract" toolbar action below is gated on
 * `can(actor, "contracts", "create")`, which only an owner or finance user
 * satisfies — a planner/engineer/administratie never sees it, even though
 * they can still view the list.
 */
export default async function ContractsPage({ searchParams }: ContractsPageProps) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "contracts"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "contracts")) notFound();

  const params = await searchParams;
  const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level={1}>Contracts</Heading>
        <Text tone="muted">Service agreements and maintenance contracts, across every client.</Text>
      </Stack>

      <Suspense key={`${page}`} fallback={<ContractsScreenSkeleton />}>
        <ContractsScreen
          page={page}
          canCreate={can(actor, "contracts", "create")}
          canEdit={can(actor, "contracts", "update")}
          canDelete={can(actor, "contracts", "delete")}
        />
      </Suspense>
    </Stack>
  );
}
