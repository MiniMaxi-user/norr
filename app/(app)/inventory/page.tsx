import { Suspense } from "react";
import { notFound } from "next/navigation";
import { OverviewHeroBand, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { InventoryScreen } from "./components/inventory-screen";
import { InventoryScreenSkeleton } from "./components/inventory-screen-skeleton";

export const metadata = { title: "Inventory" };

/**
 * Inventory / "Voorraad" module entry point (issue #181) — the admin-
 * facing overview of every engineer's own warehouse (one row per engineer).
 * Mirrors `app/(app)/articles/page.tsx`'s shape exactly: Server Component
 * resolving session/entitlement/RBAC once, handing the data-dependent table
 * to `InventoryScreen` behind a `Suspense` boundary so the hero band paints
 * immediately and the table streams in behind a shaped skeleton
 * (docs/ARCHITECTURE.md "Premium UX requirements").
 *
 * Per docs/ARCHITECTURE.md ("a module/view that isn't entitled for the
 * tenant must not render, not just be disabled"): `hasFeature()` is checked
 * here, before anything module-specific renders, and `notFound()`s
 * otherwise — same gate `./actions.ts` applies server-action-side via
 * `requireModuleContext`. `canAccessModule` on top of that is what actually
 * keeps Engineer out of this route in practice: the "Voorraad" nav entry
 * already hides itself for them (`requiredPermission: { module: "inventory",
 * action: "read" }`, which Engineer's `read_own` doesn't satisfy — see
 * `components/shell/nav-items.ts`), but a direct hit on `/inventory` still
 * needs this same gate server-side.
 *
 * No filters/pagination/view-switcher here — `listWarehouses` is
 * deliberately unpaginated (cardinality bounded by team size, one warehouse
 * per engineer), so unlike Articles/Contracts there is no search bar or
 * page param to thread through.
 */
export default async function InventoryPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "inventory"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "inventory")) notFound();

  return (
    <Stack gap="lg">
      <OverviewHeroBand
        title="Inventory"
        subtitle="Every engineer has their own warehouse — view stock, quantities, and value per warehouse."
      />

      <Suspense fallback={<InventoryScreenSkeleton />}>
        <InventoryScreen />
      </Suspense>
    </Stack>
  );
}
