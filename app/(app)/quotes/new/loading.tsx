import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for `/quotes/new` — no bespoke
// skeleton for this create route; uses the shared minimal fallback.
export default function NewQuoteLoading() {
  return <RouteLoading />;
}
