import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for `/contracts/[id]` — no
// bespoke skeleton for this detail/edit page; uses the shared minimal
// fallback.
export default function ContractDetailLoading() {
  return <RouteLoading />;
}
