import { Suspense } from "react";
import { notFound } from "next/navigation";
import { WebListSkeleton } from "@yourorg/ui/web";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { WarehousesList } from "./components/warehouses-list";

export const metadata = { title: "Inventory" };

/**
 * Inventory module list page (issue #181, list-page shell of issue #222) —
 * the admin-facing overview of every engineer's own warehouse (one row per
 * engineer). Server Component: resolves session / entitlement / RBAC once,
 * then streams the data-dependent list behind the shaped `WebListSkeleton`
 * (its header paints at once).
 *
 * `hasFeature()` is checked here, before anything module-specific renders,
 * and `notFound()`s otherwise — the same gate `./actions.ts` applies via
 * `requireModuleContext`. `canAccessModule` keeps Engineer (plain
 * `read_own`) out of this route; a direct hit still needs this gate.
 */
export default async function InventoryPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "inventory"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "inventory")) notFound();

  return (
    <Suspense fallback={<WebListSkeleton module="Inventory" title="Inventory" columns={6} />}>
      <WarehousesList />
    </Suspense>
  );
}
