import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140 precedent) for
// `/settings/team/[userId]` — no bespoke skeleton for this detail page; uses
// the shared minimal fallback (same as `/inventory/[warehouseId]`,
// `/articles/[id]`, `/contracts/[id]`).
export default function TeamMemberDetailLoading() {
  return <RouteLoading />;
}
