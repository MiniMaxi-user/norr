import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getWarehouse } from "../actions";
import { WarehouseScreen } from "../components/warehouse-screen";

export const metadata = { title: "Warehouse details" };

interface WarehouseDetailPageProps {
  params: Promise<{ warehouseId: string }>;
}

/**
 * `/inventory/[warehouseId]` — a single engineer's warehouse (issue #181):
 * editable name, inline-editable stock table (quantity/min threshold,
 * search-to-add, remove), read-only total consumed/last counted, and a
 * purchase/sale value footer. Same gating shape as every other module's
 * detail page (`hasFeature` -> `canAccessModule` -> the record's own RLS-
 * backed fetch, which 404s on a bad id or an id outside this org).
 *
 * `readOnly` is `!canUpdate` — Finance holds plain `read` on `inventory`
 * (see `packages/rbac/src/permissions.ts`), so it renders the exact same
 * layout with every edit affordance (name pencil, quantity steppers, add/
 * remove) omitted rather than a separate read-only component, same
 * convention `ContractScreen`'s own `readOnly` prop documents.
 */
export default async function WarehouseDetailPage({ params }: WarehouseDetailPageProps) {
  const { warehouseId } = await params;

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "inventory"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "inventory")) notFound();

  const result = await getWarehouse(warehouseId);
  if (!result.data) notFound();
  const { warehouse, stock, totalPurchaseValue, totalSaleValue } = result.data;

  const canUpdate = can(actor, "inventory", "update");
  const canCreate = can(actor, "inventory", "create");
  const canDelete = can(actor, "inventory", "delete");

  const breadcrumbItems = [
    { label: "Inventory", href: "/inventory" },
    { label: warehouse.name },
  ];

  return (
    <WarehouseScreen
      breadcrumbItems={breadcrumbItems}
      warehouse={warehouse}
      stock={stock}
      totalPurchaseValue={totalPurchaseValue}
      totalSaleValue={totalSaleValue}
      readOnly={!canUpdate}
      canCreate={canCreate}
      canUpdate={canUpdate}
      canDelete={canDelete}
    />
  );
}
