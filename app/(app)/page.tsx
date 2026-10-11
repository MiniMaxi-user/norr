import { Suspense } from "react";
import { notFound } from "next/navigation";
import { OverviewHeroBand, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { parseFilters } from "@/lib/dashboard/compute";
import { DashboardScreen } from "./dashboard/components/dashboard-screen";
import { DashboardSkeleton } from "./dashboard/components/dashboard-skeleton";

export const metadata = { title: "Dashboard" };

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Home route: the KPI dashboard. Server Component resolving session,
 * entitlement and RBAC up front (`hasFeature` before anything renders), then
 * streaming the data-dependent screen behind `Suspense` with a shaped
 * skeleton. Filters live in the URL (`?period=3m&client=...`) so a filtered
 * view is shareable; the client screen keeps them in sync without navigating.
 */
export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "dashboard"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "dashboard")) notFound();

  const raw = await searchParams;
  const params: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) params[key] = Array.isArray(value) ? value[0] : value;

  return (
    <Stack gap="lg">
      <OverviewHeroBand
        title="Dashboard"
        subtitle="Revenue, work orders and malfunctions at a glance. Click any chart or ranking to filter everything."
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardScreen session={session} actor={actor} initialFilters={parseFilters(params)} />
      </Suspense>
    </Stack>
  );
}
