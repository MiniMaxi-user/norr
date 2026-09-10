import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for `/activities/new` — no
// bespoke skeleton for this create route; uses the shared minimal fallback.
export default function NewActivityLoading() {
  return <RouteLoading />;
}
