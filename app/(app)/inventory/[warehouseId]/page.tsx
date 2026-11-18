import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { getWarehouse } from "../actions";
import { WarehouseScreen } from "../components/warehouse-screen";
import { WAREHOUSE_DETAIL_VIEW_KEY, WAREHOUSE_TAB_IDS, type WarehouseDetailTab } from "../components/warehouse-parts";

export const metadata = { title: "Warehouse details" };

interface WarehouseDetailPageProps {
  params: Promise<{ warehouseId: string }>;
  /** `?tab=stock` deep-links straight to a tab. */
  searchParams: Promise<{ tab?: string }>;
}

/**
 * `/inventory/[warehouseId]` — a single engineer's warehouse (issue #181) on
 * the web design system (issue #222): editable name, stock table with add /
 * adjust (quantity, minimum) / remove, key figures in the rail. Same gating
 * as every other module's detail page (`hasFeature` -> `canAccessModule` ->
 * the record's own RLS-backed fetch, which 404s on a bad id or an id outside
 * this org).
 *
 * A caller without update rights (Finance holds plain `read`) gets the same
 * page with every edit affordance (Edit, add, adjust, remove) omitted.
 * `?tab=` (explicit deep link) beats the last-used-view cookie.
 */
export default async function WarehouseDetailPage({ params, searchParams }: WarehouseDetailPageProps) {
  const [{ warehouseId }, { tab }] = await Promise.all([params, searchParams]);

  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "inventory"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "inventory")) notFound();

  const [result, lastUsedTab] = await Promise.all([
    getWarehouse(warehouseId),
    preferencesStore.getLastUsedView(session.userId, WAREHOUSE_DETAIL_VIEW_KEY),
  ]);
  if (!result.data) notFound();
  const { warehouse, stock, totalPurchaseValue, totalSaleValue } = result.data;

  const available = (raw: string | null | undefined) =>
    raw && WAREHOUSE_TAB_IDS.includes(raw as WarehouseDetailTab) ? (raw as WarehouseDetailTab) : null;

  return (
    <WarehouseScreen
      warehouse={warehouse}
      stock={stock}
      totalPurchaseValue={totalPurchaseValue}
      totalSaleValue={totalSaleValue}
      canCreate={can(actor, "inventory", "create")}
      canUpdate={can(actor, "inventory", "update")}
      canDelete={can(actor, "inventory", "delete")}
      defaultTab={available(tab) ?? available(lastUsedTab) ?? "overview"}
    />
  );
}
