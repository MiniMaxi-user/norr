import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140 precedent) for
// `/inventory/[warehouseId]` — no bespoke skeleton for this detail page;
// uses the shared minimal fallback (same as `/articles/[id]`/`/contracts/[id]`).
export default function WarehouseDetailLoading() {
  return <RouteLoading />;
}
