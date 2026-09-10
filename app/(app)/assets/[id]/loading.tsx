import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for `/assets/[id]` — no bespoke
// skeleton for this detail page; uses the shared minimal fallback.
export default function AssetDetailLoading() {
  return <RouteLoading />;
}
