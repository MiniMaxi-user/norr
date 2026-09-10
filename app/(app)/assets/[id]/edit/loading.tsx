import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for `/assets/[id]/edit` — no
// bespoke skeleton for this route; uses the shared minimal fallback.
export default function EditAssetLoading() {
  return <RouteLoading />;
}
